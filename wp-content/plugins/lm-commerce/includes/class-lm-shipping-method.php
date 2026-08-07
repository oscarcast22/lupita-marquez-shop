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
    public function __construct(int $instance_id = 0)
    {
        $this->id = 'lm_estafeta_envia';
        $this->instance_id = absint($instance_id);
        $this->method_title = __('Estafeta mediante Envia.com', 'lm-commerce');
        $this->method_description = __('Cotización nacional de Estafeta con tarifa de respaldo configurable.', 'lm-commerce');
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
            'fallback_cost' => array(
                'title' => __('Tarifa de respaldo', 'lm-commerce'),
                'type' => 'price',
                'default' => '299',
                'description' => __('Se utiliza si la API no responde y el pedido queda marcado para revisión.', 'lm-commerce'),
            ),
            'origin_name' => array('title' => __('Remitente', 'lm-commerce'), 'type' => 'text', 'default' => 'Lupita Márquez'),
            'origin_phone' => array('title' => __('Teléfono de origen', 'lm-commerce'), 'type' => 'text', 'default' => '5555555555'),
            'origin_email' => array('title' => __('Correo de origen', 'lm-commerce'), 'type' => 'email', 'default' => get_option('admin_email')),
            'origin_street' => array('title' => __('Calle de origen', 'lm-commerce'), 'type' => 'text', 'default' => 'Dirección demo'),
            'origin_city' => array('title' => __('Ciudad de origen', 'lm-commerce'), 'type' => 'text', 'default' => 'Ciudad de México'),
            'origin_state' => array('title' => __('Estado de origen', 'lm-commerce'), 'type' => 'text', 'default' => 'CX'),
            'origin_postcode' => array('title' => __('Código postal de origen', 'lm-commerce'), 'type' => 'text', 'default' => '03100'),
        );

        $this->init_settings();
        $this->enabled = (string) $this->get_option('enabled', 'yes');
        $this->title = (string) $this->get_option('title', __('Envío Estafeta', 'lm-commerce'));
        add_action('woocommerce_update_options_shipping_' . $this->id, array($this, 'process_admin_options'));
    }

    public function calculate_shipping($package = array()): void
    {
        if ('yes' !== $this->enabled || 'MX' !== ($package['destination']['country'] ?? 'MX')) {
            return;
        }

        $payload = self::build_rate_payload($package, $this->origin());
        $cache_key = 'lm_rate_' . md5(wp_json_encode($payload));
        $rates = get_transient($cache_key);

        if (false === $rates) {
            $rates = (new LM_Envia_Client())->rates($payload);
            if (! is_wp_error($rates)) {
                set_transient($cache_key, $rates, 10 * MINUTE_IN_SECONDS);
            }
        }

        if (! is_wp_error($rates) && ! empty($rates)) {
            foreach (array_slice($rates, 0, 3) as $rate) {
                $delivery = $rate['delivery'] ? ' · ' . $rate['delivery'] : '';
                $this->add_rate(array(
                    'id' => $this->get_rate_id() . ':' . $rate['service'],
                    'label' => $this->title . ' — ' . $rate['label'] . $delivery,
                    'cost' => wc_format_decimal($rate['price']),
                    'package' => $package,
                    'meta_data' => array(
                        'lm_envia_service' => $rate['service'],
                        'lm_envia_fallback' => 'no',
                    ),
                ));
            }
            return;
        }

        $this->add_rate(array(
            'id' => $this->get_rate_id() . ':fallback',
            'label' => $this->title . ' — ' . __('tarifa estimada', 'lm-commerce'),
            'cost' => wc_format_decimal($this->get_option('fallback_cost', '299')),
            'package' => $package,
            'meta_data' => array(
                'lm_envia_service' => '',
                'lm_envia_fallback' => 'yes',
            ),
        ));
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
            'city' => (string) $this->get_option('origin_city', ''),
            'state' => (string) $this->get_option('origin_state', 'CX'),
            'country' => 'MX',
            'postalCode' => (string) $this->get_option('origin_postcode', '03100'),
        );
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

    public static function build_rate_payload(array $package, array $origin): array
    {
        $destination = $package['destination'] ?? array();
        return array(
            'origin' => $origin,
            'destination' => array(
                'name' => trim((string) (($destination['first_name'] ?? '') . ' ' . ($destination['last_name'] ?? ''))) ?: 'Cliente',
                'phone' => (string) ($destination['phone'] ?? '0000000000'),
                'email' => (string) ($destination['email'] ?? get_option('admin_email')),
                'street' => trim((string) (($destination['address'] ?? '') . ' ' . ($destination['address_2'] ?? ''))),
                'city' => (string) ($destination['city'] ?? ''),
                'state' => (string) ($destination['state'] ?? ''),
                'country' => 'MX',
                'postalCode' => (string) ($destination['postcode'] ?? ''),
            ),
            'packages' => self::packages_from_contents($package['contents'] ?? array()),
            'shipment' => array('carrier' => 'estafeta', 'type' => 1),
            'settings' => array('currency' => 'MXN'),
        );
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function packages_from_contents(array $contents): array
    {
        $combined = array('weight' => 0.0, 'length' => 1.0, 'width' => 1.0, 'height' => 0.0, 'declaredValue' => 0.0);
        $separate = array();

        foreach ($contents as $item) {
            $product = $item['data'] ?? null;
            if (! $product instanceof WC_Product) {
                continue;
            }
            $quantity = max(1, (int) ($item['quantity'] ?? 1));
            $weight = max(0.1, (float) wc_get_weight($product->get_weight() ?: 0.1, 'kg'));
            $length = max(1.0, (float) wc_get_dimension($product->get_length() ?: 1, 'cm'));
            $width = max(1.0, (float) wc_get_dimension($product->get_width() ?: 1, 'cm'));
            $height = max(1.0, (float) wc_get_dimension($product->get_height() ?: 1, 'cm'));
            $ship_separately = 'yes' === $product->get_meta('_lm_ship_separately');

            for ($i = 0; $i < $quantity; $i++) {
                if ($ship_separately) {
                    $separate[] = self::package($weight, $length, $width, $height, (float) $product->get_price());
                } else {
                    $combined['weight'] += $weight;
                    $combined['length'] = max($combined['length'], $length);
                    $combined['width'] = max($combined['width'], $width);
                    $combined['height'] += $height;
                    $combined['declaredValue'] += (float) $product->get_price();
                }
            }
        }

        if ($combined['weight'] > 0) {
            array_unshift($separate, self::package(
                $combined['weight'],
                $combined['length'],
                $combined['width'],
                max(1.0, $combined['height']),
                $combined['declaredValue']
            ));
        }

        return $separate ?: array(self::package(0.1, 1, 1, 1, 1));
    }

    private static function package(float $weight, float $length, float $width, float $height, float $value): array
    {
        return array(
            'content' => 'Productos artesanales de madera',
            'amount' => 1,
            'type' => 'box',
            'weight' => round($weight, 2),
            'insurance' => 0,
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
