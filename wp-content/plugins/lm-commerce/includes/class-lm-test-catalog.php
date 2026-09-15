<?php
/**
 * Admin-only, reversible preparation of the existing production catalog for tests.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Test_Catalog
{
    /**
     * Product dimensions remain untouched. These are provisional shipping boxes and packed weights.
     *
     * @var array<string, array{name: string, weight: float, length: int, width: int, height: int}>
     */
    private const PACKAGES = array(
        'LM-ALT-CHI' => array('name' => 'Caja chica cuadrada', 'weight' => 2.2, 'length' => 35, 'width' => 35, 'height' => 5),
        'LM-ALT-CHI-ARC' => array('name' => 'Caja chica cuadrada', 'weight' => 2.6, 'length' => 35, 'width' => 35, 'height' => 5),
        'LM-ALT-MED' => array('name' => 'Caja grande plana', 'weight' => 4.8, 'length' => 65, 'width' => 45, 'height' => 10),
        'LM-ALT-MED-ARC' => array('name' => 'Caja grande plana', 'weight' => 5.3, 'length' => 65, 'width' => 45, 'height' => 10),
        'LM-ALT-GRA' => array('name' => 'Caja extra grande plana', 'weight' => 8.5, 'length' => 75, 'width' => 75, 'height' => 7),
        'LM-ALT-GRA-ARC' => array('name' => 'Caja extra grande plana', 'weight' => 9.5, 'length' => 75, 'width' => 75, 'height' => 7),
        'LM-ALT-GIG' => array('name' => 'Caja gigante plana', 'weight' => 16.5, 'length' => 100, 'width' => 100, 'height' => 20),
        'LM-NIC-001' => array('name' => 'Caja chica plana', 'weight' => 1.7, 'length' => 35, 'width' => 25, 'height' => 5),
        'LM-MAS-ALT' => array('name' => 'Caja grande alta', 'weight' => 4.5, 'length' => 62, 'width' => 42, 'height' => 32),
        'LM-CRU-ALA' => array('name' => 'Caja grande plana', 'weight' => 3.0, 'length' => 65, 'width' => 45, 'height' => 10),
        'LM-ROP-MIN' => array('name' => 'Caja grande plana', 'weight' => 5.5, 'length' => 65, 'width' => 45, 'height' => 10),
        'LM-ALC-AHO' => array('name' => 'Caja chica plana', 'weight' => 1.2, 'length' => 35, 'width' => 25, 'height' => 5),
    );

    public static function init(): void
    {
        add_action('admin_menu', array(__CLASS__, 'page'));
        add_action('admin_post_lm_prepare_test_catalog', array(__CLASS__, 'prepare'));
    }

    public static function page(): void
    {
        add_management_page(
            __('Preparar catálogo de pruebas', 'lm-commerce'),
            __('Catálogo de pruebas', 'lm-commerce'),
            'manage_woocommerce',
            'lm-test-catalog',
            array(__CLASS__, 'render')
        );
    }

    public static function render(): void
    {
        if (! current_user_can('manage_woocommerce')) {
            return;
        }
        $updated = absint($_GET['updated'] ?? 0);
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Preparar catálogo de pruebas', 'lm-commerce'); ?></h1>
            <?php if ($updated) : ?>
                <div class="notice notice-success"><p><?php echo esc_html(sprintf(_n('%d producto actualizado.', '%d productos actualizados.', $updated, 'lm-commerce'), $updated)); ?></p></div>
            <?php endif; ?>
            <p><?php esc_html_e('Conserva los precios y las medidas visibles actuales. Cambia sólo inventario y embalaje interno para pruebas de Envia.com.', 'lm-commerce'); ?></p>
            <ul style="list-style: disc; padding-left: 1.5rem;">
                <li><?php esc_html_e('5 unidades ficticias por cada SKU o variación.', 'lm-commerce'); ?></li>
                <li><?php esc_html_e('Una unidad por caja; cotización mediante las cajas propuestas.', 'lm-commerce'); ?></li>
                <li><?php esc_html_e('Pesos, cajas y stock son temporales y se sustituyen con el Excel validado de la clienta.', 'lm-commerce'); ?></li>
            </ul>
            <form action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
                <input type="hidden" name="action" value="lm_prepare_test_catalog">
                <?php wp_nonce_field('lm_prepare_test_catalog'); ?>
                <?php submit_button(__('Aplicar datos temporales', 'lm-commerce'), 'primary', 'submit', false); ?>
            </form>
        </div>
        <?php
    }

    public static function prepare(): void
    {
        if (! current_user_can('manage_woocommerce')) {
            wp_die(esc_html__('No tienes permiso para preparar el catálogo.', 'lm-commerce'), 403);
        }
        check_admin_referer('lm_prepare_test_catalog');

        update_option('woocommerce_manage_stock', 'yes');
        $updated = 0;
        foreach (self::PACKAGES as $sku => $package) {
            $product_id = wc_get_product_id_by_sku($sku);
            $product = $product_id ? wc_get_product($product_id) : false;
            if (! $product instanceof WC_Product) {
                continue;
            }
            self::apply_package($product, $package);
            $product->update_meta_data('_lm_stock_mode', 'stock');

            if ($product instanceof WC_Product_Variable) {
                $product->set_manage_stock(false);
                $product->set_stock_status('instock');
                $product->set_backorders('no');
                $product->save();
                foreach ($product->get_children() as $variation_id) {
                    $variation = wc_get_product($variation_id);
                    if (! $variation instanceof WC_Product_Variation) {
                        continue;
                    }
                    self::apply_package($variation, $package);
                    $variation->set_manage_stock(true);
                    $variation->set_stock_quantity(5);
                    $variation->set_stock_status('instock');
                    $variation->set_backorders('no');
                    $variation->save();
                }
                WC_Product_Variable::sync($product->get_id());
            } else {
                $product->set_manage_stock(true);
                $product->set_stock_quantity(5);
                $product->set_stock_status('instock');
                $product->set_backorders('no');
                $product->save();
            }
            wc_delete_product_transients($product->get_id());
            ++$updated;
        }
        update_option('lm_test_catalog_prepared_at', gmdate('c'));
        wp_safe_redirect(add_query_arg(array('page' => 'lm-test-catalog', 'updated' => $updated), admin_url('tools.php')));
        exit;
    }

    /**
     * @param array{name: string, weight: float, length: int, width: int, height: int} $package
     */
    private static function apply_package(WC_Product $product, array $package): void
    {
        $product->update_meta_data('_lm_package_name', $package['name']);
        $product->update_meta_data('_lm_package_weight_kg', (string) $package['weight']);
        $product->update_meta_data('_lm_package_length_cm', (string) $package['length']);
        $product->update_meta_data('_lm_package_width_cm', (string) $package['width']);
        $product->update_meta_data('_lm_package_height_cm', (string) $package['height']);
    }
}
