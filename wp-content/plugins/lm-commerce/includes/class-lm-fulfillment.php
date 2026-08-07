<?php
/**
 * Order status and idempotent Estafeta label generation.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Fulfillment
{
    private const STATUS = 'ready-to-ship';
    private const JOB = 'lm_generate_estafeta_label';

    public static function init(): void
    {
        add_action('init', array(__CLASS__, 'register_status'));
        add_filter('wc_order_statuses', array(__CLASS__, 'add_status'));
        add_action('woocommerce_order_status_' . self::STATUS, array(__CLASS__, 'queue_label'), 10, 2);
        add_action(self::JOB, array(__CLASS__, 'generate_label'));
        add_filter('woocommerce_order_actions', array(__CLASS__, 'order_actions'), 20, 2);
        add_action('woocommerce_order_action_lm_ready_to_ship', array(__CLASS__, 'mark_ready'));
        add_action('woocommerce_order_action_lm_retry_label', array(__CLASS__, 'retry_label'));
        add_action('woocommerce_order_action_lm_cancel_label', array(__CLASS__, 'cancel_label'));
        add_action('woocommerce_order_details_after_order_table', array(__CLASS__, 'customer_tracking'));
        add_action('woocommerce_email_after_order_table', array(__CLASS__, 'email_tracking'), 10, 4);
    }

    public static function register_status(): void
    {
        register_post_status('wc-' . self::STATUS, array(
            'label' => _x('Listo para enviar', 'Order status', 'lm-commerce'),
            'public' => true,
            'exclude_from_search' => false,
            'show_in_admin_all_list' => true,
            'show_in_admin_status_list' => true,
            'label_count' => _n_noop('Listo para enviar <span class="count">(%s)</span>', 'Listos para enviar <span class="count">(%s)</span>', 'lm-commerce'),
        ));
    }

    public static function add_status(array $statuses): array
    {
        $result = array();
        foreach ($statuses as $key => $label) {
            $result[$key] = $label;
            if ('wc-processing' === $key) {
                $result['wc-' . self::STATUS] = __('Listo para enviar', 'lm-commerce');
            }
        }
        return $result;
    }

    public static function queue_label(int $order_id, $order = null): void
    {
        $order = $order instanceof WC_Order ? $order : wc_get_order($order_id);
        if (! $order || $order->get_meta('_lm_envia_shipment_id')) {
            return;
        }
        if (function_exists('as_has_scheduled_action') && as_has_scheduled_action(self::JOB, array($order_id), 'lm-commerce')) {
            return;
        }
        if (function_exists('as_enqueue_async_action')) {
            as_enqueue_async_action(self::JOB, array($order_id), 'lm-commerce', true);
        } elseif (! wp_next_scheduled(self::JOB, array($order_id))) {
            wp_schedule_single_event(time() + 5, self::JOB, array($order_id));
        }
        $order->add_order_note(__('La generación de la guía Estafeta fue puesta en cola.', 'lm-commerce'));
    }

    public static function generate_label(int $order_id): void
    {
        $order = wc_get_order($order_id);
        if (! $order || $order->get_meta('_lm_envia_shipment_id')) {
            return;
        }

        $lock = (int) $order->get_meta('_lm_envia_lock');
        if ($lock && $lock > time() - 5 * MINUTE_IN_SECONDS) {
            return;
        }
        $order->update_meta_data('_lm_envia_lock', time());
        $order->save();

        $client = new LM_Envia_Client();
        if (! $client->configured()) {
            self::record_error($order, __('Falta configurar LM_ENVIA_TOKEN; no se generó una guía real.', 'lm-commerce'));
            return;
        }

        $shipping = LM_Shipping_Method::instance();
        if (! $shipping) {
            self::record_error($order, __('No existe una instancia activa del método Estafeta.', 'lm-commerce'));
            return;
        }

        $contents = array();
        foreach ($order->get_items() as $item) {
            $product = $item->get_product();
            if ($product) {
                $contents[] = array('data' => $product, 'quantity' => $item->get_quantity());
            }
        }
        $package = array(
            'contents' => $contents,
            'destination' => array(
                'first_name' => $order->get_shipping_first_name() ?: $order->get_billing_first_name(),
                'last_name' => $order->get_shipping_last_name() ?: $order->get_billing_last_name(),
                'address' => $order->get_shipping_address_1() ?: $order->get_billing_address_1(),
                'address_2' => $order->get_shipping_address_2() ?: $order->get_billing_address_2(),
                'city' => $order->get_shipping_city() ?: $order->get_billing_city(),
                'state' => $order->get_shipping_state() ?: $order->get_billing_state(),
                'country' => $order->get_shipping_country() ?: $order->get_billing_country(),
                'postcode' => $order->get_shipping_postcode() ?: $order->get_billing_postcode(),
                'phone' => $order->get_billing_phone(),
                'email' => $order->get_billing_email(),
            ),
        );
        $payload = LM_Shipping_Method::build_rate_payload($package, $shipping->origin());
        $service = self::selected_service($order);
        if ('' === $service) {
            $rates = $client->rates($payload);
            if (is_wp_error($rates) || empty($rates[0]['service'])) {
                self::record_error($order, is_wp_error($rates) ? $rates->get_error_message() : __('No se encontró una tarifa Estafeta.', 'lm-commerce'));
                return;
            }
            $service = (string) $rates[0]['service'];
        }

        $payload['shipment']['service'] = $service;
        $payload['settings'] = array(
            'currency' => 'MXN',
            'printFormat' => 'PDF',
            'printSize' => 'STOCK_4X6',
            'comments' => 'Pedido ' . $order->get_order_number(),
        );
        $response = $client->generate_label($payload);
        if (is_wp_error($response)) {
            self::record_error($order, $response->get_error_message());
            return;
        }

        $row = $response['data'] ?? $response;
        if (isset($row[0]) && is_array($row[0])) {
            $row = $row[0];
        }
        if (! is_array($row)) {
            self::record_error($order, __('Envia.com no devolvió los datos de la guía.', 'lm-commerce'));
            return;
        }
        $shipment_id = (string) ($row['shipmentId'] ?? $row['shipment_id'] ?? $row['id'] ?? '');
        $tracking = (string) ($row['trackingNumber'] ?? $row['tracking_number'] ?? $row['tracking'] ?? '');
        $label = (string) ($row['label'] ?? $row['labelUrl'] ?? $row['label_url'] ?? '');
        if ('' === $shipment_id && '' === $tracking) {
            self::record_error($order, __('Envia.com respondió sin identificador ni número de rastreo.', 'lm-commerce'));
            return;
        }

        $order->update_meta_data('_lm_envia_shipment_id', sanitize_text_field($shipment_id));
        $order->update_meta_data('_lm_envia_tracking', sanitize_text_field($tracking));
        $order->update_meta_data('_lm_envia_label_url', esc_url_raw($label));
        $order->update_meta_data('_lm_envia_service', sanitize_text_field($service));
        $order->delete_meta_data('_lm_envia_lock');
        $order->delete_meta_data('_lm_envia_last_error');
        $order->save();
        $note = sprintf(__('Guía Estafeta generada. Rastreo: %s', 'lm-commerce'), $tracking ?: $shipment_id);
        if ($label) {
            $note .= ' · ' . esc_url_raw($label);
        }
        $order->add_order_note($note);
    }

    public static function order_actions(array $actions, WC_Order $order): array
    {
        if (! $order->get_meta('_lm_envia_shipment_id')) {
            $actions['lm_ready_to_ship'] = __('Marcar listo y generar guía Estafeta', 'lm-commerce');
            $actions['lm_retry_label'] = __('Reintentar guía Estafeta', 'lm-commerce');
        } else {
            $actions['lm_cancel_label'] = __('Cancelar guía Estafeta', 'lm-commerce');
        }
        return $actions;
    }

    public static function mark_ready(WC_Order $order): void
    {
        $order->update_status(self::STATUS, __('Pedido preparado; se solicitará la guía automáticamente.', 'lm-commerce'));
    }

    public static function retry_label(WC_Order $order): void
    {
        $order->delete_meta_data('_lm_envia_lock');
        $order->save();
        self::queue_label($order->get_id(), $order);
    }

    public static function cancel_label(WC_Order $order): void
    {
        $shipment_id = (string) $order->get_meta('_lm_envia_shipment_id');
        if ('' === $shipment_id) {
            return;
        }
        $result = (new LM_Envia_Client())->cancel($shipment_id);
        if (is_wp_error($result)) {
            $order->add_order_note(sprintf(__('No se pudo cancelar la guía: %s', 'lm-commerce'), $result->get_error_message()));
            return;
        }
        $order->add_order_note(__('Guía Estafeta cancelada en Envia.com.', 'lm-commerce'));
        foreach (array('_lm_envia_shipment_id', '_lm_envia_tracking', '_lm_envia_label_url', '_lm_envia_service') as $key) {
            $order->delete_meta_data($key);
        }
        $order->save();
    }

    public static function customer_tracking(WC_Order $order): void
    {
        self::render_tracking($order);
    }

    public static function email_tracking(WC_Order $order, bool $sent_to_admin, bool $plain_text, $email): void
    {
        if (! $sent_to_admin) {
            self::render_tracking($order, $plain_text);
        }
    }

    private static function render_tracking(WC_Order $order, bool $plain_text = false): void
    {
        $tracking = (string) $order->get_meta('_lm_envia_tracking');
        if ('' === $tracking) {
            return;
        }
        if ($plain_text) {
            echo "\n" . esc_html__('Rastreo Estafeta:', 'lm-commerce') . ' ' . esc_html($tracking) . "\n";
            return;
        }
        echo '<p><strong>' . esc_html__('Rastreo Estafeta:', 'lm-commerce') . '</strong> ' . esc_html($tracking) . '</p>';
    }

    private static function selected_service(WC_Order $order): string
    {
        foreach ($order->get_items('shipping') as $item) {
            $service = (string) $item->get_meta('lm_envia_service', true);
            if ('' === $service) {
                $service = (string) $item->get_meta('_lm_envia_service', true);
            }
            if ('' !== $service) {
                return $service;
            }
        }
        return '';
    }

    private static function record_error(WC_Order $order, string $message): void
    {
        $order->delete_meta_data('_lm_envia_lock');
        $order->update_meta_data('_lm_envia_last_error', sanitize_text_field($message));
        $order->save();
        $order->add_order_note(sprintf(__('No se generó la guía Estafeta: %s', 'lm-commerce'), $message));
    }
}
