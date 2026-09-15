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
    private const ADDRESS_DETAILS_FIELD = 'lm-commerce/delivery-details';

    public static function init(): void
    {
        // The Checkout Block supports this country-locale filter, unlike the
        // legacy checkout-fields filters. Keep the data in WooCommerce's
        // native address lines so Envia's official extension receives it.
        add_filter('woocommerce_get_country_locale', array(__CLASS__, 'mexican_locale'));
        add_action('woocommerce_init', array(__CLASS__, 'register_address_details_field'));
        add_action('woocommerce_store_api_checkout_order_processed', array(__CLASS__, 'sync_address_details_to_order'));
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
            // The visible optional line below is registered through the
            // Checkout Fields API. Hide WooCommerce's compact add-address-2
            // toggle so customers see exactly two address lines.
            'required' => false,
            'hidden' => true,
        ));

        $locales['MX'] = $mexico;

        return $locales;
    }

    public static function register_address_details_field(): void
    {
        if (! function_exists('woocommerce_register_additional_checkout_field')) {
            return;
        }

        woocommerce_register_additional_checkout_field(array(
            'id' => self::ADDRESS_DETAILS_FIELD,
            'label' => __('Interior, departamento o referencias', 'lm-commerce'),
            'location' => 'address',
            'type' => 'text',
            'required' => false,
            'attributes' => array(
                'autocomplete' => 'address-line2',
                'maxlength' => '120',
                'placeholder' => __('Ej. Int. 4, portón negro', 'lm-commerce'),
            ),
            // The data appears through WooCommerce's normal address line in
            // order confirmations after it is synchronized below.
            'show_in_order_confirmation' => false,
        ));
    }

    public static function sync_address_details_to_order(WC_Order $order): void
    {
        if (! class_exists('Automattic\\WooCommerce\\Blocks\\Package')
            || ! class_exists('Automattic\\WooCommerce\\Blocks\\Domain\\Services\\CheckoutFields')) {
            return;
        }

        try {
            $checkout_fields = \Automattic\WooCommerce\Blocks\Package::container()->get(
                \Automattic\WooCommerce\Blocks\Domain\Services\CheckoutFields::class
            );
            $shipping = sanitize_text_field((string) $checkout_fields->get_field_from_object(self::ADDRESS_DETAILS_FIELD, $order, 'shipping'));
            $billing = sanitize_text_field((string) $checkout_fields->get_field_from_object(self::ADDRESS_DETAILS_FIELD, $order, 'billing'));
        } catch (Throwable $error) {
            unset($error);
            return;
        }

        $changed = false;
        if ($order->get_shipping_address_2() !== $shipping) {
            $order->set_shipping_address_2($shipping);
            $changed = true;
        }
        if ($order->get_billing_address_2() !== $billing) {
            $order->set_billing_address_2($billing);
            $changed = true;
        }
        if ($changed) {
            $order->save();
        }
    }
}
