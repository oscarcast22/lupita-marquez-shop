<?php
/**
 * Plugin Name: LM Commerce
 * Description: Catálogo y operaciones de comercio para Lupita Márquez.
 * Version: 0.6.0
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

define('LM_COMMERCE_VERSION', '0.6.0');
define('LM_COMMERCE_FILE', __FILE__);
define('LM_COMMERCE_DIR', plugin_dir_path(__FILE__));

require_once LM_COMMERCE_DIR . 'includes/class-lm-envia-admin-compatibility.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-mercadopago-reconciler.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-production-operations.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-demo.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-packaging.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-prelaunch-guard.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-test-catalog.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-validated-catalog.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-product-notices.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-contact-form.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-account-experience.php';

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
    if (lm_commerce_uses_legacy_envia()) {
        require_once LM_COMMERCE_DIR . 'includes/class-lm-envia-client.php';
        require_once LM_COMMERCE_DIR . 'includes/class-lm-fulfillment.php';
        require_once LM_COMMERCE_DIR . 'includes/class-lm-shipping-method.php';
        add_action('woocommerce_init', array('LM_Shipping_Method', 'register_checkout_address_fields'));
        LM_Fulfillment::init();
    }
    LM_Mercado_Pago_Reconciler::init();
    LM_Demo::init();
    LM_Packaging::init();
    LM_Prelaunch_Guard::init();
    LM_Validated_Catalog::init();
    LM_Product_Notices::init();
    LM_Account_Experience::init();
});

add_filter('woocommerce_shipping_methods', static function (array $methods): array {
    if (lm_commerce_uses_legacy_envia() && class_exists('LM_Shipping_Method')) {
        $methods['lm_estafeta_envia'] = LM_Shipping_Method::class;
    }
    return $methods;
});

register_activation_hook(__FILE__, static function (): void {
    LM_Envia_Admin_Compatibility::retire_legacy_production_integration();
    LM_Production_Operations::install();
    flush_rewrite_rules();
});

register_deactivation_hook(__FILE__, static function (): void {
    LM_Mercado_Pago_Reconciler::unschedule();
    flush_rewrite_rules();
});
