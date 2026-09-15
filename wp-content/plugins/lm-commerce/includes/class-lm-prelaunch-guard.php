<?php
/**
 * Restrict a pre-launch store without putting an HTTP password in front of payment webhooks.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Prelaunch_Guard
{
    private const OPTION = 'lm_prelaunch_enabled';

    public static function init(): void
    {
        add_action('template_redirect', array(__CLASS__, 'restrict_store'), 0);
        add_filter('wp_robots', array(__CLASS__, 'robots'));
        add_action('admin_menu', array(__CLASS__, 'settings_page'));
        add_action('admin_init', array(__CLASS__, 'register_setting'));
    }

    public static function restrict_store(): void
    {
        if (! self::enabled() || current_user_can('manage_woocommerce')) {
            return;
        }

        status_header(503);
        header('Retry-After: 3600');
        nocache_headers();
        wp_die(
            esc_html__('La tienda está en preparación. Vuelve pronto.', 'lm-commerce'),
            esc_html__('Lupita Márquez', 'lm-commerce'),
            array('response' => 503)
        );
    }

    /**
     * REST and wc-api requests are intentionally not intercepted here. Mercado Pago receives
     * payment notifications through those endpoints while the public templates remain closed.
     *
     * @param array<string, mixed> $robots
     * @return array<string, mixed>
     */
    public static function robots(array $robots): array
    {
        if (self::enabled()) {
            $robots['noindex'] = true;
            $robots['nofollow'] = true;
        }
        return $robots;
    }

    public static function settings_page(): void
    {
        add_options_page(
            __('Modo de pruebas', 'lm-commerce'),
            __('Modo de pruebas', 'lm-commerce'),
            'manage_options',
            'lm-prelaunch',
            array(__CLASS__, 'render_settings_page')
        );
    }

    public static function register_setting(): void
    {
        register_setting('lm_prelaunch', self::OPTION, array(
            'type' => 'boolean',
            'sanitize_callback' => static fn($value): string => $value ? 'yes' : 'no',
            'default' => 'no',
        ));
    }

    public static function render_settings_page(): void
    {
        if (! current_user_can('manage_options')) {
            return;
        }
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Modo de pruebas', 'lm-commerce'); ?></h1>
            <form action="options.php" method="post">
                <?php settings_fields('lm_prelaunch'); ?>
                <label>
                    <input type="checkbox" name="<?php echo esc_attr(self::OPTION); ?>" value="1" <?php checked(self::enabled()); ?>>
                    <?php esc_html_e('Cerrar la tienda al público mientras se realizan pruebas', 'lm-commerce'); ?>
                </label>
                <p class="description"><?php esc_html_e('Los administradores pueden navegar y comprar para probar. Las notificaciones REST de pago no se bloquean.', 'lm-commerce'); ?></p>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }

    private static function enabled(): bool
    {
        return (defined('LM_PRELAUNCH_MODE') && LM_PRELAUNCH_MODE)
            || 'yes' === get_option(self::OPTION, 'no');
    }
}
