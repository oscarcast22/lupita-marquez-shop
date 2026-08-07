<?php
/**
 * Per-product personalization fields and protected uploads.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Personalization
{
    public static function init(): void
    {
        add_action('woocommerce_before_add_to_cart_button', array(__CLASS__, 'render_fields'));
        add_filter('woocommerce_add_to_cart_validation', array(__CLASS__, 'validate'), 10, 3);
        add_filter('woocommerce_add_cart_item_data', array(__CLASS__, 'capture'), 10, 3);
        add_filter('woocommerce_get_item_data', array(__CLASS__, 'display_cart_data'), 10, 2);
        add_action('woocommerce_before_calculate_totals', array(__CLASS__, 'apply_surcharge'));
        add_action('woocommerce_checkout_create_order_line_item', array(__CLASS__, 'create_order_line_item'), 10, 4);
        add_action('woocommerce_after_order_itemmeta', array(__CLASS__, 'render_admin_download'), 10, 3);
        add_action('admin_post_lm_private_file', array(__CLASS__, 'download'));
        add_action('woocommerce_order_status_completed', array(__CLASS__, 'schedule_cleanup'));
        add_action('woocommerce_order_status_cancelled', array(__CLASS__, 'schedule_cleanup'));
        add_action('woocommerce_order_status_refunded', array(__CLASS__, 'schedule_cleanup'));
        add_action('lm_cleanup_personalization', array(__CLASS__, 'cleanup'));
    }

    public static function render_fields(): void
    {
        global $product;
        if (! $product instanceof WC_Product || 'name_image' !== $product->get_meta('_lm_personalization')) {
            return;
        }

        $surcharge = (float) $product->get_meta('_lm_personalization_surcharge');
        wp_nonce_field('lm_personalization', 'lm_personalization_nonce');
        ?>
        <fieldset class="lm-personalization">
            <legend><strong><?php esc_html_e('Personaliza tu pieza', 'lm-commerce'); ?></strong></legend>
            <p>
                <label for="lm_personalization_name"><?php esc_html_e('Nombre o texto corto', 'lm-commerce'); ?></label>
                <input id="lm_personalization_name" name="lm_personalization_name" type="text" maxlength="60" autocomplete="off" required>
            </p>
            <p>
                <label for="lm_personalization_image"><?php esc_html_e('Imagen de referencia', 'lm-commerce'); ?></label>
                <input id="lm_personalization_image" name="lm_personalization_image" type="file" accept="image/jpeg,image/png,image/webp" required>
                <span class="lm-personalization__help"><?php esc_html_e('JPG, PNG o WebP, máximo 8 MB. El archivo se almacena de forma privada.', 'lm-commerce'); ?></span>
            </p>
            <?php if ($surcharge > 0) : ?>
                <p class="lm-personalization__help">
                    <?php echo esc_html(sprintf(__('Recargo de personalización: %s', 'lm-commerce'), wp_strip_all_tags(wc_price($surcharge)))); ?>
                </p>
            <?php endif; ?>
        </fieldset>
        <?php
    }

    public static function validate(bool $passed, int $product_id, int $quantity): bool
    {
        $product = wc_get_product($product_id);
        if (! $product || 'name_image' !== $product->get_meta('_lm_personalization')) {
            return $passed;
        }

        if (
            empty($_POST['lm_personalization_nonce']) ||
            ! wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['lm_personalization_nonce'])), 'lm_personalization')
        ) {
            wc_add_notice(__('No fue posible validar la personalización. Recarga la página e inténtalo de nuevo.', 'lm-commerce'), 'error');
            return false;
        }

        $name = isset($_POST['lm_personalization_name']) ? trim(sanitize_text_field(wp_unslash($_POST['lm_personalization_name']))) : '';
        if ('' === $name || mb_strlen($name) > 60) {
            wc_add_notice(__('Escribe un nombre o texto de hasta 60 caracteres.', 'lm-commerce'), 'error');
            $passed = false;
        }

        $file = $_FILES['lm_personalization_image'] ?? null;
        if (! is_array($file) || UPLOAD_ERR_OK !== ($file['error'] ?? UPLOAD_ERR_NO_FILE)) {
            wc_add_notice(__('Selecciona una imagen de referencia.', 'lm-commerce'), 'error');
            return false;
        }

        if ((int) ($file['size'] ?? 0) > 8 * MB_IN_BYTES) {
            wc_add_notice(__('La imagen no puede superar 8 MB.', 'lm-commerce'), 'error');
            $passed = false;
        }

        $checked = wp_check_filetype_and_ext((string) $file['tmp_name'], (string) $file['name']);
        $allowed = array('image/jpeg', 'image/png', 'image/webp');
        if (empty($checked['type']) || ! in_array($checked['type'], $allowed, true)) {
            wc_add_notice(__('La imagen debe ser JPG, PNG o WebP.', 'lm-commerce'), 'error');
            $passed = false;
        }

        return $passed;
    }

    public static function capture(array $cart_item_data, int $product_id, int $variation_id): array
    {
        $product = wc_get_product($variation_id ?: $product_id);
        if (! $product || 'name_image' !== $product->get_meta('_lm_personalization')) {
            // Variations inherit the setting from their parent.
            $product = wc_get_product($product_id);
        }
        if (! $product || 'name_image' !== $product->get_meta('_lm_personalization')) {
            return $cart_item_data;
        }

        $name = isset($_POST['lm_personalization_name']) ? sanitize_text_field(wp_unslash($_POST['lm_personalization_name'])) : '';
        $stored = self::store_private_upload($_FILES['lm_personalization_image'] ?? array());
        if (is_wp_error($stored)) {
            throw new RuntimeException(esc_html($stored->get_error_message()));
        }

        $cart_item_data['lm_personalization'] = array(
            'name' => $name,
            'file' => $stored,
            'surcharge' => (float) $product->get_meta('_lm_personalization_surcharge'),
            'key' => wp_generate_uuid4(),
        );
        $priced_product = wc_get_product($variation_id ?: $product_id);
        $cart_item_data['lm_base_price'] = $priced_product ? (float) $priced_product->get_price() : 0.0;
        return $cart_item_data;
    }

    public static function display_cart_data(array $item_data, array $cart_item): array
    {
        $data = $cart_item['lm_personalization'] ?? null;
        if (! is_array($data)) {
            return $item_data;
        }
        $item_data[] = array('key' => __('Personalización', 'lm-commerce'), 'value' => esc_html((string) $data['name']));
        $item_data[] = array('key' => __('Imagen', 'lm-commerce'), 'value' => __('Archivo recibido', 'lm-commerce'));
        return $item_data;
    }

    public static function apply_surcharge(WC_Cart $cart): void
    {
        if (is_admin() && ! wp_doing_ajax()) {
            return;
        }
        foreach ($cart->get_cart() as $cart_item) {
            $data = $cart_item['lm_personalization'] ?? null;
            if (! is_array($data) || empty($data['surcharge']) || ! $cart_item['data'] instanceof WC_Product) {
                continue;
            }
            $base = (float) ($cart_item['lm_base_price'] ?? $cart_item['data']->get_price());
            $cart_item['data']->set_price($base + (float) $data['surcharge']);
        }
    }

    public static function create_order_line_item(WC_Order_Item_Product $item, string $cart_item_key, array $values, WC_Order $order): void
    {
        $data = $values['lm_personalization'] ?? null;
        if (! is_array($data)) {
            return;
        }
        $item->add_meta_data(__('Personalización', 'lm-commerce'), (string) $data['name'], true);
        $item->add_meta_data(__('Imagen de referencia', 'lm-commerce'), __('Archivo recibido', 'lm-commerce'), true);
        $item->add_meta_data('_lm_private_file', $data['file'], true);
    }

    public static function render_admin_download(int $item_id, WC_Order_Item $item, $product): void
    {
        if (! is_admin() || ! current_user_can('manage_woocommerce')) {
            return;
        }
        $file = $item->get_meta('_lm_private_file', true);
        if (! is_array($file) || empty($file['path'])) {
            return;
        }
        $url = wp_nonce_url(
            admin_url('admin-post.php?action=lm_private_file&item_id=' . $item_id),
            'lm_private_file_' . $item_id
        );
        echo '<p><a class="button" href="' . esc_url($url) . '">' . esc_html__('Descargar imagen de personalización', 'lm-commerce') . '</a></p>';
    }

    public static function download(): void
    {
        if (! current_user_can('manage_woocommerce')) {
            wp_die(esc_html__('No tienes permiso para descargar este archivo.', 'lm-commerce'), '', array('response' => 403));
        }
        $item_id = isset($_GET['item_id']) ? absint($_GET['item_id']) : 0;
        check_admin_referer('lm_private_file_' . $item_id);
        $item = WC_Order_Factory::get_order_item($item_id);
        $file = $item ? $item->get_meta('_lm_private_file', true) : null;
        if (! is_array($file) || empty($file['path']) || ! is_readable($file['path'])) {
            wp_die(esc_html__('El archivo ya no existe.', 'lm-commerce'), '', array('response' => 404));
        }
        nocache_headers();
        header('Content-Type: ' . ($file['type'] ?? 'application/octet-stream'));
        header('Content-Disposition: attachment; filename="' . sanitize_file_name((string) ($file['original'] ?? 'referencia')) . '"');
        header('Content-Length: ' . (string) filesize($file['path']));
        readfile($file['path']);
        exit;
    }

    public static function schedule_cleanup(int $order_id): void
    {
        if (! wp_next_scheduled('lm_cleanup_personalization', array($order_id))) {
            wp_schedule_single_event(time() + 90 * DAY_IN_SECONDS, 'lm_cleanup_personalization', array($order_id));
        }
    }

    public static function cleanup(int $order_id): void
    {
        $order = wc_get_order($order_id);
        if (! $order) {
            return;
        }
        foreach ($order->get_items() as $item) {
            $file = $item->get_meta('_lm_private_file', true);
            if (is_array($file) && ! empty($file['path']) && is_file($file['path'])) {
                wp_delete_file($file['path']);
            }
            $item->delete_meta_data('_lm_private_file');
            $item->save();
        }
        $order->add_order_note(__('Las imágenes privadas de personalización se eliminaron según la política de retención.', 'lm-commerce'));
    }

    /**
     * @return array<string, string>|WP_Error
     */
    private static function store_private_upload(array $file)
    {
        $uploads = wp_upload_dir();
        if (! empty($uploads['error'])) {
            return new WP_Error('lm_upload_dir', (string) $uploads['error']);
        }
        $directory = trailingslashit($uploads['basedir']) . 'lm-private';
        if (! wp_mkdir_p($directory)) {
            return new WP_Error('lm_upload_create', __('No se pudo crear el almacenamiento privado.', 'lm-commerce'));
        }
        $protection = $directory . '/.htaccess';
        if (! file_exists($protection)) {
            file_put_contents($protection, "Require all denied\nDeny from all\n"); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
        }
        $index = $directory . '/index.php';
        if (! file_exists($index)) {
            file_put_contents($index, "<?php\nhttp_response_code(404);\nexit;\n"); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
        }
        $extension = strtolower((string) pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
        $filename = wp_generate_uuid4() . '.' . $extension;
        $path = trailingslashit($directory) . $filename;
        if (! is_uploaded_file((string) ($file['tmp_name'] ?? '')) || ! move_uploaded_file($file['tmp_name'], $path)) {
            return new WP_Error('lm_upload_move', __('No se pudo guardar la imagen de referencia.', 'lm-commerce'));
        }
        return array(
            'path' => $path,
            'original' => sanitize_file_name((string) $file['name']),
            'type' => sanitize_mime_type((string) $file['type']),
        );
    }
}
