<?php
/**
 * Product-page WooCommerce notice bridge.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Product_Notices
{
    private const ACTION = 'lm_product_notices';
    private const NONCE_ACTION = 'lm_product_notices';
    private const SCRIPT_HANDLE = 'lupita-marquez-interactions';

    public static function init(): void
    {
        add_action('wc_ajax_' . self::ACTION, array(__CLASS__, 'consume_errors'));
        add_action('wp_enqueue_scripts', array(__CLASS__, 'configure_script'), 30);
    }

    public static function configure_script(): void
    {
        if (! is_product() || ! wp_script_is(self::SCRIPT_HANDLE, 'enqueued')) {
            return;
        }

        wp_localize_script(self::SCRIPT_HANDLE, 'lmProductNotices', array(
            'endpoint' => WC_AJAX::get_endpoint(self::ACTION),
            'nonce' => wp_create_nonce(self::NONCE_ACTION),
        ));
    }

    public static function consume_errors(): void
    {
        if (! check_ajax_referer(self::NONCE_ACTION, 'security', false)) {
            wp_send_json_error(array(
                'message' => __('No fue posible validar la solicitud.', 'lm-commerce'),
            ), 403);
        }

        $notices = wc_get_notices();
        $messages = array();

        foreach ($notices['error'] ?? array() as $notice) {
            $message = is_array($notice) ? ($notice['notice'] ?? '') : $notice;
            $message = preg_replace('/<a\b[^>]*>.*?<\/a>/is', ' ', (string) $message) ?? $message;
            $message = trim(wp_strip_all_tags(html_entity_decode((string) $message, ENT_QUOTES, get_bloginfo('charset'))));
            if ('' !== $message) {
                $messages[] = $message;
            }
        }

        unset($notices['error']);
        wc_set_notices($notices);

        wp_send_json_success(array(
            'messages' => array_values(array_unique($messages)),
            'cartUrl' => WC()->cart && ! WC()->cart->is_empty() ? wc_get_cart_url() : null,
        ));
    }
}
