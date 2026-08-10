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
    add_theme_support('title-tag');
    add_image_size('lm-catalog', 720, 900, false);
    add_editor_style('build/index.css');
});

add_filter('woocommerce_placeholder_img_src', static function (): string {
    return get_theme_file_uri('assets/images/foto-proximamente.svg');
});

add_filter('woocommerce_placeholder_img_srcset', '__return_false');

add_filter('woocommerce_product_get_image', static function (
    string $image,
    WC_Product $product,
    $size,
    array $attr
): string {
    if ($product->get_image_id()) {
        return $image;
    }

    $class = esc_attr((string) ($attr['class'] ?? 'woocommerce-placeholder wp-post-image'));
    return sprintf(
        '<img src="%s" class="%s" alt="%s" loading="lazy" decoding="async">',
        esc_url(get_theme_file_uri('assets/images/foto-proximamente.svg')),
        $class,
        esc_attr__('Foto próximamente', 'lupita-marquez')
    );
}, 10, 4);

add_filter('woocommerce_product_add_to_cart_text', static function (string $text, WC_Product $product): string {
    return $product->is_type('variable') ? 'Elegir opciones' : 'Agregar al carrito';
}, 10, 2);

add_filter('woocommerce_product_single_add_to_cart_text', static fn (): string => 'Agregar al carrito');

add_filter('woocommerce_product_add_to_cart_description', static function (string $description, WC_Product $product): string {
    return sprintf('Agregar al carrito: “%s”', $product->get_name());
}, 10, 2);

add_action('wp_enqueue_scripts', static function (): void {
    $asset_file = get_theme_file_path('build/index.asset.php');
    $asset = file_exists($asset_file)
        ? require $asset_file
        : array('version' => wp_get_theme()->get('Version'));

    wp_enqueue_style(
        'lupita-marquez',
        get_theme_file_uri('build/index.css'),
        array(),
        $asset['version']
    );
});

add_filter('woocommerce_enqueue_styles', static function (array $styles): array {
    unset($styles['woocommerce-general'], $styles['woocommerce-layout'], $styles['woocommerce-smallscreen']);
    return $styles;
});
