<?php
/**
 * Plugin Name: LM Commerce
 * Description: Catálogo, personalización y logística Estafeta para Lupita Márquez.
 * Version: 0.1.0
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

define('LM_COMMERCE_VERSION', '0.1.0');
define('LM_COMMERCE_FILE', __FILE__);
define('LM_COMMERCE_DIR', plugin_dir_path(__FILE__));

require_once LM_COMMERCE_DIR . 'includes/class-lm-envia-client.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-personalization.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-fulfillment.php';
require_once LM_COMMERCE_DIR . 'includes/class-lm-demo.php';

add_action('before_woocommerce_init', static function (): void {
    if (class_exists(Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
        Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', __FILE__, true);
    }
});

add_action('plugins_loaded', static function (): void {
    if (! class_exists('WooCommerce')) {
        return;
    }

    require_once LM_COMMERCE_DIR . 'includes/class-lm-shipping-method.php';
    LM_Personalization::init();
    LM_Fulfillment::init();
    LM_Demo::init();
});

add_filter('woocommerce_shipping_methods', static function (array $methods): array {
    if (class_exists('LM_Shipping_Method')) {
        $methods['lm_estafeta_envia'] = LM_Shipping_Method::class;
    }
    return $methods;
});

register_activation_hook(__FILE__, static function (): void {
    LM_Fulfillment::register_status();
    flush_rewrite_rules();
});

register_deactivation_hook(__FILE__, static function (): void {
    flush_rewrite_rules();
});
