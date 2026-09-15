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
    private const CRON_SCHEDULE = 'lm_every_five_minutes';
    private const PAYMENT_IDS_META = '_Mercado_Pago_Payment_IDs';
    private const PRODUCTION_MODE_META = 'is_production_mode';
    private const LOCK_KEY = 'lm_mercadopago_reconciliation_lock';

    public static function init(): void
    {
        add_filter('cron_schedules', array(__CLASS__, 'add_schedule'));
        add_action('init', array(__CLASS__, 'ensure_schedule'));
        add_action(self::CRON_HOOK, array(__CLASS__, 'reconcile_pending_orders'));
    }

    /**
     * @param array<string, array<string, mixed>> $schedules
     * @return array<string, array<string, mixed>>
     */
    public static function add_schedule(array $schedules): array
    {
        $schedules[self::CRON_SCHEDULE] = array(
            'interval' => 5 * MINUTE_IN_SECONDS,
            'display' => __('Cada cinco minutos (reconciliación Mercado Pago)', 'lm-commerce'),
        );

        return $schedules;
    }

    public static function ensure_schedule(): void
    {
        if (! wp_next_scheduled(self::CRON_HOOK)) {
            // Run the first reconciliation on the next cron request, then every five minutes.
            wp_schedule_event(time(), self::CRON_SCHEDULE, self::CRON_HOOK);
        }
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

        set_transient(self::LOCK_KEY, '1', 30);

        try {
            $orders = wc_get_orders(array(
                'status' => array('pending', 'on-hold'),
                // A single verified payment per run keeps cron isolated from admin requests.
                'limit' => 1,
                'orderby' => 'date',
                'order' => 'DESC',
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
                if ($order instanceof WC_Order && self::is_mercado_pago_order($order)) {
                    self::reconcile_order($order);
                }
            }
        } catch (Throwable $error) {
            self::log('La conciliación se detuvo sin actualizar pedidos: ' . $error->getMessage());
        } finally {
            delete_transient(self::LOCK_KEY);
        }
    }

    private static function is_mercado_pago_order(WC_Order $order): bool
    {
        return str_starts_with($order->get_payment_method(), 'woo-mercado-pago-');
    }

    private static function reconcile_order(WC_Order $order): void
    {
        $payment_ids = self::payment_ids($order);
        if (empty($payment_ids)) {
            return;
        }

        $token = self::access_token($order);
        if ('' === $token) {
            return;
        }

        foreach ($payment_ids as $payment_id) {
            $payment = self::payment($payment_id, $token);
            if (! is_array($payment) || 'approved' !== ($payment['status'] ?? '')) {
                continue;
            }

            if (! self::belongs_to_order($payment, $order)) {
                self::log('La conciliación omitió un pago cuya referencia no coincide.', $order->get_id());
                continue;
            }

            $order->payment_complete($payment_id);
            $order->add_order_note(
                __('Mercado Pago: pago aprobado conciliado automáticamente tras una notificación incompleta.', 'lm-commerce')
            );
            self::log('Pago aprobado conciliado automáticamente.', $order->get_id());
            return;
        }
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

    private static function log(string $message, int $order_id = 0): void
    {
        if (function_exists('wc_get_logger')) {
            wc_get_logger()->info(
                $message,
                array(
                    'source' => 'lm-mercadopago-reconciler',
                    'order_id' => $order_id,
                )
            );
        }
    }
}
