<?php
/**
 * Shipping-package metadata kept separate from customer-facing product dimensions.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Packaging
{
    private const FIELDS = array(
        '_lm_package_name' => array('label' => 'Caja de envío', 'type' => 'text', 'placeholder' => 'Caja grande plana'),
        '_lm_package_weight_kg' => array('label' => 'Peso con embalaje (kg)', 'type' => 'number', 'placeholder' => '0.0'),
        '_lm_package_length_cm' => array('label' => 'Largo de caja (cm)', 'type' => 'number', 'placeholder' => '0'),
        '_lm_package_width_cm' => array('label' => 'Ancho de caja (cm)', 'type' => 'number', 'placeholder' => '0'),
        '_lm_package_height_cm' => array('label' => 'Alto de caja (cm)', 'type' => 'number', 'placeholder' => '0'),
    );

    public static function init(): void
    {
        add_action('woocommerce_product_options_shipping', array(__CLASS__, 'simple_fields'));
        add_action('woocommerce_process_product_meta', array(__CLASS__, 'save_simple_fields'));
        add_action('woocommerce_product_after_variable_attributes', array(__CLASS__, 'variation_fields'), 10, 3);
        add_action('woocommerce_save_product_variation', array(__CLASS__, 'save_variation_fields'), 10, 2);
    }

    public static function simple_fields(): void
    {
        echo '<div class="options_group">';
        echo '<p class="form-field"><strong>' . esc_html__('Embalaje para envío', 'lm-commerce') . '</strong><br><span class="description">' . esc_html__('Se usa para cotizar y generar la guía. No modifica las medidas visibles de la pieza.', 'lm-commerce') . '</span></p>';
        foreach (self::FIELDS as $key => $field) {
            woocommerce_wp_text_input(array(
                'id' => $key,
                'label' => __($field['label'], 'lm-commerce'),
                'type' => $field['type'],
                'placeholder' => $field['placeholder'],
                'custom_attributes' => 'number' === $field['type'] ? array('min' => '0', 'step' => '0.01') : array(),
            ));
        }
        echo '</div>';
    }

    public static function save_simple_fields(int $product_id): void
    {
        self::save_fields($product_id, $_POST);
    }

    public static function variation_fields(int $loop, array $variation_data, WP_Post $variation): void
    {
        unset($variation_data);
        echo '<div class="form-row form-row-full"><strong>' . esc_html__('Embalaje para envío', 'lm-commerce') . '</strong><p class="description">' . esc_html__('Usado únicamente por Envia.com.', 'lm-commerce') . '</p></div>';
        foreach (self::FIELDS as $key => $field) {
            woocommerce_wp_text_input(array(
                'id' => $key . '[' . $loop . ']',
                'name' => $key . '[' . $loop . ']',
                'label' => __($field['label'], 'lm-commerce'),
                'type' => $field['type'],
                'placeholder' => $field['placeholder'],
                'value' => get_post_meta($variation->ID, $key, true),
                'wrapper_class' => 'form-row form-row-first',
                'custom_attributes' => 'number' === $field['type'] ? array('min' => '0', 'step' => '0.01') : array(),
            ));
        }
    }

    public static function save_variation_fields(int $variation_id, int $loop): void
    {
        self::save_fields($variation_id, $_POST, $loop);
    }

    /**
     * @return array{name: string, weight: float, length: float, width: float, height: float}
     */
    public static function for_product(WC_Product $product): array
    {
        $source = $product;
        if ($product instanceof WC_Product_Variation && ! self::has_package($product)) {
            $parent = wc_get_product($product->get_parent_id());
            if ($parent instanceof WC_Product) {
                $source = $parent;
            }
        }

        return array(
            'name' => (string) $source->get_meta('_lm_package_name', true),
            'weight' => self::positive($source->get_meta('_lm_package_weight_kg', true), wc_get_weight($product->get_weight() ?: 0.1, 'kg'), 0.1),
            'length' => self::positive($source->get_meta('_lm_package_length_cm', true), wc_get_dimension($product->get_length() ?: 1, 'cm'), 1.0),
            'width' => self::positive($source->get_meta('_lm_package_width_cm', true), wc_get_dimension($product->get_width() ?: 1, 'cm'), 1.0),
            'height' => self::positive($source->get_meta('_lm_package_height_cm', true), wc_get_dimension($product->get_height() ?: 1, 'cm'), 1.0),
        );
    }

    public static function apply_from_catalog(WC_Product $product, array $row): void
    {
        $mapping = array(
            '_lm_package_name' => $row['package_name'] ?? '',
            '_lm_package_weight_kg' => $row['package_weight_kg'] ?? '',
            '_lm_package_length_cm' => $row['package_length_cm'] ?? '',
            '_lm_package_width_cm' => $row['package_width_cm'] ?? '',
            '_lm_package_height_cm' => $row['package_height_cm'] ?? '',
        );
        foreach ($mapping as $key => $value) {
            $product->update_meta_data($key, sanitize_text_field((string) $value));
        }
    }

    private static function save_fields(int $product_id, array $request, ?int $loop = null): void
    {
        foreach (self::FIELDS as $key => $field) {
            $value = $request[$key] ?? '';
            if (null !== $loop && is_array($value)) {
                $value = $value[$loop] ?? '';
            }
            $value = 'number' === $field['type'] ? wc_format_decimal(wp_unslash((string) $value)) : sanitize_text_field(wp_unslash((string) $value));
            if ('' === $value) {
                delete_post_meta($product_id, $key);
            } else {
                update_post_meta($product_id, $key, $value);
            }
        }
    }

    private static function has_package(WC_Product $product): bool
    {
        return '' !== (string) $product->get_meta('_lm_package_length_cm', true)
            && '' !== (string) $product->get_meta('_lm_package_width_cm', true)
            && '' !== (string) $product->get_meta('_lm_package_height_cm', true);
    }

    private static function positive($value, $fallback, float $minimum): float
    {
        $number = is_numeric($value) ? (float) $value : (float) $fallback;
        return max($minimum, $number);
    }
}
