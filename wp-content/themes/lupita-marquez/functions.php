<?php
/**
 * Theme setup.
 *
 * @package LupitaMarquez
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

add_action('after_setup_theme', static function (): void {
    add_theme_support('woocommerce');
    add_theme_support('wp-block-styles');
    add_theme_support('responsive-embeds');
    add_theme_support('editor-styles');
    add_editor_style('style.css');
});

add_action('wp_enqueue_scripts', static function (): void {
    wp_enqueue_style(
        'lupita-marquez',
        get_stylesheet_uri(),
        array(),
        wp_get_theme()->get('Version')
    );
});

add_filter('woocommerce_enqueue_styles', static function (array $styles): array {
    unset($styles['woocommerce-general'], $styles['woocommerce-layout'], $styles['woocommerce-smallscreen']);
    return $styles;
});

