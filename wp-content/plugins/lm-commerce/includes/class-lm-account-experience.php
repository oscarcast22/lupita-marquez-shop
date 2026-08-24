<?php
/**
 * Account presentation adjustments for the physical-product storefront.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Account_Experience
{
    private static bool $rendering_account_email = false;

    public static function init(): void
    {
        /* Registration is part of the public account entry point, not checkout-only. */
        add_filter('option_woocommerce_enable_myaccount_registration', static fn (): string => 'yes');
        add_filter('woocommerce_account_menu_items', array(__CLASS__, 'account_menu_items'));
        add_filter('woocommerce_account_menu_item_classes', array(__CLASS__, 'account_menu_menu_item_classes'), 10, 2);
        add_filter('woocommerce_get_script_data', array(__CLASS__, 'localize_password_control_copy'), 10, 2);
        add_filter('gettext', array(__CLASS__, 'translate_account_copy'), 10, 3);
        add_filter('woocommerce_add_error', array(__CLASS__, 'normalize_account_error_notice'));
        add_filter('woocommerce_add_success', array(__CLASS__, 'normalize_account_notice'));
        add_filter('woocommerce_add_notice', array(__CLASS__, 'normalize_account_notice'));
        add_filter('woocommerce_email_subject_customer_new_account', array(__CLASS__, 'new_account_email_subject'), 10, 2);
        add_filter('woocommerce_email_heading_customer_new_account', array(__CLASS__, 'new_account_email_heading'), 10, 2);
        add_filter('woocommerce_email_subject_customer_reset_password', array(__CLASS__, 'reset_password_email_subject'), 10, 2);
        add_filter('woocommerce_email_heading_customer_reset_password', array(__CLASS__, 'reset_password_email_heading'), 10, 2);
        add_action('woocommerce_email_header', array(__CLASS__, 'begin_account_email_translation'), 1, 2);
        add_action('woocommerce_email_footer', array(__CLASS__, 'end_account_email_translation'), PHP_INT_MAX);
        add_filter('woocommerce_get_privacy_policy_text', array(__CLASS__, 'registration_privacy_text'), 10, 2);
    }

    /**
     * @param array<string, string> $items
     * @return array<string, string>
     */
    public static function account_menu_items(array $items): array
    {
        return array(
            'orders' => __('Pedidos', 'lm-commerce'),
            'dashboard' => __('Mi perfil', 'lm-commerce'),
        );
    }

    /**
     * Keep profile highlighted while editing the customer details behind it.
     *
     * @param string[] $classes
     * @return string[]
     */
    public static function account_menu_menu_item_classes(array $classes, string $endpoint): array
    {
        if (
            'dashboard' === $endpoint
            && (is_wc_endpoint_url('edit-address') || is_wc_endpoint_url('edit-account'))
        ) {
            $classes[] = 'is-active';
        }

        return $classes;
    }

    /**
     * Keep WooCommerce's native password visibility action in the store language.
     */
    public static function localize_password_control_copy(mixed $params, string $handle): mixed
    {
        if ('woocommerce' !== $handle || ! is_array($params)) {
            return $params;
        }

        $params['i18n_password_show'] = esc_attr__('Mostrar contraseña', 'lm-commerce');
        $params['i18n_password_hide'] = esc_attr__('Ocultar contraseña', 'lm-commerce');

        return $params;
    }

    public static function translate_account_copy(string $translated, string $text, string $domain): string
    {
        if ('woocommerce' !== $domain) {
            return $translated;
        }

        if (self::$rendering_account_email) {
            return self::account_email_copy()[$text] ?? $translated;
        }

        if (! self::is_account_request()) {
            return $translated;
        }

        return self::account_page_copy()[$text] ?? $translated;
    }

    public static function normalize_account_error_notice(string $message): string
    {
        if (! self::is_account_request()) {
            return $message;
        }

        $plain_message = self::notice_text($message);

        if (
            str_contains($plain_message, 'The password you entered')
            || str_contains($plain_message, 'is not registered on this site')
            || str_contains($plain_message, 'Invalid username, email address or incorrect password')
        ) {
            return sprintf(
                __('No pudimos iniciar sesión con esos datos. Verifica tu correo y contraseña o <a href="%s">restablece tu contraseña</a>.', 'lm-commerce'),
                esc_url(wp_lostpassword_url())
            );
        }

        return self::normalize_account_notice($message);
    }

    public static function normalize_account_notice(string $message): string
    {
        if (! self::is_account_request()) {
            return $message;
        }

        return preg_replace('/^\s*<strong>\s*Error:?\s*<\/strong>\s*:?\s*/iu', '', $message) ?? $message;
    }

    public static function new_account_email_subject(string $subject, mixed $email): string
    {
        return sprintf(__('Tu cuenta en %s está lista', 'lm-commerce'), self::store_name());
    }

    public static function new_account_email_heading(string $heading, mixed $email): string
    {
        return sprintf(__('Bienvenida a %s', 'lm-commerce'), self::store_name());
    }

    public static function reset_password_email_subject(string $subject, mixed $email): string
    {
        return sprintf(__('Restablece tu contraseña en %s', 'lm-commerce'), self::store_name());
    }

    public static function reset_password_email_heading(string $heading, mixed $email): string
    {
        return __('Restablece tu contraseña', 'lm-commerce');
    }

    public static function begin_account_email_translation(string $heading, mixed $email): void
    {
        self::$rendering_account_email = is_object($email)
            && isset($email->id)
            && in_array($email->id, array('customer_new_account', 'customer_reset_password'), true);
    }

    public static function end_account_email_translation(mixed $email): void
    {
        if (is_object($email) && isset($email->id) && in_array($email->id, array('customer_new_account', 'customer_reset_password'), true)) {
            self::$rendering_account_email = false;
        }
    }

    /**
     * @return array<string, string>
     */
    private static function account_page_copy(): array
    {
        return array(
            'Confirm email address' => __('Confirmar correo electrónico', 'lm-commerce'),
            'Confirm your email address to check for past orders and link them to your account.' => __('Confirma tu correo electrónico para consultar pedidos anteriores y vincularlos a tu cuenta.', 'lm-commerce'),
            'State / County' => __('Estado', 'lm-commerce'),
            'Username is required.' => __('Ingresa tu correo electrónico o nombre de usuario.', 'lm-commerce'),
            'Please provide a valid email address.' => __('Ingresa un correo electrónico válido.', 'lm-commerce'),
            'An account is already registered with %s. Please log in or use a different email address.' => __('Ya existe una cuenta asociada con %s. Inicia sesión o utiliza otra dirección.', 'lm-commerce'),
            'Enter a username or email address.' => __('Ingresa tu correo electrónico o nombre de usuario.', 'lm-commerce'),
            'Invalid username or email.' => __('No encontramos una cuenta con esos datos. Verifica tu correo e inténtalo de nuevo.', 'lm-commerce'),
            'Password reset is not allowed for this user' => __('No es posible restablecer la contraseña de esta cuenta.', 'lm-commerce'),
            'This key is invalid or has already been used. Please reset your password again if needed.' => __('Este enlace ya no es válido. Solicita uno nuevo para restablecer tu contraseña.', 'lm-commerce'),
            'Please enter your password.' => __('Ingresa una contraseña.', 'lm-commerce'),
            'Passwords do not match.' => __('Las contraseñas no coinciden.', 'lm-commerce'),
            'Your password has been reset successfully.' => __('Tu contraseña se actualizó correctamente.', 'lm-commerce'),
            'Your account was created successfully and a password has been sent to your email address.' => __('Tu cuenta se creó correctamente. Revisa tu correo para definir tu contraseña.', 'lm-commerce'),
            'Your account was created successfully. Your login details have been sent to your email address.' => __('Tu cuenta se creó correctamente. Revisa tu correo para consultar tus datos de acceso.', 'lm-commerce'),
            'Password reset email has been sent.' => __('Te enviamos un correo para restablecer tu contraseña.', 'lm-commerce'),
            'A password reset email has been sent to the email address on file for your account, but may take several minutes to show up in your inbox. Please wait at least 10 minutes before attempting another reset.' => __('Enviamos un correo para restablecer tu contraseña. Puede tardar unos minutos en aparecer; espera al menos 10 minutos antes de solicitar otro enlace.', 'lm-commerce'),
            'We have emailed you a new link to change your password.' => __('Te enviamos un nuevo enlace para cambiar tu contraseña.', 'lm-commerce'),
            'Please wait a moment before requesting another link to change your password.' => __('Espera un momento antes de solicitar otro enlace para cambiar tu contraseña.', 'lm-commerce'),
            'Sorry, we were unable to resend the link. Please try again.' => __('No pudimos reenviar el enlace. Inténtalo de nuevo.', 'lm-commerce'),
            'This password reset key is for a different user account. Please log out and try again.' => __('Este enlace corresponde a otra cuenta. Cierra sesión e inténtalo de nuevo.', 'lm-commerce'),
            '%1$sResend%2$s' => __('%1$sReenviar%2$s', 'lm-commerce'),
            'Your account is using a temporary password. We emailed you a link to change your password.' => __('Tu cuenta usa una contraseña temporal. Te enviamos un enlace para cambiarla.', 'lm-commerce'),
        );
    }

    /**
     * @return array<string, string>
     */
    private static function account_email_copy(): array
    {
        return array(
            'Hi %s,' => __('Hola %s,', 'lm-commerce'),
            'Thanks for creating an account on %s. Here’s a copy of your user details.' => __('Gracias por crear una cuenta en %s. Estos son tus datos de acceso.', 'lm-commerce'),
            'Username: <b>%s</b>' => __('Nombre de usuario: <b>%s</b>', 'lm-commerce'),
            'Set your new password.' => __('Crea tu contraseña.', 'lm-commerce'),
            'Click here to set your new password.' => __('Crea tu contraseña.', 'lm-commerce'),
            'You can access your account area to view orders, change your password, and more via the link below:' => __('Desde Mi cuenta puedes consultar tus pedidos, actualizar tu contraseña y gestionar tus datos.', 'lm-commerce'),
            'Thanks for creating an account on %1$s. Your username is %2$s. You can access your account area to view orders, change your password, and more at: %3$s' => __('Gracias por crear una cuenta en %1$s. Tu nombre de usuario es %2$s. Desde %3$s puedes consultar pedidos, actualizar tu contraseña y gestionar tus datos.', 'lm-commerce'),
            'My account' => __('Mi cuenta', 'lm-commerce'),
            'Someone has requested a new password for the following account on %s:' => __('Recibimos una solicitud para restablecer la contraseña de esta cuenta en %s:', 'lm-commerce'),
            'Username: %s' => __('Nombre de usuario: %s', 'lm-commerce'),
            'If you didn’t make this request, just ignore this email. If you’d like to proceed, reset your password via the link below:' => __('Si no hiciste esta solicitud, puedes ignorar este correo. Si deseas continuar, restablece tu contraseña desde el siguiente enlace:', 'lm-commerce'),
            'If you didn\'t make this request, just ignore this email. If you\'d like to proceed:' => __('Si no hiciste esta solicitud, puedes ignorar este correo. Si deseas continuar:', 'lm-commerce'),
            'Reset your password' => __('Restablecer contraseña', 'lm-commerce'),
            'Click here to reset your password' => __('Restablecer contraseña', 'lm-commerce'),
        );
    }

    private static function is_account_request(): bool
    {
        if (function_exists('is_account_page') && is_account_page()) {
            return true;
        }

        if (! function_exists('wc_get_page_permalink') || ! isset($_SERVER['REQUEST_URI'])) {
            return false;
        }

        $account_path = wp_parse_url(wc_get_page_permalink('myaccount'), PHP_URL_PATH);
        $request_path = wp_parse_url(wp_unslash($_SERVER['REQUEST_URI']), PHP_URL_PATH);

        return is_string($account_path)
            && is_string($request_path)
            && str_starts_with(trailingslashit($request_path), trailingslashit($account_path));
    }

    private static function notice_text(string $message): string
    {
        $plain_message = trim(wp_strip_all_tags($message));

        return preg_replace('/^Error:\s*/i', '', $plain_message) ?? $plain_message;
    }

    private static function store_name(): string
    {
        return wp_specialchars_decode(get_option('blogname'), ENT_QUOTES);
    }

    public static function registration_privacy_text(string $text, string $type): string
    {
        if ('registration' !== $type) {
            return $text;
        }

        $privacy_url = get_privacy_policy_url();
        if ('' === $privacy_url) {
            return __('Tus datos personales se utilizarán para mejorar tu experiencia en este sitio y gestionar el acceso a tu cuenta.', 'lm-commerce');
        }

        return sprintf(
            __('Tus datos personales se utilizarán para mejorar tu experiencia en este sitio, gestionar el acceso a tu cuenta y otros fines descritos en nuestra <a href="%s">política de privacidad</a>.', 'lm-commerce'),
            esc_url($privacy_url)
        );
    }
}
