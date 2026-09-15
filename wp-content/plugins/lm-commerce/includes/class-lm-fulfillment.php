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
    private const TRACKING_EMAIL_JOB = 'lm_send_estafeta_sandbox_tracking_email';
    private const ASYNC_DELAY = MINUTE_IN_SECONDS;

    public static function init(): void
    {
        add_action('init', array(__CLASS__, 'register_status'));
        add_filter('wc_order_statuses', array(__CLASS__, 'add_status'));
        add_action('woocommerce_order_status_' . self::STATUS, array(__CLASS__, 'queue_label'), 10, 2);
        add_action('woocommerce_payment_complete', array(__CLASS__, 'queue_sandbox_label_after_payment'));
        add_action(self::JOB, array(__CLASS__, 'generate_label'));
        add_action(self::TRACKING_EMAIL_JOB, array(__CLASS__, 'send_sandbox_tracking_email'));
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
        $timestamp = time() + self::ASYNC_DELAY;
        if (function_exists('as_schedule_single_action')) {
            // Do not ask Action Scheduler to run Envia in the same checkout or
            // payment-webhook request. Shared hosting commonly has few PHP
            // workers, so this small delay protects the storefront.
            as_schedule_single_action($timestamp, self::JOB, array($order_id), 'lm-commerce', true);
        } elseif (! wp_next_scheduled(self::JOB, array($order_id))) {
            wp_schedule_single_event($timestamp, self::JOB, array($order_id));
        }
        $order->add_order_note(sprintf(__('La generación de la guía %s fue puesta en cola.', 'lm-commerce'), self::carrier_label($order)));
    }

    /**
     * Sandbox-only convenience for the end-to-end checkout test. Production
     * keeps the deliberate "Listo para enviar" review step, even if an admin
     * accidentally enables this setting there.
     */
    public static function queue_sandbox_label_after_payment(int $order_id): void
    {
        $order = wc_get_order($order_id);
        if (! $order || $order->get_meta('_lm_envia_shipment_id')) {
            return;
        }

        $shipping = LM_Shipping_Method::instance_for_order($order);
        if (! $shipping || ! $shipping->sandbox_auto_label_enabled()) {
            return;
        }

        self::queue_label($order->get_id(), $order);
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

        $shipping = LM_Shipping_Method::instance_for_order($order);
        if (! $shipping) {
            self::record_error($order, __('No existe una instancia activa del método Estafeta.', 'lm-commerce'));
            return;
        }
        $client = $shipping->envia_client();
        if (! $client->configured()) {
            self::record_error($order, __('Falta configurar el token de Envia.com en la zona de envío; no se generó una guía.', 'lm-commerce'));
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
                'number' => LM_Shipping_Method::order_exterior_number($order, 'shipping')
                    ?: LM_Shipping_Method::order_exterior_number($order, 'billing'),
                'city' => $order->get_shipping_city() ?: $order->get_billing_city(),
                'state' => $order->get_shipping_state() ?: $order->get_billing_state(),
                'country' => $order->get_shipping_country() ?: $order->get_billing_country(),
                'postcode' => $order->get_shipping_postcode() ?: $order->get_billing_postcode(),
                'phone' => $order->get_billing_phone(),
                'email' => $order->get_billing_email(),
            ),
        );
        $profile = $shipping->shipment_profile_for_order($order);
        self::persist_shipment_profile($order, $profile);
        $payload = LM_Shipping_Method::build_rate_payload($package, $shipping->origin(), $profile);
        if (is_wp_error($payload)) {
            self::record_error($order, $payload->get_error_message());
            return;
        }
        $quote_service = self::selected_service($order);
        $allowed_service = $profile['service'];
        if (! $profile['requires_rate']) {
            // `enviaPaqueteria / test` is Envia's direct-label demo. It has no
            // rate action, so its fixed service must never call /ship/rate.
            $quote_service = $allowed_service;
        } else {
            if ('' !== $quote_service && $allowed_service !== $quote_service) {
                self::record_error($order, __('El servicio seleccionado no coincide con el servicio autorizado para esta tienda.', 'lm-commerce'));
                return;
            }
            if ('' === $quote_service) {
                $rates = $client->rates($payload);
                if (is_wp_error($rates)) {
                    self::record_error($order, $rates->get_error_message());
                    return;
                }
                $available_services = array_map(static function ($rate): string {
                    return is_array($rate) ? sanitize_key((string) ($rate['service'] ?? '')) : '';
                }, $rates);
                if (! in_array($allowed_service, $available_services, true)) {
                    self::record_error($order, __('No se encontró una tarifa para el servicio autorizado.', 'lm-commerce'));
                    return;
                }
                $quote_service = $allowed_service;
            }
        }

        // /ship/generate requires the same service code selected in the rate response.
        $payload['shipment']['service'] = $quote_service;
        $payload['settings'] = array(
            'currency' => 'MXN',
            'printFormat' => 'PDF',
            'printSize' => 'STOCK_4X6',
            'comments' => 'Pedido ' . $order->get_order_number(),
        );
        $response = $client->generate_label($payload);
        if (is_wp_error($response)) {
            self::record_error($order, $response->get_error_message(), self::envia_error_context($response));
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
        $order->update_meta_data('_lm_envia_quote_service', sanitize_text_field($quote_service));
        $order->update_meta_data('_lm_envia_service', sanitize_text_field($quote_service));
        $order->update_meta_data('_lm_envia_carrier', sanitize_text_field($profile['carrier']));
        $order->update_meta_data('_lm_envia_environment', sanitize_text_field($profile['environment']));
        $order->delete_meta_data('_lm_envia_lock');
        $order->delete_meta_data('_lm_envia_last_error');
        $order->delete_meta_data('_lm_envia_last_error_context');
        $order->save();
        $note = sprintf(__('Guía %1$s generada. Rastreo: %2$s', 'lm-commerce'), self::carrier_label($order), $tracking ?: $shipment_id);
        if ($label) {
            $note .= ' · ' . esc_url_raw($label);
        }
        $order->add_order_note($note);
        self::queue_sandbox_tracking_email($order, $shipping);
    }

    public static function order_actions(array $actions, WC_Order $order): array
    {
        if (! $order->get_meta('_lm_envia_shipment_id')) {
            $actions['lm_ready_to_ship'] = sprintf(__('Marcar listo y generar guía %s', 'lm-commerce'), self::carrier_label($order));
            $actions['lm_retry_label'] = sprintf(__('Reintentar guía %s', 'lm-commerce'), self::carrier_label($order));
        } else {
            $actions['lm_cancel_label'] = sprintf(__('Cancelar guía %s', 'lm-commerce'), self::carrier_label($order));
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
        $shipping = LM_Shipping_Method::instance_for_order($order);
        if (! $shipping || ! $shipping->envia_client()->configured()) {
            $order->add_order_note(__('No se pudo cancelar la guía: falta configurar Envia.com en la zona de envío.', 'lm-commerce'));
            return;
        }
        $result = $shipping->envia_client()->cancel($shipment_id);
        if (is_wp_error($result)) {
            $order->add_order_note(sprintf(__('No se pudo cancelar la guía: %s', 'lm-commerce'), $result->get_error_message()));
            return;
        }
        $order->add_order_note(sprintf(__('Guía %s cancelada en Envia.com.', 'lm-commerce'), self::carrier_label($order)));
        foreach (array('_lm_envia_shipment_id', '_lm_envia_tracking', '_lm_envia_label_url', '_lm_envia_quote_service', '_lm_envia_service', '_lm_envia_carrier', '_lm_envia_environment', '_lm_envia_tracking_email_sent', '_lm_envia_last_error', '_lm_envia_last_error_context') as $key) {
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
            echo "\n" . esc_html(sprintf(__('Rastreo %s:', 'lm-commerce'), self::carrier_label($order))) . ' ' . esc_html($tracking) . "\n";
            return;
        }
        echo '<p><strong>' . esc_html(sprintf(__('Rastreo %s:', 'lm-commerce'), self::carrier_label($order))) . '</strong> ' . esc_html($tracking) . '</p>';
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

        $quote_service = (string) $order->get_meta('_lm_envia_quote_service');
        if ('' !== $quote_service) {
            return $quote_service;
        }

        // Compatibility with orders generated before quote and label services
        // were persisted separately.
        return (string) $order->get_meta('_lm_envia_service');
    }

    /**
     * Defer SMTP work too. It is useful for the test, but never part of the
     * payment callback or the Envia label request.
     */
    private static function queue_sandbox_tracking_email(WC_Order $order, LM_Shipping_Method $shipping): void
    {
        if (! $shipping->sandbox_tracking_email_enabled() || $order->get_meta('_lm_envia_tracking_email_sent')) {
            return;
        }

        $args = array($order->get_id());
        if (function_exists('as_has_scheduled_action') && as_has_scheduled_action(self::TRACKING_EMAIL_JOB, $args, 'lm-commerce')) {
            return;
        }

        $timestamp = time() + self::ASYNC_DELAY;
        if (function_exists('as_schedule_single_action')) {
            as_schedule_single_action($timestamp, self::TRACKING_EMAIL_JOB, $args, 'lm-commerce', true);
        } elseif (! wp_next_scheduled(self::TRACKING_EMAIL_JOB, $args)) {
            wp_schedule_single_event($timestamp, self::TRACKING_EMAIL_JOB, $args);
        }
    }

    /**
     * Send one unmistakably sandbox-only shipment email after the label exists.
     * It uses WooCommerce's normal header and footer so the test mirrors the
     * customer experience without registering an extra persistent email type.
     */
    public static function send_sandbox_tracking_email(int $order_id): void
    {
        $order = wc_get_order($order_id);
        if (! $order) {
            return;
        }
        $shipping = LM_Shipping_Method::instance_for_order($order);
        if (! $shipping->sandbox_tracking_email_enabled() || $order->get_meta('_lm_envia_tracking_email_sent')) {
            return;
        }

        $recipient = sanitize_email((string) $order->get_billing_email());
        $tracking = (string) $order->get_meta('_lm_envia_tracking');
        if (! is_email($recipient) || '' === $tracking || ! function_exists('WC')) {
            return;
        }

        $label = esc_url((string) $order->get_meta('_lm_envia_label_url'));
        $heading = __('Guía de prueba generada', 'lm-commerce');
        ob_start();
        wc_get_template('emails/email-header.php', array('email_heading' => $heading));
        echo '<p>' . esc_html(sprintf(__('La guía de prueba para el pedido #%s fue generada correctamente.', 'lm-commerce'), $order->get_order_number())) . '</p>';
        echo '<p><strong>' . esc_html(sprintf(__('Rastreo %s:', 'lm-commerce'), self::carrier_label($order))) . '</strong> ' . esc_html($tracking) . '</p>';
        if ('' !== $label) {
            echo '<p><a href="' . $label . '">' . esc_html__('Abrir etiqueta de prueba (PDF)', 'lm-commerce') . '</a></p>';
        }
        echo '<p><em>' . esc_html__('Este correo pertenece al entorno de pruebas. La guía no es válida para realizar un envío real.', 'lm-commerce') . '</em></p>';
        wc_get_template('emails/email-footer.php');
        $content = (string) ob_get_clean();

        $subject = sprintf(__('Guía de prueba generada — pedido #%s', 'lm-commerce'), $order->get_order_number());
        if (wc_mail($recipient, $subject, $content, array('Content-Type: text/html; charset=UTF-8'))) {
            $order->update_meta_data('_lm_envia_tracking_email_sent', time());
            $order->save();
            $order->add_order_note(__('Correo de guía de prueba enviado al cliente.', 'lm-commerce'));
        }
    }

    /**
     * @return array<string, string>
     */
    private static function envia_error_context(WP_Error $error): array
    {
        $data = $error->get_error_data();
        if (! is_array($data)) {
            return array();
        }

        return array_filter(array(
            'code' => sanitize_text_field((string) ($data['code'] ?? '')),
            'reference' => sanitize_text_field((string) ($data['reference'] ?? '')),
            'description' => sanitize_text_field((string) ($data['description'] ?? '')),
        ));
    }

    /**
     * @param array<string, string> $context
     */
    private static function record_error(WC_Order $order, string $message, array $context = array()): void
    {
        $order->delete_meta_data('_lm_envia_lock');
        $order->update_meta_data('_lm_envia_last_error', sanitize_text_field($message));
        if ($context) {
            $order->update_meta_data('_lm_envia_last_error_context', wp_json_encode($context));
        } else {
            $order->delete_meta_data('_lm_envia_last_error_context');
        }
        $order->save();
        $note = sprintf(__('No se generó la guía %1$s: %2$s', 'lm-commerce'), self::carrier_label($order), $message);
        if (isset($context['code'])) {
            $note .= ' · Código Envia: ' . $context['code'];
        }
        if (isset($context['reference'])) {
            $note .= ' · Referencia: ' . $context['reference'];
        }
        $order->add_order_note($note);
    }

    private static function carrier_label(WC_Order $order): string
    {
        $shipping = LM_Shipping_Method::instance_for_order($order);

        return $shipping
            ? $shipping->carrier_label($shipping->shipment_profile_for_order($order))
            : 'Estafeta';
    }

    /**
     * Bind legacy orders to their profile before their first retry. New orders
     * already receive these values with their shipping rate metadata.
     *
     * @param array{carrier: string, service: string, environment: string, label: string, requires_rate: bool} $profile
     */
    private static function persist_shipment_profile(WC_Order $order, array $profile): void
    {
        foreach ($order->get_items('shipping') as $item) {
            if ('lm_estafeta_envia' !== $item->get_method_id()) {
                continue;
            }
            $item->update_meta_data('lm_envia_carrier', $profile['carrier']);
            $item->update_meta_data('lm_envia_environment', $profile['environment']);
            $item->save();
        }
    }
}
