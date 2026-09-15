<?php
/**
 * Safe fallback reconciliation for Mercado Pago payment notifications.
 *
 * Mercado Pago can occasionally return CPP_NT_0602004 while processing a
 * notification. In that case the official plugin stores the payment id but
 * leaves the WooCommerce order pending. This job verifies the saved payment
 * directly with Mercado Pago before completing the order.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Mercado_Pago_Reconciler
{
    private const CRON_HOOK = 'lm_reconcile_mercadopago_payments';
    private const CRON_SCHEDULE = 'lm_every_minute';
    private const PAYMENT_IDS_META = '_Mercado_Pago_Payment_IDs';
    private const PRODUCTION_MODE_META = 'is_production_mode';
    private const LOCK_KEY = 'lm_mercadopago_reconciliation_lock';
    private const LOCK_DURATION = 90;

    public static function init(): void
    {
        add_filter('cron_schedules', array(__CLASS__, 'add_schedule'));
        add_action('init', array(__CLASS__, 'ensure_schedule'));
        add_action(self::CRON_HOOK, array(__CLASS__, 'reconcile_pending_orders'));
        // The official Mercado Pago webhook remains the primary confirmation
        // path. This only gives a customer who has returned from a successful
        // payment a server-side, API-verified fast path when that webhook is
        // delayed or incomplete.
        add_action('woocommerce_thankyou', array(__CLASS__, 'reconcile_checkout_return'), 20);
    }

    /**
     * @param array<string, array<string, mixed>> $schedules
     * @return array<string, array<string, mixed>>
     */
    public static function add_schedule(array $schedules): array
    {
        $schedules[self::CRON_SCHEDULE] = array(
            'interval' => MINUTE_IN_SECONDS,
            'display' => __('Cada minuto (reconciliación Mercado Pago)', 'lm-commerce'),
        );

        return $schedules;
    }

    public static function ensure_schedule(): void
    {
        $event = wp_get_scheduled_event(self::CRON_HOOK);
        if ($event && self::CRON_SCHEDULE === $event->schedule) {
            return;
        }

        // Replace the previous five-minute recurrence after deployment, rather
        // than waiting for WordPress to naturally recreate the old event.
        if ($event) {
            wp_clear_scheduled_hook(self::CRON_HOOK);
        }

        wp_schedule_event(time() + MINUTE_IN_SECONDS, self::CRON_SCHEDULE, self::CRON_HOOK);
    }

    public static function unschedule(): void
    {
        $timestamp = wp_next_scheduled(self::CRON_HOOK);
        if ($timestamp) {
            wp_unschedule_event($timestamp, self::CRON_HOOK);
        }
    }

    public static function reconcile_pending_orders(): void
    {
        if (! function_exists('wc_get_orders') || get_transient(self::LOCK_KEY)) {
            return;
        }

        set_transient(self::LOCK_KEY, '1', self::LOCK_DURATION);

        try {
            $orders = wc_get_orders(array(
                'status' => array('pending', 'on-hold'),
                // A small oldest-first batch prevents a busy period from
                // leaving an earlier approved payment behind newer orders.
                'limit' => 10,
                'orderby' => 'date',
                'order' => 'ASC',
                'return' => 'objects',
                'meta_query' => array(
                    array(
                        'key' => self::PAYMENT_IDS_META,
                        'value' => '',
                        'compare' => '!=',
                    ),
                ),
            ));

            foreach ($orders as $order) {
                if ($order instanceof WC_Order && self::is_mercado_pago_order($order) && $order->needs_payment()) {
                    self::reconcile_order($order, 'scheduled_reconciliation');
                }
            }
        } catch (Throwable $error) {
            self::log('La conciliación se detuvo sin actualizar pedidos: ' . $error->getMessage(), 0, 'scheduled_reconciliation');
        } finally {
            delete_transient(self::LOCK_KEY);
        }
    }

    /**
     * Verify the payment as soon as WooCommerce renders the order-received
     * page. The browser response is never trusted: the payment is only
     * completed after Mercado Pago's API confirms its approved status.
     */
    public static function reconcile_checkout_return(int $order_id): void
    {
        if (! function_exists('wc_get_order') || get_transient(self::LOCK_KEY)) {
            return;
        }

        $order = wc_get_order($order_id);
        if (! $order instanceof WC_Order || ! self::is_mercado_pago_order($order) || ! $order->needs_payment()) {
            return;
        }

        set_transient(self::LOCK_KEY, '1', self::LOCK_DURATION);

        try {
            self::reconcile_order($order, 'checkout_return');
        } catch (Throwable $error) {
            self::log('La verificación al volver de Mercado Pago se detuvo: ' . $error->getMessage(), $order->get_id(), 'checkout_return');
        } finally {
            delete_transient(self::LOCK_KEY);
        }
    }

    private static function is_mercado_pago_order(WC_Order $order): bool
    {
        return str_starts_with($order->get_payment_method(), 'woo-mercado-pago-');
    }

    private static function reconcile_order(WC_Order $order, string $source): bool
    {
        if (! $order->needs_payment()) {
            return false;
        }

        $payment_ids = self::payment_ids($order);
        if (empty($payment_ids)) {
            return false;
        }

        $token = self::access_token($order);
        if ('' === $token) {
            return false;
        }

        foreach ($payment_ids as $payment_id) {
            $payment = self::payment($payment_id, $token);
            if (! is_array($payment) || 'approved' !== ($payment['status'] ?? '')) {
                continue;
            }

            if (! self::belongs_to_order($payment, $order)) {
                self::log('La conciliación omitió un pago cuya referencia no coincide.', $order->get_id(), $source);
                continue;
            }

            // Reload immediately before updating in case the official webhook
            // completed the order while this verification request was running.
            $current_order = wc_get_order($order->get_id());
            if (! $current_order instanceof WC_Order || ! $current_order->needs_payment()) {
                return false;
            }

            $current_order->payment_complete($payment_id);
            $current_order->add_order_note(
                'checkout_return' === $source
                    ? __('Mercado Pago: pago aprobado verificado automáticamente al volver del checkout.', 'lm-commerce')
                    : __('Mercado Pago: pago aprobado conciliado automáticamente tras una notificación incompleta.', 'lm-commerce')
            );
            self::log('Pago aprobado confirmado automáticamente.', $current_order->get_id(), $source);
            return true;
        }

        return false;
    }

    /**
     * @return array<int, string>
     */
    private static function payment_ids(WC_Order $order): array
    {
        $ids = array();

        $collect = static function ($value) use (&$collect, &$ids): void {
            if (is_array($value)) {
                foreach ($value as $item) {
                    $collect($item);
                }
                return;
            }

            if (! is_scalar($value)) {
                return;
            }

            foreach (preg_split('/[^0-9]+/', (string) $value) ?: array() as $candidate) {
                if ('' !== $candidate) {
                    $ids[] = $candidate;
                }
            }
        };

        foreach ($order->get_meta_data() as $meta) {
            if (! is_object($meta) || ! method_exists($meta, 'get_data')) {
                continue;
            }

            $data = $meta->get_data();
            if (! is_array($data) || self::PAYMENT_IDS_META !== ($data['key'] ?? '')) {
                continue;
            }

            $collect($data['value'] ?? null);
        }

        return array_values(array_unique($ids));
    }

    private static function access_token(WC_Order $order): string
    {
        $mode = (string) $order->get_meta(self::PRODUCTION_MODE_META, true);
        $production = in_array(strtolower($mode), array('yes', 'true', '1'), true);
        $option = $production ? '_mp_access_token_prod' : '_mp_access_token_test';

        return trim((string) get_option($option, ''));
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function payment(string $payment_id, string $token): ?array
    {
        $response = wp_remote_get(
            'https://api.mercadopago.com/v1/payments/' . rawurlencode($payment_id),
            array(
                'timeout' => 4,
                'headers' => array(
                    'Authorization' => 'Bearer ' . $token,
                    'Accept' => 'application/json',
                ),
            )
        );

        if (is_wp_error($response) || 200 !== wp_remote_retrieve_response_code($response)) {
            return null;
        }

        $payment = json_decode(wp_remote_retrieve_body($response), true);
        return is_array($payment) ? $payment : null;
    }

    /**
     * Mercado Pago's official plugin builds external_reference as store-id + order-id.
     * The payment id itself is already order metadata; this second check prevents an
     * unrelated approved payment from being applied if that metadata were ever altered.
     *
     * @param array<string, mixed> $payment
     */
    private static function belongs_to_order(array $payment, WC_Order $order): bool
    {
        $reference = (string) ($payment['external_reference'] ?? '');
        return '' !== $reference && str_ends_with($reference, (string) $order->get_id());
    }

    private static function log(string $message, int $order_id = 0, string $confirmation_source = ''): void
    {
        if (function_exists('wc_get_logger')) {
            $context = array(
                'source' => 'lm-mercadopago-reconciler',
                'order_id' => $order_id,
            );

            if ('' !== $confirmation_source) {
                $context['confirmation_source'] = $confirmation_source;
            }

            wc_get_logger()->info(
                $message,
                $context
            );
        }
    }
}
