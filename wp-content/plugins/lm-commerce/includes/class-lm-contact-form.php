<?php
/**
 * Contact form delivery for the public site.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Contact_Form
{
    private const ACTION = 'lm_contact_form';
    private const NONCE_ACTION = 'lm_contact_form_submit';
    private const SHORTCODE = 'lm_contact_form';
    private static string $mail_error = '';

    public static function init(): void
    {
        add_shortcode(self::SHORTCODE, array(__CLASS__, 'render'));
        add_action('admin_post_' . self::ACTION, array(__CLASS__, 'handle'));
        add_action('admin_post_nopriv_' . self::ACTION, array(__CLASS__, 'handle'));
        add_action('phpmailer_init', array(__CLASS__, 'configure_local_mailer'));
        add_action('wp_mail_failed', array(__CLASS__, 'capture_mail_error'));
    }

    public static function configure_local_mailer(PHPMailer\PHPMailer\PHPMailer $mailer): void
    {
        if ('local' !== wp_get_environment_type()) {
            return;
        }

        $mailer->isSMTP();
        $mailer->Host = 'mailpit';
        $mailer->Port = 1025;
        $mailer->SMTPAuth = false;
        $mailer->SMTPAutoTLS = false;
        $mailer->SMTPSecure = '';
    }

    public static function capture_mail_error(WP_Error $error): void
    {
        self::$mail_error = $error->get_error_message();
    }

    public static function render(): string
    {
        $status = isset($_GET['lm_contact']) ? sanitize_key(wp_unslash($_GET['lm_contact'])) : '';
        $messages = array(
            'sent' => array('success', __('Gracias. Recibimos tu mensaje y te responderemos tan pronto como sea posible.', 'lm-commerce')),
            'invalid' => array('error', __('Revisa los campos señalados e inténtalo de nuevo.', 'lm-commerce')),
            'rate-limited' => array('error', __('Espera un momento antes de enviar otro mensaje.', 'lm-commerce')),
            'error' => array('error', __('No fue posible enviar tu mensaje. Inténtalo nuevamente en unos minutos.', 'lm-commerce')),
        );
        $notice = $messages[$status] ?? null;

        ob_start();
        ?>
        <form class="lm-contact-form" id="lm-contact-form" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post" data-lm-contact-form>
            <p class="lm-contact-form__field">
                <label for="lm-contact-name"><?php esc_html_e('Nombre', 'lm-commerce'); ?> <span class="lm-contact-form__required" aria-hidden="true">*</span></label>
                <input id="lm-contact-name" name="name" type="text" autocomplete="name" required>
            </p>
            <p class="lm-contact-form__field">
                <label for="lm-contact-email"><?php esc_html_e('Correo electrónico', 'lm-commerce'); ?> <span class="lm-contact-form__required" aria-hidden="true">*</span></label>
                <input id="lm-contact-email" name="email" type="email" autocomplete="email" required>
            </p>
            <p class="lm-contact-form__field">
                <label for="lm-contact-phone"><?php esc_html_e('Teléfono', 'lm-commerce'); ?> <span class="lm-contact-form__optional"><?php esc_html_e('(opcional)', 'lm-commerce'); ?></span></label>
                <input id="lm-contact-phone" name="phone" type="tel" autocomplete="tel">
            </p>
            <p class="lm-contact-form__field">
                <label for="lm-contact-subject"><?php esc_html_e('Asunto', 'lm-commerce'); ?> <span class="lm-contact-form__required" aria-hidden="true">*</span></label>
                <input id="lm-contact-subject" name="subject" type="text" required>
            </p>
            <p class="lm-contact-form__field lm-contact-form__field--wide">
                <label for="lm-contact-message"><?php esc_html_e('Mensaje', 'lm-commerce'); ?> <span class="lm-contact-form__required" aria-hidden="true">*</span></label>
                <textarea id="lm-contact-message" name="message" required></textarea>
            </p>
            <p class="lm-contact-form__trap" aria-hidden="true">
                <label for="lm-contact-company"><?php esc_html_e('Empresa', 'lm-commerce'); ?></label>
                <input id="lm-contact-company" name="company" type="text" tabindex="-1" autocomplete="off">
            </p>
            <p class="lm-contact-form__consent">
                <label class="lm-contact-form__consent-label" for="lm-contact-privacy">
                    <input id="lm-contact-privacy" name="privacy" type="checkbox" value="1" required>
                    <span><?php echo wp_kses_post(sprintf(__('He leído y acepto el <a href="%s">aviso de privacidad</a>.', 'lm-commerce'), esc_url(home_url('/aviso-de-privacidad/')))); ?></span>
                </label>
            </p>
            <p class="lm-contact-form__status<?php echo $notice ? ' is-' . esc_attr($notice[0]) : ''; ?>" role="status" aria-live="polite" aria-atomic="true" tabindex="-1" data-lm-contact-status><?php echo $notice ? esc_html($notice[1]) : ''; ?></p>
            <div class="lm-contact-form__actions">
                <div class="lm-contact-form__submit">
                    <button class="lm-button" type="submit" data-lm-contact-submit><?php esc_html_e('Enviar mensaje', 'lm-commerce'); ?></button>
                </div>
                <p class="lm-contact-form__note"><?php esc_html_e('Los campos con * son obligatorios.', 'lm-commerce'); ?></p>
            </div>
            <div class="lm-contact-form__metadata" hidden>
                <input type="hidden" name="action" value="<?php echo esc_attr(self::ACTION); ?>">
                <?php wp_nonce_field(self::NONCE_ACTION, 'lm_contact_nonce'); ?>
            </div>
        </form>
        <?php
        $markup = (string) ob_get_clean();

        /* The core Shortcode block applies wpautop() to the rendered output.
         * Remove only inter-tag whitespace so it cannot introduce line breaks or
         * empty paragraphs inside the form's component markup. */
        $normalized_markup = preg_replace('/>\s+</', '><', trim($markup));

        return is_string($normalized_markup) ? $normalized_markup : $markup;
    }

    public static function handle(): void
    {
        $is_async = isset($_POST['lm_async']) && '1' === sanitize_text_field(wp_unslash($_POST['lm_async']));

        if (! isset($_POST['lm_contact_nonce']) || ! wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['lm_contact_nonce'])), self::NONCE_ACTION)) {
            self::respond(false, 'invalid', __('No fue posible validar la solicitud. Recarga la página e inténtalo otra vez.', 'lm-commerce'), $is_async);
        }

        $company = isset($_POST['company']) ? sanitize_text_field(wp_unslash($_POST['company'])) : '';
        if ('' !== $company) {
            self::respond(true, 'sent', __('Gracias. Recibimos tu mensaje.', 'lm-commerce'), $is_async);
        }

        $name = isset($_POST['name']) ? sanitize_text_field(wp_unslash($_POST['name'])) : '';
        $email = isset($_POST['email']) ? sanitize_email(wp_unslash($_POST['email'])) : '';
        $phone = isset($_POST['phone']) ? sanitize_text_field(wp_unslash($_POST['phone'])) : '';
        $subject = isset($_POST['subject']) ? sanitize_text_field(wp_unslash($_POST['subject'])) : '';
        $message = isset($_POST['message']) ? sanitize_textarea_field(wp_unslash($_POST['message'])) : '';
        $privacy = isset($_POST['privacy']) && '1' === sanitize_text_field(wp_unslash($_POST['privacy']));

        if ('' === $name || ! is_email($email) || '' === $subject || '' === $message || ! $privacy) {
            self::respond(false, 'invalid', __('Completa los campos obligatorios con información válida.', 'lm-commerce'), $is_async);
        }

        $rate_key = self::rate_key($email);
        if (get_transient($rate_key)) {
            self::respond(false, 'rate-limited', __('Espera un momento antes de enviar otro mensaje.', 'lm-commerce'), $is_async);
        }

        $recipient = sanitize_email((string) get_option('admin_email'));
        $mail_subject = sprintf(__('Contacto web: %s', 'lm-commerce'), $subject);
        $mail_body = implode("\n", array(
            sprintf(__('Nombre: %s', 'lm-commerce'), $name),
            sprintf(__('Correo: %s', 'lm-commerce'), $email),
            sprintf(__('Teléfono: %s', 'lm-commerce'), '' !== $phone ? $phone : __('No proporcionado', 'lm-commerce')),
            sprintf(__('Asunto: %s', 'lm-commerce'), $subject),
            '',
            $message,
        ));
        $headers = array(
            'Content-Type: text/plain; charset=UTF-8',
            sprintf('From: %s <%s>', sanitize_text_field(get_bloginfo('name')), $recipient),
            sprintf('Reply-To: %s <%s>', $name, $email),
        );
        $sent = is_email($recipient) && wp_mail($recipient, $mail_subject, $mail_body, $headers);

        if (! $sent) {
            if (defined('WP_DEBUG') && WP_DEBUG && '' !== self::$mail_error) {
                error_log('LM contact mail: ' . self::$mail_error);
            }
            self::respond(false, 'error', __('No fue posible enviar tu mensaje. Inténtalo nuevamente en unos minutos.', 'lm-commerce'), $is_async);
        }

        set_transient($rate_key, '1', 30);
        self::respond(true, 'sent', __('Gracias. Recibimos tu mensaje y te responderemos tan pronto como sea posible.', 'lm-commerce'), $is_async);
    }

    private static function rate_key(string $email): string
    {
        $address = isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])) : 'unknown';
        return 'lm_contact_' . substr(hash_hmac('sha256', $address . '|' . $email, wp_salt('nonce')), 0, 32);
    }

    private static function respond(bool $success, string $status, string $message, bool $is_async): void
    {
        if ($is_async) {
            if ($success) {
                wp_send_json_success(array('message' => $message));
            }
            wp_send_json_error(array('message' => $message), 'rate-limited' === $status ? 429 : 400);
        }

        $target = wp_get_referer() ?: home_url('/contacto/');
        $target = add_query_arg('lm_contact', $status, remove_query_arg('lm_contact', $target));
        wp_safe_redirect($target . '#lm-contact-form');
        exit;
    }
}
