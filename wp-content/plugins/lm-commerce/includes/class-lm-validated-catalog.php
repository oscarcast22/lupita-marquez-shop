<?php
/**
 * Applies the client-confirmed commercial catalog without reimporting products.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Validated_Catalog
{
    private const ACTION = 'lm_sync_validated_catalog';

    /**
     * Net product weights are provisional estimates for 12 mm MDF. Packed weight includes the
     * saved carton and internal protection tare, so carrier quotations are deliberately safer.
     *
     * @var array<string, array{price: float, stock: int, package: string, net_weight: float}>
     */
    private const ITEMS = array(
        'LM-ALT-CHI-NAT' => array('price' => 240.0, 'stock' => 5, 'package' => 'Caja chica plana', 'net_weight' => 0.75),
        'LM-ALT-CHI-PIN' => array('price' => 350.0, 'stock' => 6, 'package' => 'Caja chica plana', 'net_weight' => 0.75),
        'LM-ALT-CHI-ARC-NAT' => array('price' => 290.0, 'stock' => 5, 'package' => 'Caja chica cuadrada', 'net_weight' => 1.10),
        'LM-ALT-CHI-ARC-PIN' => array('price' => 400.0, 'stock' => 6, 'package' => 'Caja chica plana', 'net_weight' => 1.10),
        'LM-ALT-MED-NAT' => array('price' => 450.0, 'stock' => 5, 'package' => 'Caja grande plana', 'net_weight' => 2.20),
        'LM-ALT-MED-PIN' => array('price' => 650.0, 'stock' => 10, 'package' => 'Caja grande plana', 'net_weight' => 2.20),
        'LM-ALT-MED-ARC-NAT' => array('price' => 550.0, 'stock' => 3, 'package' => 'Caja grande plana', 'net_weight' => 2.60),
        'LM-ALT-MED-ARC-PIN' => array('price' => 750.0, 'stock' => 10, 'package' => 'Caja grande plana', 'net_weight' => 2.60),
        'LM-ALT-GRA-NAT' => array('price' => 650.0, 'stock' => 5, 'package' => 'Caja extra grande plana', 'net_weight' => 4.50),
        'LM-ALT-GRA-PIN' => array('price' => 850.0, 'stock' => 10, 'package' => 'Caja extra grande plana', 'net_weight' => 4.50),
        'LM-ALT-GRA-ARC-NAT' => array('price' => 900.0, 'stock' => 5, 'package' => 'Caja extra grande plana', 'net_weight' => 5.10),
        'LM-ALT-GRA-ARC-PIN' => array('price' => 1050.0, 'stock' => 10, 'package' => 'Caja extra grande plana', 'net_weight' => 5.10),
        'LM-ALT-GIG-NAT' => array('price' => 1550.0, 'stock' => 3, 'package' => 'Caja gigante plana', 'net_weight' => 10.50),
        'LM-ALT-GIG-PIN' => array('price' => 1850.0, 'stock' => 3, 'package' => 'Caja gigante plana', 'net_weight' => 10.50),
        'LM-NIC-001-NAT' => array('price' => 100.0, 'stock' => 5, 'package' => 'Caja chica plana', 'net_weight' => 0.80),
        'LM-NIC-001-PIN' => array('price' => 165.0, 'stock' => 5, 'package' => 'Caja chica plana', 'net_weight' => 0.80),
        'LM-MAS-ALT' => array('price' => 380.0, 'stock' => 8, 'package' => 'Caja chica cuadrada', 'net_weight' => 1.20),
        'LM-CRU-ALA' => array('price' => 300.0, 'stock' => 10, 'package' => 'Caja grande plana', 'net_weight' => 1.70),
        'LM-ROP-MIN' => array('price' => 890.0, 'stock' => 2, 'package' => 'Caja grande alta', 'net_weight' => 2.50),
        'LM-ALC-AHO' => array('price' => 90.0, 'stock' => 10, 'package' => 'Caja chica cuadrada', 'net_weight' => 0.50),
    );

    /**
     * @var array<string, array{tare: float, length: int, width: int, height: int}>
     */
    private const PACKAGES = array(
        'Caja chica plana' => array('tare' => 0.25, 'length' => 35, 'width' => 25, 'height' => 5),
        'Caja chica cuadrada' => array('tare' => 0.30, 'length' => 35, 'width' => 35, 'height' => 5),
        'Caja mediana plana' => array('tare' => 0.40, 'length' => 45, 'width' => 35, 'height' => 5),
        'Caja grande plana' => array('tare' => 0.65, 'length' => 65, 'width' => 45, 'height' => 10),
        'Caja grande alta' => array('tare' => 1.10, 'length' => 62, 'width' => 42, 'height' => 32),
        'Caja extra grande plana' => array('tare' => 0.90, 'length' => 75, 'width' => 75, 'height' => 7),
        'Caja gigante plana' => array('tare' => 1.20, 'length' => 100, 'width' => 100, 'height' => 8),
    );

    public static function init(): void
    {
        add_action('admin_menu', array(__CLASS__, 'register_page'));
        add_action('admin_post_' . self::ACTION, array(__CLASS__, 'sync'));
    }

    public static function register_page(): void
    {
        add_management_page(
            __('Sincronizar catálogo confirmado', 'lm-commerce'),
            __('Sincronizar catálogo confirmado', 'lm-commerce'),
            'manage_options',
            'lm-validated-catalog',
            array(__CLASS__, 'page')
        );
    }

    public static function page(): void
    {
        if (! self::can_manage_catalog()) {
            return;
        }

        $updated = absint($_GET['updated'] ?? 0);
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Sincronizar catálogo confirmado', 'lm-commerce'); ?></h1>
            <?php if ($updated) : ?>
                <div class="notice notice-success"><p><?php echo esc_html(sprintf(_n('%d producto o variación actualizado.', '%d productos o variaciones actualizados.', $updated, 'lm-commerce'), $updated)); ?></p></div>
            <?php endif; ?>
            <p><?php esc_html_e('Actualiza precios, existencias, caja y peso de cotización con los datos confirmados por la clienta.', 'lm-commerce'); ?></p>
            <ul style="list-style: disc; padding-left: 1.5rem;">
                <li><?php esc_html_e('No cambia nombres, fotografías, descripciones, impuestos ni conexiones de Mercado Pago o Envia.', 'lm-commerce'); ?></li>
                <li><?php esc_html_e('Los pesos son provisionales: MDF de 12 mm más la tara de cartón y protección.', 'lm-commerce'); ?></li>
                <li><?php esc_html_e('La caja gigante se registra como 100 × 100 × 8 cm, conforme a la hoja confirmada.', 'lm-commerce'); ?></li>
            </ul>
            <form action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
                <input type="hidden" name="action" value="<?php echo esc_attr(self::ACTION); ?>">
                <?php wp_nonce_field(self::ACTION); ?>
                <?php submit_button(__('Aplicar catálogo confirmado', 'lm-commerce'), 'primary', 'submit', false); ?>
            </form>
        </div>
        <?php
    }

    public static function sync(): void
    {
        if (! self::can_manage_catalog()) {
            wp_die(esc_html__('No tienes permiso para sincronizar el catálogo.', 'lm-commerce'), 403);
        }
        check_admin_referer(self::ACTION);

        $result = self::sync_catalog();
        wp_safe_redirect(add_query_arg(array('page' => 'lm-validated-catalog', 'updated' => $result['updated']), admin_url('tools.php')));
        exit;
    }

    /**
     * Applies the client-confirmed catalog without requiring an admin form.
     *
     * This is used by the narrowly scoped production operation after test
     * orders have been removed. Product weights saved in WooCommerce include
     * the carton tare because Envia must quote the packed shipment weight.
     *
     * @return array{updated: int, missing_skus: list<string>}
     */
    public static function sync_catalog(): array
    {
        $updated = 0;
        $missing_skus = array();
        $parents = array();
        foreach (self::ITEMS as $sku => $item) {
            $product_id = wc_get_product_id_by_sku($sku);
            $product = $product_id ? wc_get_product($product_id) : false;
            if (! $product instanceof WC_Product) {
                $missing_skus[] = $sku;
                continue;
            }

            $product->set_regular_price((string) $item['price']);
            $product->set_manage_stock(true);
            $product->set_stock_quantity($item['stock']);
            $product->set_stock_status($item['stock'] > 0 ? 'instock' : 'outofstock');
            $product->set_backorders('no');
            self::apply_package($product, $item);
            $product->update_meta_data('_lm_weight_estimate_source', 'MDF 12 mm; pendiente de verificación física.');
            $product->save();
            ++$updated;

            if ($product instanceof WC_Product_Variation) {
                $parents[$product->get_parent_id()] = true;
            }
        }

        foreach (array_keys($parents) as $parent_id) {
            $parent = wc_get_product((int) $parent_id);
            if (! $parent instanceof WC_Product_Variable) {
                continue;
            }
            $default_package = self::default_package_for($parent);
            if (null !== $default_package) {
                self::apply_package($parent, $default_package);
            }
            $parent->set_manage_stock(false);
            $parent->set_stock_status('instock');
            $parent->set_backorders('no');
            $parent->save();
            WC_Product_Variable::sync($parent->get_id());
            wc_delete_product_transients($parent->get_id());
        }

        update_option('lm_validated_catalog_synced_at', gmdate('c'));

        return array(
            'updated' => $updated,
            'missing_skus' => $missing_skus,
        );
    }

    /**
     * @return array{item_count: int, items: list<array{sku: string, price: float, stock: int, package: string, net_weight: float, packed_weight: float, dimensions_cm: array{length: int, width: int, height: int}}>}
     */
    public static function catalog_preview(): array
    {
        $items = array();
        foreach (self::ITEMS as $sku => $item) {
            $package = self::PACKAGES[$item['package']];
            $items[] = array(
                'sku' => $sku,
                'price' => $item['price'],
                'stock' => $item['stock'],
                'package' => $item['package'],
                'net_weight' => $item['net_weight'],
                'packed_weight' => $item['net_weight'] + $package['tare'],
                'dimensions_cm' => array(
                    'length' => $package['length'],
                    'width' => $package['width'],
                    'height' => $package['height'],
                ),
            );
        }

        return array(
            'item_count' => count($items),
            'items' => $items,
        );
    }

    /**
     * Reads the live WooCommerce values that the official Envia plugin uses
     * when requesting a quote. It intentionally does not mutate catalog data.
     *
     * @return array{verified: bool, item_count: int, matching_item_count: int, missing_skus: list<string>, mismatches: list<array<string, mixed>>, legacy_package_metadata_records: int}
     */
    public static function catalog_audit(): array
    {
        $missing_skus = array();
        $mismatches = array();
        $matching_item_count = 0;
        $legacy_metadata_records = 0;

        foreach (self::ITEMS as $sku => $item) {
            $product_id = wc_get_product_id_by_sku($sku);
            $product = $product_id ? wc_get_product($product_id) : false;
            if (! $product instanceof WC_Product) {
                $missing_skus[] = $sku;
                continue;
            }

            $package = self::PACKAGES[$item['package']];
            $expected_weight = $item['net_weight'] + $package['tare'];
            $actual = array(
                'price' => (float) $product->get_regular_price(),
                'stock' => $product->get_stock_quantity(),
                'weight' => (float) $product->get_weight(),
                'dimensions_cm' => array(
                    'length' => (float) $product->get_length(),
                    'width' => (float) $product->get_width(),
                    'height' => (float) $product->get_height(),
                ),
            );
            $legacy_meta = array();
            foreach (array(
                '_lm_package_name',
                '_lm_package_weight_kg',
                '_lm_package_length_cm',
                '_lm_package_width_cm',
                '_lm_package_height_cm',
            ) as $meta_key) {
                if (metadata_exists('post', $product->get_id(), $meta_key)) {
                    $legacy_meta[] = $meta_key;
                }
            }
            $legacy_metadata_records += count($legacy_meta);

            $matches = abs($actual['price'] - $item['price']) < 0.001
                && (int) $actual['stock'] === $item['stock']
                && abs($actual['weight'] - $expected_weight) < 0.001
                && abs($actual['dimensions_cm']['length'] - $package['length']) < 0.001
                && abs($actual['dimensions_cm']['width'] - $package['width']) < 0.001
                && abs($actual['dimensions_cm']['height'] - $package['height']) < 0.001
                && empty($legacy_meta);

            if ($matches) {
                ++$matching_item_count;
                continue;
            }

            $mismatches[] = array(
                'sku' => $sku,
                'expected' => array(
                    'price' => $item['price'],
                    'stock' => $item['stock'],
                    'weight' => $expected_weight,
                    'dimensions_cm' => array(
                        'length' => $package['length'],
                        'width' => $package['width'],
                        'height' => $package['height'],
                    ),
                ),
                'actual' => $actual,
                'legacy_package_metadata' => $legacy_meta,
            );
        }

        return array(
            'verified' => empty($missing_skus) && empty($mismatches),
            'item_count' => count(self::ITEMS),
            'matching_item_count' => $matching_item_count,
            'missing_skus' => $missing_skus,
            'mismatches' => $mismatches,
            'legacy_package_metadata_records' => $legacy_metadata_records,
        );
    }

    private static function can_manage_catalog(): bool
    {
        // Hostinger staging can clone an administrator role before WooCommerce has restored
        // its capability map. A site administrator is still an appropriate authority for this
        // one-time catalog operation; lower-privilege store users remain excluded.
        return current_user_can('manage_woocommerce') || current_user_can('manage_options');
    }

    /**
     * @param array{price: float, stock: int, package: string, net_weight: float} $item
     */
    private static function apply_package(WC_Product $product, array $item): void
    {
        $package = self::PACKAGES[$item['package']];
        $packed_weight = $item['net_weight'] + $package['tare'];
        $product->set_weight((string) $packed_weight);
        $product->set_length((string) $package['length']);
        $product->set_width((string) $package['width']);
        $product->set_height((string) $package['height']);
        // Production quotes come from the official Envia extension, which
        // consumes the native WooCommerce fields above. Do not recreate the
        // old duplicate package metadata during a catalog sync.
        foreach (array(
            '_lm_package_name',
            '_lm_package_weight_kg',
            '_lm_package_length_cm',
            '_lm_package_width_cm',
            '_lm_package_height_cm',
        ) as $meta_key) {
            $product->delete_meta_data($meta_key);
        }
    }

    /**
     * @return array{price: float, stock: int, package: string, net_weight: float}|null
     */
    private static function default_package_for(WC_Product_Variable $product): ?array
    {
        $default = (string) ($product->get_default_attributes()['acabado'] ?? '');
        foreach ($product->get_children() as $variation_id) {
            $variation = wc_get_product($variation_id);
            if (! $variation instanceof WC_Product_Variation) {
                continue;
            }
            if ($default === (string) ($variation->get_attributes()['acabado'] ?? '')) {
                return self::ITEMS[$variation->get_sku()] ?? null;
            }
        }

        return null;
    }
}
