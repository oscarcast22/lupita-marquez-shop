<?php
/**
 * Repeatable local demo provisioning and diagnostics.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Demo
{
    private const CATALOG_MARKER = '_lm_demo_catalog_managed';

    private const FEATURED_CATALOG_ORDER = array(
        'LM-ALT-CHI' => 1,
        'LM-ALT-GIG' => 2,
        'LM-ALT-MED' => 3,
        'LM-MAS-ALT' => 4,
        'LM-NIC-001' => 5,
        'LM-CRU-ALA' => 6,
    );

    private const LEGACY_CATALOG_SKUS = array(
        'LM-ALT-CHI',
        'LM-ALT-CHI-NAT',
        'LM-ALT-CHI-ARC',
        'LM-ALT-MED',
        'LM-ALT-MED-ARC',
        'LM-ALT-GRA',
        'LM-ALT-GRA-ARC',
        'LM-ALT-GIG',
        'LM-MAS-ALT',
        'LM-CRU-ALA',
        'LM-NIC-001',
        'LM-ROP-MIN',
        'LM-ALC-AHO',
    );

    public static function init(): void
    {
        if (defined('WP_CLI') && WP_CLI) {
            WP_CLI::add_command('lm demo seed', array(__CLASS__, 'seed'));
            WP_CLI::add_command('lm doctor', array(__CLASS__, 'doctor'));
        }
        if ('local' === wp_get_environment_type()) {
            add_action('phpmailer_init', static function ($mailer): void {
                $mailer->isSMTP();
                $mailer->Host = 'mailpit';
                $mailer->Port = 1025;
                $mailer->SMTPAuth = false;
            });
        }
        add_filter('woocommerce_get_availability_text', array(__CLASS__, 'availability_text'), 10, 2);
    }

    public static function availability_text(string $availability, WC_Product $product): string
    {
        $product_id = $product instanceof WC_Product_Variation
            ? $product->get_parent_id()
            : $product->get_id();
        if ('made_to_order' !== get_post_meta($product_id, '_lm_stock_mode', true)) {
            return $availability;
        }
        $lead_days = absint(get_post_meta($product_id, '_lm_lead_days', true));
        return sprintf('Hecho bajo pedido · %d días hábiles', $lead_days);
    }

    /**
     * Create/update the local store and its editable demo catalog.
     *
     * ## OPTIONS
     *
     * --catalog=<path>
     * : CSV catalog inside the WordPress container.
     */
    public static function seed(array $args, array $assoc_args): void
    {
        if ('local' !== wp_get_environment_type()) {
            WP_CLI::error('La sincronización del catálogo demo sólo está disponible en el entorno local.');
        }

        $catalog = (string) ($assoc_args['catalog'] ?? '');
        if ('' === $catalog || ! is_readable($catalog)) {
            WP_CLI::error('No se puede leer el catálogo: ' . $catalog);
        }

        self::configure_store();
        self::create_pages();
        self::create_tax();
        self::create_shipping();
        self::create_coupon();
        self::import_branding();
        $count = self::import_catalog($catalog);
        flush_rewrite_rules(false);
        update_option('lm_demo_seeded_at', gmdate('c'));
        WP_CLI::success(sprintf('Demo lista: %d productos importados o actualizados.', $count));
    }

    public static function doctor(array $args, array $assoc_args): void
    {
        $checks = array(
            'WooCommerce activo' => class_exists('WooCommerce'),
            'Tema Lupita Márquez activo' => 'lupita-marquez' === get_stylesheet(),
            'Página de tienda' => (int) get_option('woocommerce_shop_page_id') > 0,
            'Checkout de bloques' => has_block('woocommerce/checkout', (int) get_option('woocommerce_checkout_page_id')),
            'Catálogo de 12 familias (8 variables y 4 simples)' => self::catalog_is_valid(),
            'Galerías por variación activas' => 'yes' === get_option('wc_feature_woocommerce_additional_variation_images_enabled'),
            'Zona México configurada' => self::shipping_exists(),
            'HPOS habilitable' => class_exists(Automattic\WooCommerce\Utilities\OrderUtil::class),
        );
        $failed = 0;
        foreach ($checks as $label => $ok) {
            WP_CLI::log(($ok ? '[OK] ' : '[ERROR] ') . $label);
            $failed += $ok ? 0 : 1;
        }
        if (! (new LM_Envia_Client())->configured()) {
            WP_CLI::warning('LM_ENVIA_TOKEN vacío: se usará la tarifa demo y no se emitirán guías reales.');
        }
        if (! defined('LM_MERCADOPAGO_ACCESS_TOKEN') || '' === trim((string) LM_MERCADOPAGO_ACCESS_TOKEN)) {
            WP_CLI::warning('Mercado Pago está instalado pero pendiente de credenciales de la clienta.');
        }
        $failed ? WP_CLI::error($failed . ' comprobaciones fallaron.') : WP_CLI::success('La instalación supera las comprobaciones básicas.');
    }

    private static function configure_store(): void
    {
        $options = array(
            'woocommerce_currency' => 'MXN',
            'woocommerce_default_country' => 'MX:CX',
            'woocommerce_allowed_countries' => 'specific',
            'woocommerce_specific_allowed_countries' => array('MX'),
            'woocommerce_weight_unit' => 'kg',
            'woocommerce_dimension_unit' => 'cm',
            'woocommerce_calc_taxes' => 'yes',
            'woocommerce_prices_include_tax' => 'yes',
            'woocommerce_tax_display_shop' => 'incl',
            'woocommerce_tax_display_cart' => 'incl',
            'woocommerce_enable_guest_checkout' => 'yes',
            'woocommerce_enable_checkout_login_reminder' => 'yes',
            'woocommerce_enable_signup_and_login_from_checkout' => 'yes',
            'woocommerce_manage_stock' => 'yes',
            'woocommerce_hold_stock_minutes' => '60',
            'woocommerce_custom_orders_table_enabled' => 'yes',
            'wc_feature_woocommerce_additional_variation_images_enabled' => 'yes',
        );
        foreach ($options as $key => $value) {
            update_option($key, $value);
        }
        $permalinks = (array) get_option('woocommerce_permalinks', array());
        $permalinks['product_base'] = '/producto';
        $permalinks['category_base'] = '/categoria-producto';
        update_option('woocommerce_permalinks', $permalinks);
    }

    private static function create_pages(): void
    {
        $pages = array(
            'inicio' => array('Inicio', ''),
            'tienda' => array('Tienda', ''),
            'carrito' => array('Carrito', '<!-- wp:woocommerce/cart /-->'),
            'finalizar-compra' => array('Finalizar compra', '<!-- wp:woocommerce/checkout /-->'),
            'mi-cuenta' => array('Mi cuenta', '[woocommerce_my_account]'),
            'nosotros' => array('Nosotros', '<!-- wp:heading --><h2 class="wp-block-heading">Nuestra esencia</h2><!-- /wp:heading --><!-- wp:paragraph --><p>Transformamos ideas en experiencias únicas mediante piezas de madera hechas en México. Trabajamos con pasión, creatividad y compromiso para reflejar la esencia de cada persona y cada recuerdo.</p><!-- /wp:paragraph --><!-- wp:heading {"level":3} --><h3 class="wp-block-heading">Visión</h3><!-- /wp:heading --><!-- wp:paragraph --><p>Ser una marca reconocida por la calidad, originalidad y calidez de sus productos personalizados.</p><!-- /wp:paragraph -->'),
            'contacto' => array('Contacto', '<!-- wp:heading --><h2 class="wp-block-heading">Hablemos de tu pieza</h2><!-- /wp:heading --><!-- wp:paragraph --><p>Los datos de WhatsApp, correo y redes sociales se agregarán cuando la clienta los confirme.</p><!-- /wp:paragraph -->'),
            'preguntas-frecuentes' => array('Preguntas frecuentes', '<!-- wp:heading --><h2 class="wp-block-heading">Preguntas frecuentes</h2><!-- /wp:heading --><!-- wp:paragraph --><p>Las piezas disponibles se despachan al confirmar el pago. Las hechas bajo pedido muestran su tiempo estimado de elaboración en la ficha de producto.</p><!-- /wp:paragraph -->'),
            'envios-y-devoluciones' => array('Envíos y devoluciones', '<!-- wp:paragraph --><p><strong>Contenido provisional:</strong> los envíos se realizan dentro de México mediante Estafeta. La política definitiva de cambios, daños y devoluciones debe validarse con la clienta antes de publicar.</p><!-- /wp:paragraph -->'),
            'aviso-de-privacidad' => array('Aviso de privacidad', '<!-- wp:paragraph --><p><strong>Borrador pendiente de revisión legal.</strong> El tratamiento de datos de contacto, pago y envío debe validarse antes de publicar la tienda.</p><!-- /wp:paragraph -->'),
            'terminos-y-condiciones' => array('Términos y condiciones', '<!-- wp:paragraph --><p><strong>Borrador pendiente de revisión legal.</strong> Los precios, tiempos de elaboración y políticas finales deben ser aprobados antes de producción.</p><!-- /wp:paragraph -->'),
            'guia-de-estilos' => array('Guía de estilos', ''),
        );
        $ids = array();
        foreach ($pages as $slug => [$title, $content]) {
            $page = get_page_by_path($slug);
            $post = array('post_title' => $title, 'post_name' => $slug, 'post_content' => $content, 'post_status' => 'publish', 'post_type' => 'page');
            if ($page) {
                $post['ID'] = $page->ID;
                $ids[$slug] = wp_update_post($post);
            } else {
                $ids[$slug] = wp_insert_post($post);
            }
        }
        update_option('show_on_front', 'page');
        update_option('page_on_front', $ids['inicio']);
        update_option('woocommerce_shop_page_id', $ids['tienda']);
        update_option('woocommerce_cart_page_id', $ids['carrito']);
        update_option('woocommerce_checkout_page_id', $ids['finalizar-compra']);
        update_option('woocommerce_myaccount_page_id', $ids['mi-cuenta']);
        update_option('wp_page_for_privacy_policy', $ids['aviso-de-privacidad']);
    }

    private static function create_tax(): void
    {
        $rates = WC_Tax::find_rates(array('country' => 'MX', 'state' => '', 'postcode' => '', 'city' => '', 'tax_class' => ''));
        if (! $rates) {
            WC_Tax::_insert_tax_rate(array(
                'tax_rate_country' => 'MX',
                'tax_rate_state' => '',
                'tax_rate' => '16.0000',
                'tax_rate_name' => 'IVA',
                'tax_rate_priority' => 1,
                'tax_rate_compound' => 0,
                'tax_rate_shipping' => 1,
                'tax_rate_order' => 0,
                'tax_rate_class' => '',
            ));
        }
    }

    private static function create_shipping(): void
    {
        if (self::shipping_exists()) {
            return;
        }
        $zone = new WC_Shipping_Zone();
        $zone->set_zone_name('México');
        $zone->set_zone_order(1);
        $zone->add_location('MX', 'country');
        $zone->save();
        $instance_id = $zone->add_shipping_method('lm_estafeta_envia');
        update_option('woocommerce_lm_estafeta_envia_' . $instance_id . '_settings', array(
            'enabled' => 'yes',
            'title' => 'Envío Estafeta',
            'fallback_cost' => '299',
            'origin_name' => 'Lupita Márquez',
            'origin_phone' => '5555555555',
            'origin_email' => get_option('admin_email'),
            'origin_street' => 'DIRECCIÓN DEMO — reemplazar antes de producción',
            'origin_city' => 'Ciudad de México',
            'origin_state' => 'CX',
            'origin_postcode' => '03100',
        ));
        $free_id = $zone->add_shipping_method('free_shipping');
        update_option('woocommerce_free_shipping_' . $free_id . '_settings', array(
            'title' => 'Envío gratuito',
            'requires' => 'min_amount',
            'min_amount' => '2000',
            'ignore_discounts' => 'no',
        ));
    }

    private static function shipping_exists(): bool
    {
        foreach (WC_Shipping_Zones::get_zones() as $zone) {
            foreach ($zone['shipping_methods'] ?? array() as $method) {
                if ('lm_estafeta_envia' === $method->id) {
                    return true;
                }
            }
        }
        return false;
    }

    private static function create_coupon(): void
    {
        if (wc_get_coupon_id_by_code('BIENVENIDA10')) {
            return;
        }
        $coupon = new WC_Coupon();
        $coupon->set_code('BIENVENIDA10');
        $coupon->set_description('Cupón demo; confirmar campaña antes de producción.');
        $coupon->set_discount_type('percent');
        $coupon->set_amount(10);
        $coupon->set_individual_use(true);
        $coupon->set_usage_limit_per_user(1);
        $coupon->save();
    }

    private static function import_branding(): void
    {
        $root = defined('LM_CLIENT_ASSETS_DIR')
            ? (string) LM_CLIENT_ASSETS_DIR
            : (string) getenv('LM_CLIENT_ASSETS_DIR');
        $optimized_logo = get_theme_file_path('assets/images/logo-lupita-marquez.png');
        $logo = is_readable($optimized_logo) ? $optimized_logo : trailingslashit($root) . 'logo.jpeg';
        if (is_readable($logo)) {
            $logo_id = self::media_from_file($logo, 0);
            if ($logo_id) {
                set_theme_mod('custom_logo', $logo_id);
            }
        }
        $hero_sources = glob(trailingslashit($root) . 'img/Altar Grande/*.jpeg') ?: array();
        if ($hero_sources) {
            $uploads = wp_upload_dir();
            $hero_dir = trailingslashit($uploads['basedir']) . 'lm-demo';
            wp_mkdir_p($hero_dir);
            copy($hero_sources[0], trailingslashit($hero_dir) . 'hero.jpg');
        }
    }

    private static function import_catalog(string $csv_path): int
    {
        $handle = fopen($csv_path, 'rb');
        if (! $handle) {
            WP_CLI::error('No se pudo abrir el CSV.');
        }
        $headers = fgetcsv($handle);
        $count = 0;
        $skus = array();
        while (($values = fgetcsv($handle)) !== false) {
            if (array(null) === $values || array('') === $values) {
                continue;
            }
            if (count($headers) !== count($values)) {
                WP_CLI::warning('Fila omitida por número incorrecto de columnas.');
                continue;
            }
            $row = array_combine($headers, $values);
            self::upsert_product($row);
            $skus[] = (string) $row['sku'];
            ++$count;
        }
        fclose($handle);
        self::prune_catalog($skus);
        return $count;
    }

    private static function upsert_product(array $row): void
    {
        $sku = (string) $row['sku'];
        $existing_id = wc_get_product_id_by_sku($sku);
        $type = sanitize_key((string) $row['type']);
        $product = 'variable' === $type
            ? new WC_Product_Variable($existing_id ?: 0)
            : new WC_Product_Simple($existing_id ?: 0);
        $product->set_name((string) $row['name']);
        $product->set_slug((string) $row['slug']);
        $product->set_sku($sku);
        $product->set_status((string) $row['status']);
        $product->set_catalog_visibility('visible');
        $product->set_featured(isset(self::FEATURED_CATALOG_ORDER[$sku]));
        $product->set_menu_order(self::FEATURED_CATALOG_ORDER[$sku] ?? 100);
        $product->set_description(self::description($row));
        $product->set_short_description(self::short_description($row));
        $product->set_tax_status('taxable');
        $product->set_weight((string) $row['weight_kg']);
        $product->set_length((string) $row['length_cm']);
        $product->set_width((string) $row['width_cm']);
        $product->set_height((string) $row['height_cm']);
        $category = term_exists((string) $row['category'], 'product_cat');
        if (! $category) {
            $category = wp_insert_term((string) $row['category'], 'product_cat');
        }
        if (! is_wp_error($category)) {
            $product->set_category_ids(array((int) (is_array($category) ? $category['term_id'] : $category)));
        }
        self::stock($product, $row);
        $product->update_meta_data('_lm_lead_days', absint($row['lead_days']));
        $product->update_meta_data('_lm_stock_mode', sanitize_key((string) $row['stock_mode']));
        $product->update_meta_data('_lm_ship_separately', (string) $row['ship_separately']);
        $product->update_meta_data(self::CATALOG_MARKER, 'yes');
        // Retire known local demo metadata without touching historic order data or uploads.
        $product->delete_meta_data('_lm_personalization');
        $product->delete_meta_data('_lm_personalization_surcharge');
        if ('variable' === $type) {
            $finishes = array_values(array_filter(array_map('trim', explode('|', (string) $row['finishes']))));
            $attribute = new WC_Product_Attribute();
            $attribute->set_id(0);
            $attribute->set_name('Acabado');
            $attribute->set_options($finishes);
            $attribute->set_position(0);
            $attribute->set_visible(true);
            $attribute->set_variation(true);
            $product->set_attributes(array($attribute));
            $product->set_default_attributes(array(
                'acabado' => (string) $row['default_finish'],
            ));
            $product->set_regular_price('');
        } else {
            if ($existing_id) {
                self::delete_variations((int) $existing_id);
            }
            $product->set_attributes(array());
            $product->set_regular_price((string) $row['price']);
        }
        $product->save();
        self::images($product, $row, 'variable' === $type ? (string) $row['default_finish'] : '');

        if ('variable' === $type) {
            self::upsert_variations($product, $row, $finishes);
        }
    }

    private static function upsert_variations(WC_Product_Variable $parent, array $row, array $finishes): void
    {
        $kept_ids = array();
        foreach ($finishes as $finish) {
            $suffix = 'Natural' === $finish ? 'NAT' : 'PIN';
            $sku = (string) $row['sku'] . '-' . $suffix;
            $variation_id = wc_get_product_id_by_sku($sku);
            $existing = $variation_id ? wc_get_product($variation_id) : false;

            // The former standalone "Altar chico natural" used the variation SKU.
            if ($existing && ! $existing instanceof WC_Product_Variation) {
                $existing->set_sku('');
                $existing->save();
                self::delete_variations((int) $variation_id);
                wp_trash_post((int) $variation_id);
                $variation_id = 0;
            }

            $variation = new WC_Product_Variation($variation_id ?: 0);
            $variation->set_parent_id($parent->get_id());
            $variation->set_status('publish');
            $variation->set_sku($sku);
            $variation->set_attributes(array('acabado' => $finish));
            $price_key = 'Natural' === $finish ? 'natural_price' : 'painted_price';
            $variation->set_regular_price((string) $row[$price_key]);
            if ('made_to_order' === $row['stock_mode']) {
                $variation->set_manage_stock(true);
                $variation->set_stock_quantity(0);
                $variation->set_stock_status('onbackorder');
                $variation->set_backorders('yes');
            } else {
                $variation->set_manage_stock(false);
                $variation->set_stock_status($parent->get_stock_status());
                $variation->set_backorders('no');
            }
            $variation->set_description(
                'Natural' === $finish
                    ? 'Madera al natural, con sus vetas y matices propios a la vista.'
                    : 'Acabado pintado en colores vibrantes; cada pieza conserva variaciones sutiles que la hacen única.'
            );
            $variation->save();
            self::images($variation, $row, $finish);
            $kept_ids[] = $variation->get_id();
        }

        foreach ($parent->get_children() as $child_id) {
            if (! in_array((int) $child_id, $kept_ids, true)) {
                wp_delete_post((int) $child_id, true);
            }
        }
        WC_Product_Variable::sync($parent->get_id());
        wc_delete_product_transients($parent->get_id());
    }

    private static function stock(WC_Product $product, array $row): void
    {
        if ('stock' === $row['stock_mode']) {
            $product->set_manage_stock(true);
            $product->set_stock_quantity(absint($row['stock_qty']));
            $product->set_stock_status(absint($row['stock_qty']) > 0 ? 'instock' : 'outofstock');
            $product->set_backorders('no');
        } else {
            $product->set_manage_stock(false);
            $product->set_stock_status('onbackorder');
            $product->set_backorders('yes');
        }
    }

    private static function delete_variations(int $product_id): void
    {
        $variation_ids = get_posts(array(
            'fields' => 'ids',
            'numberposts' => -1,
            'post_parent' => $product_id,
            'post_status' => 'any',
            'post_type' => 'product_variation',
        ));
        foreach ($variation_ids as $variation_id) {
            wp_delete_post((int) $variation_id, true);
        }
    }

    private static function prune_catalog(array $current_skus): void
    {
        $managed_ids = get_posts(array(
            'fields' => 'ids',
            'meta_key' => self::CATALOG_MARKER,
            'meta_value' => 'yes',
            'numberposts' => -1,
            'post_status' => array('publish', 'draft', 'pending', 'private'),
            'post_type' => 'product',
        ));
        foreach (self::LEGACY_CATALOG_SKUS as $legacy_sku) {
            $legacy_id = wc_get_product_id_by_sku($legacy_sku);
            $legacy_product = $legacy_id ? wc_get_product($legacy_id) : false;
            if ($legacy_product && ! $legacy_product instanceof WC_Product_Variation) {
                $managed_ids[] = $legacy_id;
            }
        }

        foreach (array_unique(array_map('intval', $managed_ids)) as $product_id) {
            $product = wc_get_product($product_id);
            if (! $product || in_array($product->get_sku(), $current_skus, true)) {
                continue;
            }
            self::delete_variations($product_id);
            wp_trash_post($product_id);
        }

        foreach (array('memoriales-y-mascotas', 'regalos-personalizados') as $slug) {
            $term = get_term_by('slug', $slug, 'product_cat');
            if ($term instanceof WP_Term && 0 === (int) $term->count) {
                wp_delete_term($term->term_id, 'product_cat');
            }
        }
    }

    private static function catalog_is_valid(): bool
    {
        global $wpdb;
        $duplicate_sku = $wpdb->get_var(
            "SELECT pm.meta_value
            FROM {$wpdb->postmeta} pm
            INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id
            WHERE pm.meta_key = '_sku'
                AND pm.meta_value <> ''
                AND p.post_type IN ('product', 'product_variation')
                AND p.post_status = 'publish'
            GROUP BY pm.meta_value
            HAVING COUNT(*) > 1
            LIMIT 1"
        );
        if ($duplicate_sku) {
            return false;
        }

        $expected_categories = array(
            'LM-ALT-CHI' => 'altares',
            'LM-ALT-CHI-ARC' => 'altares',
            'LM-ALT-MED' => 'altares',
            'LM-ALT-MED-ARC' => 'altares',
            'LM-ALT-GRA' => 'altares',
            'LM-ALT-GRA-ARC' => 'altares',
            'LM-ALT-GIG' => 'altares',
            'LM-NIC-001' => 'altares',
            'LM-MAS-ALT' => 'altares',
            'LM-CRU-ALA' => 'otras-piezas',
            'LM-ROP-MIN' => 'otras-piezas',
            'LM-ALC-AHO' => 'otras-piezas',
        );
        $variable_skus = array_slice(array_keys($expected_categories), 0, 8);
        $managed_ids = get_posts(array(
            'fields' => 'ids',
            'meta_key' => self::CATALOG_MARKER,
            'meta_value' => 'yes',
            'numberposts' => -1,
            'post_status' => 'publish',
            'post_type' => 'product',
        ));
        if (count($expected_categories) !== count($managed_ids)) {
            return false;
        }

        foreach ($expected_categories as $sku => $expected_category) {
            $product = wc_get_product(wc_get_product_id_by_sku($sku));
            $expected_class = in_array($sku, $variable_skus, true) ? WC_Product_Variable::class : WC_Product_Simple::class;
            if (! $product instanceof $expected_class || 'publish' !== $product->get_status()) {
                return false;
            }
            $category_slugs = wp_get_post_terms($product->get_id(), 'product_cat', array('fields' => 'slugs'));
            if (array($expected_category) !== $category_slugs) {
                return false;
            }
            if ($product instanceof WC_Product_Variable) {
                $children = $product->get_children();
                if (2 !== count($children)) {
                    return false;
                }
                $expected_variation_skus = array($sku . '-NAT', $sku . '-PIN');
                $actual_variation_skus = array();
                foreach ($children as $child_id) {
                    $variation = wc_get_product($child_id);
                    if (! $variation instanceof WC_Product_Variation || 'publish' !== $variation->get_status()) {
                        return false;
                    }
                    $actual_variation_skus[] = $variation->get_sku();
                    if (! $variation->get_image_id()) {
                        return false;
                    }
                }
                sort($expected_variation_skus);
                sort($actual_variation_skus);
                if ($expected_variation_skus !== $actual_variation_skus) {
                    return false;
                }
            }
        }

        $published_old_product = get_page_by_path('altar-chico-natural', OBJECT, 'product');
        return ! ($published_old_product instanceof WP_Post && 'publish' === $published_old_product->post_status);
    }

    private static function images(WC_Product $product, array $row, string $finish = ''): void
    {
        $root = defined('LM_CLIENT_ASSETS_DIR')
            ? (string) LM_CLIENT_ASSETS_DIR
            : (string) getenv('LM_CLIENT_ASSETS_DIR');
        $field = '' === $finish
            ? 'images'
            : ('Natural' === $finish ? 'natural_images' : 'painted_images');
        $relative_paths = array_values(array_filter(array_map('trim', explode('|', (string) ($row[$field] ?? '')))));
        $ids = array();
        foreach ($relative_paths as $relative_path) {
            $path = trailingslashit($root) . ltrim($relative_path, '/');
            if (! is_readable($path)) {
                WP_CLI::warning('Imagen no encontrada: ' . $relative_path);
                continue;
            }
            $id = self::media_from_file($path, $product->get_id(), self::image_alt($row, $finish, $relative_path));
            if ($id) {
                $ids[] = $id;
            }
        }
        if ($ids) {
            $image_id = array_shift($ids);
            $product->set_image_id($image_id);
            // A one-image variation repeats its featured ID in the official gallery
            // field. Core de-duplicates it when rendering, while the non-empty field
            // explicitly prevents fallback to the parent's different finish.
            if ($product instanceof WC_Product_Variation && ! $ids) {
                $ids = array($image_id);
            }
            $product->set_gallery_image_ids($ids);
        } else {
            $product->set_image_id(0);
            $product->set_gallery_image_ids(array());
        }
        $product->save();
    }

    private static function media_from_file(string $path, int $post_id, string $alt = ''): int
    {
        global $wpdb;
        $existing = $wpdb->get_var($wpdb->prepare(
            "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_lm_source_asset' AND meta_value = %s LIMIT 1",
            $path
        ));
        if ($existing) {
            if ('' !== $alt) {
                update_post_meta((int) $existing, '_wp_attachment_image_alt', $alt);
            }
            return (int) $existing;
        }
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $tmp = wp_tempnam(basename($path));
        if (! $tmp || ! copy($path, $tmp)) {
            return 0;
        }
        $file = array('name' => sanitize_file_name(basename($path)), 'tmp_name' => $tmp);
        $id = media_handle_sideload($file, $post_id);
        if (is_wp_error($id)) {
            wp_delete_file($tmp);
            WP_CLI::warning('Imagen omitida: ' . basename($path) . ' (' . $id->get_error_message() . ')');
            return 0;
        }
        update_post_meta($id, '_lm_source_asset', $path);
        if ('' !== $alt) {
            update_post_meta($id, '_wp_attachment_image_alt', $alt);
        }
        return (int) $id;
    }

    private static function image_alt(array $row, string $finish, string $relative_path): string
    {
        $name = (string) $row['name'];
        if (str_contains($relative_path, 'foto-proximamente')) {
            return '' === $finish
                ? $name . ': foto próximamente'
                : sprintf('%s, acabado %s: foto próximamente', $name, strtolower($finish));
        }
        $view = pathinfo($relative_path, PATHINFO_FILENAME);
        $view = preg_replace('/^\d+-/', '', $view);
        $view = str_replace('-', ' ', (string) $view);
        return '' === $finish
            ? sprintf('%s, vista %s', $name, $view)
            : sprintf('%s, acabado %s, vista %s', $name, strtolower($finish), $view);
    }

    private static function description(array $row): string
    {
        $dimensions = sprintf(
            '%s × %s × %s cm',
            wc_format_localized_decimal((string) $row['length_cm']),
            wc_format_localized_decimal((string) $row['width_cm']),
            wc_format_localized_decimal((string) $row['height_cm'])
        );
        return sprintf(
            '<p>Pieza de madera diseñada y producida en México. Las vetas, colores y pequeños matices forman parte de su carácter único.</p><dl class="lm-product-specs" aria-label="Información técnica"><div class="lm-product-spec"><dt>Medidas aproximadas</dt><dd>%s</dd></div></dl>',
            esc_html($dimensions)
        );
    }

    private static function short_description(array $row): string
    {
        return '<p>' . esc_html('Pieza de madera diseñada y producida en México.') . '</p>';
    }
}
