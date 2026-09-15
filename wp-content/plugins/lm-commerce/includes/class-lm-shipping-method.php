<?php
/**
 * Estafeta shipping method backed by Envia.com.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Shipping_Method extends WC_Shipping_Method
{
    private const EXTERIOR_NUMBER_FIELD = 'lm-commerce/numero-exterior';

    public function __construct(int $instance_id = 0)
    {
        $this->id = 'lm_estafeta_envia';
        $this->instance_id = absint($instance_id);
        $this->method_title = __('Estafeta mediante Envia.com', 'lm-commerce');
        $this->method_description = __('Cotización nacional de Estafeta en tiempo real mediante Envia.com.', 'lm-commerce');
        $this->supports = array('shipping-zones', 'instance-settings');
        $this->init();
    }

    private function init(): void
    {
        $this->instance_form_fields = array(
            'enabled' => array(
                'title' => __('Activar', 'lm-commerce'),
                'type' => 'checkbox',
                'label' => __('Ofrecer Estafeta en esta zona', 'lm-commerce'),
                'default' => 'yes',
            ),
            'title' => array(
                'title' => __('Nombre visible', 'lm-commerce'),
                'type' => 'text',
                'default' => __('Envío Estafeta', 'lm-commerce'),
            ),
            'environment' => array(
                'title' => __('Entorno de Envia.com', 'lm-commerce'),
                'type' => 'select',
                'default' => 'sandbox',
                'options' => array(
                    'sandbox' => __('Pruebas (sandbox)', 'lm-commerce'),
                    'production' => __('Producción', 'lm-commerce'),
                ),
                'description' => __('Usa pruebas hasta validar el flujo completo. Producción puede generar cargos y guías reales.', 'lm-commerce'),
                'desc_tip' => true,
            ),
            'service_code' => array(
                'title' => __('Servicio Estafeta en producción', 'lm-commerce'),
                'type' => 'text',
                'default' => 'ground',
                'description' => __('Para Estafeta Terrestre usa <code>ground</code>. El sandbox usa automáticamente el carrier demo de Envia.com; este valor sólo se usa en producción.', 'lm-commerce'),
                'desc_tip' => true,
            ),
            'auto_generate_sandbox_label' => array(
                'title' => __('Automatización de pruebas', 'lm-commerce'),
                'type' => 'checkbox',
                'label' => __('Generar automáticamente una guía de prueba cuando Mercado Pago acredite el pedido', 'lm-commerce'),
                'default' => 'no',
                'description' => __('Sólo funciona en el entorno Pruebas (sandbox). En producción este ajuste no genera guías.', 'lm-commerce'),
                'desc_tip' => true,
            ),
            'send_sandbox_tracking_email' => array(
                'title' => __('Correo de pruebas', 'lm-commerce'),
                'type' => 'checkbox',
                'label' => __('Enviar al cliente el aviso de guía de prueba generada', 'lm-commerce'),
                'default' => 'yes',
                'description' => __('El aviso identifica explícitamente que no es un envío real. Sólo se usa junto con la automatización sandbox.', 'lm-commerce'),
                'desc_tip' => true,
            ),
            'api_token' => array(
                'title' => __('Token API de Envia.com', 'lm-commerce'),
                'type' => 'password',
                'default' => '',
                'description' => __('Pega el token del entorno seleccionado. Déjalo vacío al guardar para conservar el token actual.', 'lm-commerce'),
                'desc_tip' => true,
            ),
            'origin_name' => array('title' => __('Remitente', 'lm-commerce'), 'type' => 'text', 'default' => 'Lupita Márquez'),
            'origin_phone' => array('title' => __('Teléfono de origen', 'lm-commerce'), 'type' => 'text', 'default' => '5555555555'),
            'origin_email' => array('title' => __('Correo de origen', 'lm-commerce'), 'type' => 'email', 'default' => get_option('admin_email')),
            'origin_street' => array('title' => __('Calle de origen', 'lm-commerce'), 'type' => 'text', 'default' => 'Dirección demo'),
            'origin_number' => array(
                'title' => __('Número exterior de origen', 'lm-commerce'),
                'type' => 'text',
                'default' => '',
                'description' => __('Ejemplo: para “Emilio Carranza 107”, escribe calle “Emilio Carranza” y número “107”.', 'lm-commerce'),
                'desc_tip' => true,
            ),
            'origin_city' => array('title' => __('Ciudad de origen', 'lm-commerce'), 'type' => 'text', 'default' => 'Ciudad de México'),
            'origin_state' => array('title' => __('Estado de origen', 'lm-commerce'), 'type' => 'text', 'default' => 'CX'),
            'origin_postcode' => array('title' => __('Código postal de origen', 'lm-commerce'), 'type' => 'text', 'default' => '03100'),
        );

        $this->init_settings();
        $this->enabled = (string) $this->get_option('enabled', 'yes');
        $this->title = (string) $this->get_option('title', __('Envío Estafeta', 'lm-commerce'));
        add_action('woocommerce_update_options_shipping_' . $this->id, array($this, 'process_admin_options'));
        add_filter('woocommerce_no_shipping_available_html', array(__CLASS__, 'no_shipping_message'), 10, 2);
        add_filter('woocommerce_cart_no_shipping_available_html', array(__CLASS__, 'no_shipping_message'), 10, 2);
    }

    public function calculate_shipping($package = array()): void
    {
        if ('yes' !== $this->enabled || 'MX' !== ($package['destination']['country'] ?? 'MX')) {
            return;
        }

        $profile = $this->shipment_profile();
        $payload = self::build_rate_payload($package, $this->origin(), $profile);
        if (is_wp_error($payload)) {
            return;
        }
        if (! $profile['requires_rate']) {
            // Envia's demo carrier intentionally has no /ship/rate action.
            // Its fixed zero-cost sandbox service exists solely to exercise
            // checkout, label creation, tracking, and notification flows.
            $this->add_rate(array(
                'id' => $this->get_rate_id() . ':' . $profile['service'],
                'label' => $this->rate_title($profile),
                'cost' => '0',
                'package' => $package,
                'meta_data' => array(
                    'lm_envia_service' => $profile['service'],
                    'lm_envia_carrier' => $profile['carrier'],
                    'lm_envia_environment' => $profile['environment'],
                    'lm_envia_fallback' => 'no',
                ),
            ));
            return;
        }
        $cache_key = 'lm_rate_' . md5(wp_json_encode($payload));
        $rates = get_transient($cache_key);

        if (false === $rates) {
            $rates = $this->envia_client()->rates($payload);
            if (! is_wp_error($rates)) {
                set_transient($cache_key, $rates, 10 * MINUTE_IN_SECONDS);
            }
        }

        if (! is_wp_error($rates) && ! empty($rates)) {
            $service = $profile['service'];
            $rates = array_values(array_filter($rates, static function ($rate) use ($service): bool {
                return is_array($rate) && $service === sanitize_key((string) ($rate['service'] ?? ''));
            }));

            foreach ($rates as $rate) {
                $delivery = $rate['delivery'] ? ' · ' . $rate['delivery'] : '';
                $this->add_rate(array(
                    'id' => $this->get_rate_id() . ':' . $rate['service'],
                    'label' => $this->rate_title($profile) . ' — ' . $rate['label'] . $delivery,
                    'cost' => wc_format_decimal($rate['price']),
                    'package' => $package,
                    'meta_data' => array(
                        'lm_envia_service' => $rate['service'],
                        'lm_envia_carrier' => $profile['carrier'],
                        'lm_envia_environment' => $profile['environment'],
                        'lm_envia_fallback' => 'no',
                    ),
                ));
            }
            return;
        }

        // Never accept an order using an invented shipping amount. WooCommerce
        // will disable checkout while a shippable cart has no available rate.
    }

    /**
     * Explain why checkout is blocked when Envia.com cannot return a live rate.
     *
     * @param string $html Existing WooCommerce message.
     * @param array<string, mixed> $package Shipping package when supplied by WooCommerce.
     */
    public static function no_shipping_message(string $html, array $package = array()): string
    {
        unset($package);

        return wp_kses_post(
            __('No pudimos cotizar tu envío con Estafeta. Verifica código postal, calle y número exterior e inténtalo nuevamente; el pedido no se puede completar sin una tarifa confirmada.', 'lm-commerce')
        );
    }

    /**
     * @return array<string, string>
     */
    public function origin(): array
    {
        return array(
            'name' => (string) $this->get_option('origin_name', 'Lupita Márquez'),
            'company' => 'Lupita Márquez',
            'phone' => (string) $this->get_option('origin_phone', ''),
            'email' => (string) $this->get_option('origin_email', get_option('admin_email')),
            'street' => (string) $this->get_option('origin_street', ''),
            'number' => (string) $this->get_option('origin_number', ''),
            'city' => (string) $this->get_option('origin_city', ''),
            'state' => self::envia_state_code((string) $this->get_option('origin_state', 'CX')),
            'country' => 'MX',
            'postalCode' => (string) $this->get_option('origin_postcode', '03100'),
        );
    }

    public function envia_client(): LM_Envia_Client
    {
        return new LM_Envia_Client(
            (string) $this->get_option('api_token', ''),
            (string) $this->get_option('environment', 'sandbox')
        );
    }

    /**
     * @return array{carrier: string, service: string, environment: string, label: string, requires_rate: bool}
     */
    public function shipment_profile(): array
    {
        return $this->profile_for_environment($this->environment());
    }

    /**
     * Reuse the profile saved at checkout, so a sandbox retry can never turn
     * into a production label after an administrator changes this setting.
     *
     * @return array{carrier: string, service: string, environment: string, label: string, requires_rate: bool}
     */
    public function shipment_profile_for_order(WC_Order $order): array
    {
        foreach ($order->get_items('shipping') as $item) {
            $environment = (string) $item->get_meta('lm_envia_environment', true);
            if (in_array($environment, array('sandbox', 'production'), true)) {
                return $this->profile_for_environment($environment);
            }
        }

        return $this->shipment_profile();
    }

    /**
     * @param array{carrier: string, service: string, environment: string, label: string, requires_rate: bool} $profile
     */
    public function rate_title(array $profile): string
    {
        return 'sandbox' === $profile['environment']
            ? __('Envío de prueba Envia.com', 'lm-commerce')
            : $this->title;
    }

    /**
     * @param array{carrier: string, service: string, environment: string, label: string, requires_rate: bool} $profile
     */
    public function carrier_label(array $profile): string
    {
        return $profile['label'];
    }

    public function allowed_service(): string
    {
        return $this->shipment_profile()['service'];
    }

    /**
     * @return array{carrier: string, service: string, environment: string, label: string, requires_rate: bool}
     */
    private function profile_for_environment(string $environment): array
    {
        if ('sandbox' === $environment) {
            return array(
                'carrier' => 'enviaPaqueteria',
                'service' => 'test',
                'environment' => 'sandbox',
                'label' => 'Envia.com',
                'requires_rate' => false,
            );
        }

        $service = sanitize_key((string) $this->get_option('service_code', 'ground'));

        return array(
            'carrier' => 'estafeta',
            'service' => '' === $service ? 'ground' : $service,
            'environment' => 'production',
            'label' => 'Estafeta',
            'requires_rate' => true,
        );
    }

    public function environment(): string
    {
        return 'production' === $this->get_option('environment', 'sandbox') ? 'production' : 'sandbox';
    }

    public function sandbox_auto_label_enabled(): bool
    {
        return 'sandbox' === $this->environment()
            && 'yes' === $this->get_option('auto_generate_sandbox_label', 'no');
    }

    public function sandbox_tracking_email_enabled(): bool
    {
        return $this->sandbox_auto_label_enabled()
            && 'yes' === $this->get_option('send_sandbox_tracking_email', 'yes');
    }

    /**
     * Keep a saved API token when the password input is intentionally left blank.
     *
     * @param string $key Field key supplied by WooCommerce.
     * @param string $value Submitted field value.
     */
    public function validate_api_token_field(string $key, string $value): string
    {
        $token = trim(sanitize_text_field($value));

        return '' === $token ? (string) $this->get_option($key, '') : $token;
    }

    public static function instance(): ?self
    {
        $zones = WC_Shipping_Zones::get_zones();
        $zones[] = array('shipping_methods' => WC_Shipping_Zones::get_zone(0)->get_shipping_methods());
        foreach ($zones as $zone) {
            foreach ($zone['shipping_methods'] ?? array() as $method) {
                if ($method instanceof self) {
                    return $method;
                }
            }
        }
        return null;
    }

    public static function instance_for_order(WC_Order $order): ?self
    {
        foreach ($order->get_items('shipping') as $item) {
            if ('lm_estafeta_envia' !== $item->get_method_id()) {
                continue;
            }
            $instance_id = method_exists($item, 'get_instance_id') ? (int) $item->get_instance_id() : 0;
            return new self($instance_id);
        }

        return self::instance();
    }

    /**
     * A structured exterior number makes Envia label generation deterministic.
     * The Checkout Block persists address fields separately for shipping and
     * billing addresses, including for guest orders.
     */
    public static function register_checkout_address_fields(): void
    {
        if (! function_exists('woocommerce_register_additional_checkout_field')) {
            return;
        }

        woocommerce_register_additional_checkout_field(array(
            'id' => self::EXTERIOR_NUMBER_FIELD,
            'label' => __('Número exterior', 'lm-commerce'),
            'location' => 'address',
            'type' => 'text',
            'required' => true,
            'attributes' => array(
                'autocomplete' => 'address-line2',
                'maxlength' => '16',
            ),
        ));
    }

    public static function build_rate_payload(array $package, array $origin, array $shipment = array())
    {
        $destination = $package['destination'] ?? array();
        $origin = self::canonical_address($origin, 'Lupita Márquez');
        if ('' === $origin['number']) {
            return new WP_Error('lm_envia_missing_origin_number', __('Falta configurar el número exterior de origen para cotizar con Estafeta.', 'lm-commerce'));
        }

        $destination_number = trim((string) ($destination['number'] ?? ''));
        if ('' === $destination_number && function_exists('WC') && WC()->customer) {
            $destination_number = self::customer_exterior_number(WC()->customer, 'shipping');
        }
        $destination_address = self::canonical_address(array(
            'name' => trim((string) (($destination['first_name'] ?? '') . ' ' . ($destination['last_name'] ?? ''))) ?: 'Cliente',
            'phone' => (string) ($destination['phone'] ?? '0000000000'),
            'street' => (string) ($destination['address'] ?? ''),
            'number' => $destination_number,
            'city' => (string) ($destination['city'] ?? ''),
            'state' => self::envia_state_code((string) ($destination['state'] ?? '')),
            'country' => 'MX',
            'postalCode' => (string) ($destination['postcode'] ?? ''),
        ), 'Cliente');
        if ('' === $destination_address['number']) {
            return new WP_Error('lm_envia_missing_destination_number', __('Incluye el número exterior de la dirección de envío para cotizar con Estafeta.', 'lm-commerce'));
        }

        return array(
            // Keep quote requests limited to Envia's documented address schema.
            // Label generation may add print settings separately after checkout.
            'origin' => $origin,
            'destination' => $destination_address,
            'packages' => self::packages_from_contents($package['contents'] ?? array()),
            'shipment' => array(
                'carrier' => in_array(($shipment['carrier'] ?? ''), array('estafeta', 'enviaPaqueteria'), true)
                    ? $shipment['carrier']
                    : 'estafeta',
                'type' => 1,
            ),
        );
    }

    /**
     * Return only fields required by Envia's rate endpoint.
     *
     * @param array<string, mixed> $address
     * @return array<string, string>
     */
    private static function canonical_address(array $address, string $fallback_name): array
    {
        $parts = self::address_parts(
            (string) ($address['street'] ?? ''),
            (string) ($address['number'] ?? '')
        );

        return array(
            'name' => trim((string) ($address['name'] ?? '')) ?: $fallback_name,
            'phone' => self::envia_phone((string) ($address['phone'] ?? '')),
            'street' => $parts['street'],
            'number' => $parts['number'],
            'city' => (string) ($address['city'] ?? ''),
            'state' => self::envia_state_code((string) ($address['state'] ?? '')),
            'country' => (string) ($address['country'] ?? 'MX'),
            'postalCode' => (string) ($address['postalCode'] ?? ''),
        );
    }

    /**
     * New orders supply the number through the address field. This parser is
     * only a compatibility fallback for existing orders and old origin setup.
     * It intentionally never uses address_2, which is reserved for interiors.
     *
     * @return array{street: string, number: string}
     */
    private static function address_parts(string $street, string $number = ''): array
    {
        $street = trim($street);
        $number = trim($number);
        if ('' !== $number) {
            return array('street' => $street, 'number' => sanitize_text_field($number));
        }

        if (preg_match('/^(.+?)\\s*(?:#|no\\.?|num\\.?|n[uú]mero)\\s*([0-9]+(?:[-\\/][A-Za-z0-9]+)?)\\s*$/iu', $street, $matches)
            || preg_match('/^(.+?)\\s+([0-9]+(?:[-\\/][A-Za-z0-9]+)?)\\s*$/u', $street, $matches)) {
            return array(
                'street' => trim((string) $matches[1]),
                'number' => sanitize_text_field((string) $matches[2]),
            );
        }

        return array('street' => $street, 'number' => '');
    }

    private static function customer_exterior_number(WC_Customer $customer, string $group): string
    {
        if (! class_exists('Automattic\\WooCommerce\\Blocks\\Package')
            || ! class_exists('Automattic\\WooCommerce\\Blocks\\Domain\\Services\\CheckoutFields')) {
            return '';
        }

        try {
            $checkout_fields = \Automattic\WooCommerce\Blocks\Package::container()->get(
                \Automattic\WooCommerce\Blocks\Domain\Services\CheckoutFields::class
            );
            return sanitize_text_field((string) $checkout_fields->get_field_from_object(self::EXTERIOR_NUMBER_FIELD, $customer, $group));
        } catch (Throwable $error) {
            unset($error);
            return '';
        }
    }

    public static function order_exterior_number(WC_Order $order, string $group = 'shipping'): string
    {
        if (! class_exists('Automattic\\WooCommerce\\Blocks\\Package')
            || ! class_exists('Automattic\\WooCommerce\\Blocks\\Domain\\Services\\CheckoutFields')) {
            return '';
        }

        try {
            $checkout_fields = \Automattic\WooCommerce\Blocks\Package::container()->get(
                \Automattic\WooCommerce\Blocks\Domain\Services\CheckoutFields::class
            );
            return sanitize_text_field((string) $checkout_fields->get_field_from_object(self::EXTERIOR_NUMBER_FIELD, $order, $group));
        } catch (Throwable $error) {
            unset($error);
            return '';
        }
    }

    /**
     * Envia's Mexican address examples and address manager use E.164 numbers.
     * Store owners commonly enter only the local 10-digit number in WooCommerce.
     */
    private static function envia_phone(string $phone): string
    {
        $phone = preg_replace('/[^0-9+]/', '', trim($phone)) ?: '';
        if (str_starts_with($phone, '+')) {
            return $phone;
        }

        if (preg_match('/^52[0-9]{10}$/', $phone)) {
            return '+' . $phone;
        }

        return preg_match('/^[0-9]{10}$/', $phone) ? '+52' . $phone : $phone;
    }

    /**
     * Envia expects Mexico's carrier state codes, while WooCommerce stores DF for CDMX
     * and administrators may enter an origin as a full state name.
     */
    private static function envia_state_code(string $state): string
    {
        $state = trim($state);
        if ('' === $state) {
            return '';
        }

        if (in_array(strtoupper($state), array('CX', 'DF', 'CDMX'), true)) {
            return 'CX';
        }

        // The origin is in Durango. Do not depend on WC()->countries being
        // initialized when rates are calculated through the Store API.
        if ('DURANGO' === strtoupper($state)) {
            return 'DG';
        }

        if (function_exists('WC') && WC()->countries) {
            foreach (WC()->countries->get_states('MX') as $code => $label) {
                if (sanitize_title($state) === sanitize_title((string) $label)) {
                    return 'DF' === $code ? 'CX' : $code;
                }
            }
        }

        return strtoupper($state);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function packages_from_contents(array $contents): array
    {
        $packages = array();

        foreach ($contents as $item) {
            $product = $item['data'] ?? null;
            if (! $product instanceof WC_Product) {
                continue;
            }
            $quantity = max(1, (int) ($item['quantity'] ?? 1));
            $packaging = LM_Packaging::for_product($product);
            // Lupita Márquez packs each sellable unit in its own box. Do not
            // synthesize a combined parcel: it would understate the rate and
            // could not be reproduced safely when generating the guide.
            for ($i = 0; $i < $quantity; $i++) {
                $packages[] = self::package(
                    $packaging['weight'],
                    $packaging['length'],
                    $packaging['width'],
                    $packaging['height'],
                    (float) $product->get_price()
                );
            }
        }

        return $packages ?: array(self::package(0.1, 1, 1, 1, 1));
    }

    private static function package(float $weight, float $length, float $width, float $height, float $value): array
    {
        return array(
            // Envia sandbox rejects non-UTF-8 package descriptions. Keep this
            // logistics-only value ASCII; the customer-facing product name is
            // never replaced.
            'content' => 'Wood products',
            'amount' => 1,
            'type' => 'box',
            'weight' => round($weight, 2),
            'declaredValue' => round($value, 2),
            'weightUnit' => 'KG',
            'lengthUnit' => 'CM',
            'dimensions' => array(
                'length' => round($length, 2),
                'width' => round($width, 2),
                'height' => round($height, 2),
            ),
        );
    }
}
