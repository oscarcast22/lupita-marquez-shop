<?php
/**
 * Narrow, auditable production operations exposed through the WordPress MCP
 * Adapter. This deliberately does not expose gateway, SMTP, Envia, or user
 * credentials.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Production_Operations
{
    private const CAPABILITY = 'lm_manage_production_ops';
    private const ROLE = 'lm_mcp_operator';
    private const LOG_SOURCE = 'lm-production-ops';
    private const ENVIA_PLUGIN = 'shipping-system-live-rates-fulfillment-envia/enviacom.php';
    private const SMTP_PLUGIN = 'wp-mail-smtp/wp_mail_smtp.php';

    public static function init(): void
    {
        if ('production' !== wp_get_environment_type()) {
            return;
        }

        // Existing active installations do not run the activation hook during
        // a file-only deployment, so provision the idempotent role on first run.
        add_action('init', array(__CLASS__, 'install'), 5);
        add_action('wp_abilities_api_categories_init', array(__CLASS__, 'register_category'));
        add_action('wp_abilities_api_init', array(__CLASS__, 'register_abilities'));
    }

    /**
     * Keep a dedicated, low-privilege account available for the remote MCP
     * proxy. Administrators retain access for setup and recovery.
     */
    public static function install(): void
    {
        $role = get_role(self::ROLE);
        if (! $role) {
            add_role(
                self::ROLE,
                __('LM MCP Operations', 'lm-commerce'),
                array(
                    'read' => true,
                    self::CAPABILITY => true,
                )
            );
            return;
        }

        $role->add_cap(self::CAPABILITY);
    }

    public static function register_category(): void
    {
        if (! function_exists('wp_register_ability_category')) {
            return;
        }

        wp_register_ability_category(
            'lm-commerce-operations',
            array(
                'label' => __('Operaciones de Lupita Márquez', 'lm-commerce'),
                'description' => __('Diagnóstico y operaciones auditables de producción.', 'lm-commerce'),
            )
        );
    }

    public static function register_abilities(): void
    {
        if (! function_exists('wp_register_ability')) {
            return;
        }

        self::register('store-health', __('Salud de tienda', 'lm-commerce'), array(__CLASS__, 'store_health'));
        self::register('checkout-diagnostics', __('Diagnóstico de checkout', 'lm-commerce'), array(__CLASS__, 'checkout_diagnostics'));
        self::register(
            'order-lifecycle',
            __('Estado operativo de pedido', 'lm-commerce'),
            array(__CLASS__, 'order_lifecycle'),
            array(
                'type' => 'object',
                'properties' => array(
                    'order_id' => array('type' => 'integer', 'minimum' => 1),
                ),
                'required' => array('order_id'),
            )
        );
        self::register(
            'operational-alerts',
            __('Alertas operativas', 'lm-commerce'),
            array(__CLASS__, 'operational_alerts'),
            array(
                'type' => 'object',
                'properties' => array(
                    'lookback_hours' => array('type' => 'integer', 'minimum' => 1, 'maximum' => 168),
                ),
            )
        );
        self::register(
            'update-order-status',
            __('Actualizar estado de pedido', 'lm-commerce'),
            array(__CLASS__, 'update_order_status'),
            array(
                'type' => 'object',
                'properties' => array(
                    'order_id' => array('type' => 'integer', 'minimum' => 1),
                    'status' => array(
                        'type' => 'string',
                        'enum' => array('pending', 'on-hold', 'processing', 'completed', 'cancelled', 'refunded', 'failed'),
                    ),
                    'note' => array('type' => 'string', 'maxLength' => 500),
                ),
                'required' => array('order_id', 'status'),
            )
        );
        self::register(
            'send-email-smoke-test',
            __('Enviar prueba SMTP', 'lm-commerce'),
            array(__CLASS__, 'send_email_smoke_test'),
            array(
                'type' => 'object',
                'properties' => array(
                    'recipient' => array('type' => 'string', 'format' => 'email'),
                ),
                'required' => array('recipient'),
            )
        );
    }

    /**
     * @param callable(array<string, mixed>): array<string, mixed> $callback
     * @param array<string, mixed> $input_schema
     */
    private static function register(string $id, string $label, callable $callback, array $input_schema = array()): void
    {
        wp_register_ability(
            'lm-commerce/' . $id,
            array(
                'label' => $label,
                'description' => $label,
                'category' => 'lm-commerce-operations',
                'execute_callback' => $callback,
                'permission_callback' => array(__CLASS__, 'can_operate'),
                'input_schema' => empty($input_schema) ? array('type' => 'object') : $input_schema,
                'output_schema' => array('type' => 'object'),
                'meta' => array(
                    'show_in_rest' => true,
                    'mcp' => array(
                        'public' => true,
                        'type' => 'tool',
                    ),
                ),
            )
        );
    }

    public static function can_operate(): bool
    {
        return current_user_can(self::CAPABILITY) || current_user_can('manage_options');
    }

    /**
     * @return array<string, mixed>
     */
    public static function store_health(array $input = array()): array
    {
        return array(
            'environment' => wp_get_environment_type(),
            'wordpress_version' => get_bloginfo('version'),
            'php_version' => PHP_VERSION,
            'woocommerce_version' => defined('WC_VERSION') ? WC_VERSION : null,
            'envia_active' => self::plugin_active(self::ENVIA_PLUGIN),
            'mercadopago_active' => self::plugin_active('woocommerce-mercadopago/woocommerce-mercadopago.php'),
            'wp_mail_smtp_active' => self::plugin_active(self::SMTP_PLUGIN),
            'mercadopago_reconciliation_next_run' => self::next_run('lm_reconcile_mercadopago_payments'),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public static function checkout_diagnostics(array $input = array()): array
    {
        $gateways = array();
        if (function_exists('WC') && WC()->payment_gateways()) {
            foreach (WC()->payment_gateways()->payment_gateways() as $gateway) {
                if ($gateway instanceof WC_Payment_Gateway) {
                    $gateways[] = array(
                        'id' => $gateway->id,
                        'enabled' => 'yes' === $gateway->enabled,
                    );
                }
            }
        }

        $shipping_methods = array();
        if (class_exists('WC_Shipping_Zones')) {
            foreach (WC_Shipping_Zones::get_zones() as $zone) {
                foreach (($zone['shipping_methods'] ?? array()) as $method) {
                    if ($method instanceof WC_Shipping_Method && 'yes' === $method->enabled) {
                        $shipping_methods[] = array(
                            'zone' => (string) ($zone['zone_name'] ?? ''),
                            'id' => $method->id,
                            'instance_id' => $method->instance_id,
                        );
                    }
                }
            }
        }

        return array(
            'payment_gateways' => $gateways,
            'shipping_methods' => $shipping_methods,
            'envia_plugin_active' => self::plugin_active(self::ENVIA_PLUGIN),
            'customer_processing_email_enabled' => 'yes' === get_option('woocommerce_customer_processing_order_settings_enabled', 'yes'),
            'customer_completed_email_enabled' => 'yes' === get_option('woocommerce_customer_completed_order_settings_enabled', 'yes'),
            'wp_mail_smtp_active' => self::plugin_active(self::SMTP_PLUGIN),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public static function order_lifecycle(array $input): array
    {
        $order = function_exists('wc_get_order') ? wc_get_order(absint($input['order_id'] ?? 0)) : false;
        if (! $order instanceof WC_Order) {
            return array('found' => false);
        }

        $shipping_methods = array();
        foreach ($order->get_shipping_methods() as $method) {
            $shipping_methods[] = array(
                'method_id' => $method->get_method_id(),
                'method_title' => $method->get_method_title(),
            );
        }

        $notes = wc_get_order_notes(array('order_id' => $order->get_id(), 'limit' => 50));
        $has_envia_event = false;
        foreach ($notes as $note) {
            if (is_object($note) && isset($note->content) && str_contains(strtolower((string) $note->content), 'envia')) {
                $has_envia_event = true;
                break;
            }
        }

        return array(
            'found' => true,
            'order_id' => $order->get_id(),
            'order_number' => $order->get_order_number(),
            'status' => $order->get_status(),
            'created_at' => $order->get_date_created()?->date('c'),
            'payment_method' => $order->get_payment_method(),
            'has_mercadopago_payment_reference' => '' !== (string) $order->get_meta('_Mercado_Pago_Payment_IDs', true),
            'shipping_methods' => $shipping_methods,
            'has_envia_order_note' => $has_envia_event,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public static function operational_alerts(array $input = array()): array
    {
        $hours = min(168, max(1, absint($input['lookback_hours'] ?? 24)));
        $alerts = array();
        if (function_exists('wc_get_orders')) {
            $orders = wc_get_orders(array(
                'status' => array('pending', 'on-hold', 'failed'),
                'limit' => 50,
                'return' => 'objects',
                'date_created' => '>' . (time() - ($hours * HOUR_IN_SECONDS)),
            ));
            foreach ($orders as $order) {
                if ($order instanceof WC_Order) {
                    $alerts[] = array(
                        'type' => 'order_requires_review',
                        'order_id' => $order->get_id(),
                        'status' => $order->get_status(),
                        'created_at' => $order->get_date_created()?->date('c'),
                    );
                }
            }
        }

        if (! self::plugin_active(self::ENVIA_PLUGIN)) {
            $alerts[] = array('type' => 'envia_plugin_inactive');
        }
        if (! self::plugin_active(self::SMTP_PLUGIN)) {
            $alerts[] = array('type' => 'wp_mail_smtp_inactive');
        }
        if (! self::next_run('lm_reconcile_mercadopago_payments')) {
            $alerts[] = array('type' => 'mercadopago_reconciliation_unscheduled');
        }

        return array(
            'lookback_hours' => $hours,
            'alerts' => $alerts,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public static function update_order_status(array $input): array
    {
        $order = function_exists('wc_get_order') ? wc_get_order(absint($input['order_id'] ?? 0)) : false;
        $status = sanitize_key((string) ($input['status'] ?? ''));
        if (! $order instanceof WC_Order || ! in_array($status, array('pending', 'on-hold', 'processing', 'completed', 'cancelled', 'refunded', 'failed'), true)) {
            return array('updated' => false, 'reason' => 'invalid_order_or_status');
        }

        $note = sanitize_text_field((string) ($input['note'] ?? ''));
        $order->update_status($status, $note, false);
        self::audit('update_order_status', $order->get_id());

        return array('updated' => true, 'order_id' => $order->get_id(), 'status' => $order->get_status());
    }

    /**
     * @return array<string, mixed>
     */
    public static function send_email_smoke_test(array $input): array
    {
        $recipient = sanitize_email((string) ($input['recipient'] ?? ''));
        if (! is_email($recipient)) {
            return array('accepted' => false, 'reason' => 'invalid_recipient');
        }

        $accepted = wp_mail(
            $recipient,
            sprintf(__('[%s] Prueba de correo transaccional', 'lm-commerce'), wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES)),
            __('Esta es una prueba explícita del transporte de correo de la tienda. La aceptación no sustituye la confirmación de entrega en el buzón.', 'lm-commerce')
        );
        self::audit('send_email_smoke_test');

        return array('accepted' => (bool) $accepted);
    }

    private static function plugin_active(string $plugin): bool
    {
        return in_array($plugin, (array) get_option('active_plugins', array()), true);
    }

    private static function next_run(string $hook): ?string
    {
        $timestamp = wp_next_scheduled($hook);
        return $timestamp ? gmdate('c', $timestamp) : null;
    }

    private static function audit(string $action, int $order_id = 0): void
    {
        if (! function_exists('wc_get_logger')) {
            return;
        }

        wc_get_logger()->info(
            'MCP operation executed: ' . $action,
            array(
                'source' => self::LOG_SOURCE,
                'action' => $action,
                'order_id' => $order_id,
                'user_id' => get_current_user_id(),
            )
        );
    }
}
