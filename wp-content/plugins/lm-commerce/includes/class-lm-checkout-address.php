<?php
/**
 * Mexican checkout address labels compatible with Envia's WooCommerce app.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Checkout_Address
{
    public static function init(): void
    {
        // The Checkout Block supports this country-locale filter, unlike the
        // legacy checkout-fields filters. Keep the data in WooCommerce's
        // native address lines so Envia's official extension receives it.
        add_filter('woocommerce_get_country_locale', array(__CLASS__, 'mexican_locale'));
    }

    /**
     * @param array<string, array<string, array<string, mixed>>> $locales
     * @return array<string, array<string, array<string, mixed>>>
     */
    public static function mexican_locale(array $locales): array
    {
        $mexico = isset($locales['MX']) && is_array($locales['MX']) ? $locales['MX'] : array();
        $address_1 = isset($mexico['address_1']) && is_array($mexico['address_1']) ? $mexico['address_1'] : array();
        $address_2 = isset($mexico['address_2']) && is_array($mexico['address_2']) ? $mexico['address_2'] : array();

        $mexico['address_1'] = array_merge($address_1, array(
            'label' => __('Dirección', 'lm-commerce'),
            'placeholder' => __('Ej. Emilio Carranza 107, Col. Centro', 'lm-commerce'),
            'required' => true,
            'hidden' => false,
        ));

        $mexico['address_2'] = array_merge($address_2, array(
            'label' => __('Interior, departamento o referencias', 'lm-commerce'),
            'placeholder' => __('Ej. Int. 4, portón negro', 'lm-commerce'),
            'required' => false,
            'hidden' => false,
        ));

        $locales['MX'] = $mexico;

        return $locales;
    }
}
