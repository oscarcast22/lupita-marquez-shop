<?php
/**
 * Compatibility fixes for the Envia.com WooCommerce extension admin UI.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Envia_Admin_Compatibility
{
    private const LEGACY_METHOD_ID = 'lm_estafeta_envia';
    private const LEGACY_MIGRATION_OPTION = 'lm_envia_official_production_migrated';
    private const LEGACY_HOOKS = array(
        'lm_generate_estafeta_label',
        'lm_send_estafeta_sandbox_tracking_email',
    );

    public static function init(): void
    {
        // Envia 5.0 enqueues its metabox script while rendering the order screen.
        add_action('admin_print_footer_scripts', array(__CLASS__, 'dequeue_unsafe_metabox_script'), 0);
        // Payment gateways keep technical reconciliation data as order meta. The
        // generic WordPress editor exposes every non-protected key in an editable
        // box, which is not part of the store's day-to-day fulfillment workflow.
        add_action('add_meta_boxes', array(__CLASS__, 'hide_technical_custom_fields'), 1000);

        if (self::uses_official_production_integration()) {
            add_action('admin_init', array(__CLASS__, 'retire_legacy_production_integration'), 1);
        }
    }

    public static function uses_official_production_integration(): bool
    {
        return 'production' === wp_get_environment_type();
    }

    /**
     * Remove only the retired in-house Envia method on the live store.
     *
     * Envia Shipping and Fulfillment replaces it in production. Staging keeps
     * its isolated test setup, and historic order metadata is deliberately
     * preserved for auditing.
     */
    public static function retire_legacy_production_integration(): void
    {
        if (! self::uses_official_production_integration()
            || get_option(self::LEGACY_MIGRATION_OPTION)) {
            return;
        }

        self::unschedule_legacy_actions();

        global $wpdb;
        if (isset($wpdb) && isset($wpdb->prefix)) {
            $table = $wpdb->prefix . 'woocommerce_shipping_zone_methods';
            $instance_ids = $wpdb->get_col(
                $wpdb->prepare(
                    "SELECT instance_id FROM {$table} WHERE method_id = %s",
                    self::LEGACY_METHOD_ID
                )
            );

            foreach ($instance_ids as $instance_id) {
                delete_option('woocommerce_' . self::LEGACY_METHOD_ID . '_' . absint($instance_id) . '_settings');
            }
            $wpdb->delete($table, array('method_id' => self::LEGACY_METHOD_ID), array('%s'));
        }

        // Older single-instance settings may contain an API token as well.
        delete_option('woocommerce_' . self::LEGACY_METHOD_ID . '_settings');
        update_option(self::LEGACY_MIGRATION_OPTION, LM_COMMERCE_VERSION, false);
    }

    private static function unschedule_legacy_actions(): void
    {
        foreach (self::LEGACY_HOOKS as $hook) {
            if (function_exists('as_unschedule_all_actions')) {
                as_unschedule_all_actions($hook, array(), 'lm-commerce');
            }
            wp_clear_scheduled_hook($hook);
        }
    }

    public static function dequeue_unsafe_metabox_script(): void
    {
        if (! function_exists('get_current_screen')) {
            return;
        }

        $screen = get_current_screen();
        if (! $screen || ! in_array($screen->id, array('shop_order', 'woocommerce_page_wc-orders'), true)) {
            return;
        }

        /*
         * The official `orderBox` script uses an unbounded while loop to move
         * Envia's metabox. It never terminates with WooCommerce's HPOS layout,
         * freezing the browser. The metabox markup and its quote link work
         * without this cosmetic reordering script.
         */
        wp_dequeue_script('orderBox');
    }

    /**
     * Hide the generic Custom Fields metabox on WooCommerce order screens.
     *
     * This is a presentation-only change: Mercado Pago's payment IDs,
     * reconciliation metadata, Envia data and every WooCommerce order meta
     * record remain stored and available to their integrations. It also keeps
     * operators from accidentally editing gateway-owned values by hand.
     */
    public static function hide_technical_custom_fields(): void
    {
        foreach (array('shop_order', 'woocommerce_page_wc-orders') as $screen_id) {
            foreach (array('normal', 'advanced', 'side') as $context) {
                remove_meta_box('postcustom', $screen_id, $context);
            }
        }
    }
}
