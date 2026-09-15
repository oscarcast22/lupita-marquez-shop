<?php
/**
 * Plugin Name: LM Commerce
 * Description: Catálogo y operaciones de comercio para Lupita Márquez.
 * Version: 0.8.7
 * Requires at least: 7.0
 * Requires PHP: 8.3
 * WC requires at least: 10.9
 * WC tested up to: 10.9.4
 * Requires Plugins: woocommerce
 * Text Domain: lm-commerce
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

define('LM_COMMERCE_VERSION', '0.8.7');
define('LM_COMMERCE_FILE', __FILE__);
define('LM_COMMERCE_DIR', plugin_dir_path(__FILE__));

require_once LM_COMMERCE_DIR . 'includes/class-lm-envia-admin-compatibility.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-mercadopago-reconciler.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-customer-order-email.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-production-operations.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-demo.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-packaging.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-prelaunch-guard.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-test-catalog.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-validated-catalog.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-product-notices.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-savings-goal.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-contact-form.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-account-experience.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-checkout-address.php';

/**
 * The official Envia extension owns checkout rates and fulfillment in the
 * live store. The legacy client remains available only for non-production
 * diagnostics while the client account is not connected yet.
 */
function lm_commerce_uses_legacy_envia(): bool
{
    return 'production' !== wp_get_environment_type();
}

add_action('before_woocommerce_init', static function (): void {
    if (class_exists(Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
        Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', __FILE__, true);
    }
});

add_action('plugins_loaded', static function (): void {
    LM_Contact_Form::init();

    if (! class_exists('WooCommerce')) {
        return;
    }

    LM_Envia_Admin_Compatibility::init();
    LM_Production_Operations::init();
    LM_Checkout_Address::init();
    if (lm_commerce_uses_legacy_envia()) {
        require_once LM_COMMERCE_DIR . 'includes/class-lm-envia-client.php';
        require_once LM_COMMERCE_DIR . 'includes/class-lm-fulfillment.php';
        require_once LM_COMMERCE_DIR . 'includes/class-lm-shipping-method.php';
        add_action('woocommerce_init', array('LM_Shipping_Method', 'register_checkout_address_fields'));
        LM_Fulfillment::init();
    }
    LM_Mercado_Pago_Reconciler::init();
    LM_Customer_Order_Email::init();
    LM_Demo::init();
    // The official Envia extension reads WooCommerce's native shipping
    // fields in production. The legacy packaging UI is only meaningful for
    // the non-production legacy shipping method.
    if (lm_commerce_uses_legacy_envia()) {
        LM_Packaging::init();
    }
    LM_Prelaunch_Guard::init();
    LM_Validated_Catalog::init();
    LM_Product_Notices::init();
    LM_Savings_Goal::init();
    LM_Account_Experience::init();
});

add_filter('woocommerce_shipping_methods', static function (array $methods): array {
    if (lm_commerce_uses_legacy_envia() && class_exists('LM_Shipping_Method')) {
        $methods['lm_estafeta_envia'] = LM_Shipping_Method::class;
    }
    return $methods;
});

/**
 * Envia's official extension returns its `totalPrice` as the final amount,
 * including the applicable carrier tax. WooCommerce expects a net shipping
 * cost and would otherwise calculate IVA over Envia's gross amount again.
 *
 * Convert only domestic Mexican Envia quotes into their WooCommerce net cost
 * before WooCommerce creates the rate. The corresponding inclusive tax
 * breakdown is supplied explicitly, so the customer-facing shipping total
 * remains exactly the amount quoted by Envia. Product taxes and every other
 * shipping method retain WooCommerce's normal rules.
 *
 * @param float $gross_cost Envia's carrier-tax-inclusive quote.
 * @return array{cost: string, taxes: array<int|string, float>}|null
 */
function lm_commerce_get_envia_inclusive_rate_adjustment(float $gross_cost): ?array
{
    $shipping_tax_rates = WC_Tax::get_shipping_tax_rates();
    if (empty($shipping_tax_rates)) {
        return null;
    }

    $taxes      = WC_Tax::calc_tax($gross_cost, $shipping_tax_rates, true);

    if (empty($taxes)) {
        return null;
    }

    return array(
        'cost'  => wc_format_decimal($gross_cost - array_sum($taxes)),
        'taxes' => $taxes,
    );
}

/**
 * Normalize Envia rates made through WooCommerce's normal shipping-method API.
 *
 * @param array<string, mixed> $args   Arguments for the shipping rate.
 * @param WC_Shipping_Method   $method Shipping method creating the rate.
 * @return array<string, mixed>
 */
add_filter('woocommerce_shipping_method_add_rate_args', static function (array $args, WC_Shipping_Method $method): array {
    if ('envia_shipping' !== $method->id || ! isset($args['cost']) || is_array($args['cost']) || ! is_numeric($args['cost'])) {
        return $args;
    }

    $destination = isset($args['package']['destination']) && is_array($args['package']['destination'])
        ? $args['package']['destination']
        : array();
    $country = isset($destination['country']) ? strtoupper((string) $destination['country']) : '';

    if ('MX' !== $country || (float) $args['cost'] <= 0.0) {
        return $args;
    }

    $adjustment = lm_commerce_get_envia_inclusive_rate_adjustment((float) $args['cost']);
    if (null === $adjustment) {
        return $args;
    }

    $args['cost']      = $adjustment['cost'];
    $args['taxes']     = $adjustment['taxes'];
    $args['meta_data'] = is_array($args['meta_data'] ?? null) ? $args['meta_data'] : array();
    $args['meta_data']['_lm_envia_tax_inclusive_normalized'] = 'yes';

    return $args;
}, 100, 2);

/**
 * Retain the same result if a future Envia extension version constructs its
 * shipping rate directly instead of using WC_Shipping_Method::add_rate().
 *
 * @param array<string, WC_Shipping_Rate> $rates Shipping rates for a package.
 * @param array<string, mixed>             $package Shipping package context.
 * @return array<string, WC_Shipping_Rate>
 */
add_filter('woocommerce_package_rates', static function (array $rates, array $package): array {
    $destination = isset($package['destination']) && is_array($package['destination']) ? $package['destination'] : array();
    $country     = isset($destination['country']) ? strtoupper((string) $destination['country']) : '';

    if ('MX' !== $country) {
        return $rates;
    }

    foreach ($rates as $rate_id => $rate) {
        if (! $rate instanceof WC_Shipping_Rate || 'envia_shipping' !== $rate->get_method_id()) {
            continue;
        }

        $meta_data = $rate->get_meta_data();
        if (isset($meta_data['_lm_envia_tax_inclusive_normalized']) || (float) $rate->get_cost() <= 0.0) {
            continue;
        }

        $adjustment = lm_commerce_get_envia_inclusive_rate_adjustment((float) $rate->get_cost());
        if (null === $adjustment) {
            continue;
        }

        $rate->set_cost($adjustment['cost']);
        $rate->set_taxes($adjustment['taxes']);
        $rate->add_meta_data('_lm_envia_tax_inclusive_normalized', 'yes');
        $rates[$rate_id] = $rate;
    }

    return $rates;
}, 100, 2);

register_activation_hook(__FILE__, static function (): void {
    LM_Envia_Admin_Compatibility::retire_legacy_production_integration();
    LM_Production_Operations::install();
    flush_rewrite_rules();
});

register_deactivation_hook(__FILE__, static function (): void {
    LM_Mercado_Pago_Reconciler::unschedule();
    flush_rewrite_rules();
});
