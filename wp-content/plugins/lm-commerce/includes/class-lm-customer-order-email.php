<?php
/**
 * Ensures the customer processing email is not skipped after an asynchronous
 * Mercado Pago payment notification.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Customer_Order_Email
{
    private const FALLBACK_HOOK = 'lm_send_customer_processing_email_fallback';
    private const FALLBACK_GROUP = 'lm-commerce';
    private const NATIVE_TRIGGER_TRANSIENT = 'lm_customer_processing_email_triggered_';
    private const FALLBACK_DELAY = 180;
    /** @var array<string, mixed> */
    private static array $last_dispatch = array();
    private static bool $capture_active = false;

    public static function init(): void
    {
        if ('production' !== wp_get_environment_type()) {
            return;
        }

        /*
         * WooCommerce invokes this filter immediately before it sends its
         * native customer-processing email. A short-lived marker lets the
         * fallback distinguish a normal notification from a status update
         * performed asynchronously by a gateway that skipped the notifier.
         */
        add_filter('woocommerce_email_enabled_customer_processing_order', array(__CLASS__, 'mark_native_trigger'), 100, 3);
        add_action('woocommerce_payment_complete', array(__CLASS__, 'schedule_fallback'), 100);
        add_action(self::FALLBACK_HOOK, array(__CLASS__, 'send_fallback'), 10, 1);
    }

    /**
     * @param mixed    $enabled Whether the WooCommerce email is enabled.
     * @param WC_Order $order   Order being emailed.
     * @param WC_Email $email   Email instance.
     * @return mixed
     */
    public static function mark_native_trigger($enabled, $order, $email)
    {
        unset($email);

        if ($enabled && $order instanceof WC_Order && self::is_supported_order($order)) {
            set_transient(self::NATIVE_TRIGGER_TRANSIENT . $order->get_id(), '1', 10 * MINUTE_IN_SECONDS);
        }

        return $enabled;
    }

    /**
     * Schedule a one-time fallback after Mercado Pago's payment completion.
     * Native WooCommerce delivery happens in the current request, so waiting
     * three minutes prevents a second email for normal orders.
     *
     * @param int|string $order_id WooCommerce order ID.
     */
    public static function schedule_fallback($order_id): void
    {
        $order = wc_get_order(absint($order_id));
        if (! $order instanceof WC_Order || ! self::is_supported_order($order)) {
            return;
        }

        $args = array($order->get_id());
        $timestamp = time() + self::FALLBACK_DELAY;

        if (function_exists('as_has_scheduled_action') && function_exists('as_schedule_single_action')) {
            if (! as_has_scheduled_action(self::FALLBACK_HOOK, $args, self::FALLBACK_GROUP)) {
                as_schedule_single_action($timestamp, self::FALLBACK_HOOK, $args, self::FALLBACK_GROUP);
            }
            return;
        }

        if (! wp_next_scheduled(self::FALLBACK_HOOK, $args)) {
            wp_schedule_single_event($timestamp, self::FALLBACK_HOOK, $args);
        }
    }

    /**
     * Send only when WooCommerce did not invoke its native notification.
     *
     * @param int|string $order_id WooCommerce order ID.
     */
    public static function send_fallback($order_id): void
    {
        $order = wc_get_order(absint($order_id));
        if (! $order instanceof WC_Order
            || ! self::is_supported_order($order)
            || get_transient(self::NATIVE_TRIGGER_TRANSIENT . $order->get_id())) {
            return;
        }

        self::trigger_processing_email($order);
    }

    /**
     * Explicitly resend a confirmation for a verified processing order.
     * This is intended for support recovery and test validation; it never
     * changes payment state, stock, fulfillment, or order status.
     *
     * @return array<string, mixed>
     */
    public static function resend_for_order(int $order_id): array
    {
        $order = wc_get_order($order_id);
        if (! $order instanceof WC_Order) {
            return array('triggered' => false, 'reason' => 'order_not_found');
        }
        if (! self::is_supported_order($order)) {
            return array('triggered' => false, 'reason' => 'order_not_eligible');
        }

        $dispatch = self::trigger_processing_email($order);
        if (false === $dispatch) {
            return array('triggered' => false, 'reason' => 'email_unavailable');
        }

        $dispatch['order_id'] = $order->get_id();
        $dispatch['triggered'] = ! empty($dispatch['wp_mail_invoked']);
        if (! $dispatch['triggered']) {
            $dispatch['reason'] = 'woocommerce_email_did_not_invoke_wp_mail';
        }

        return $dispatch;
    }

    private static function is_supported_order(WC_Order $order): bool
    {
        return 'processing' === $order->get_status()
            && is_email($order->get_billing_email())
            && str_starts_with($order->get_payment_method(), 'woo-mercado-pago-');
    }

    /**
     * @return array<string, mixed>|false
     */
    private static function trigger_processing_email(WC_Order $order)
    {
        if (! function_exists('WC') || ! WC()->mailer()) {
            return false;
        }

        $emails = WC()->mailer()->get_emails();
        $email = $emails['WC_Email_Customer_Processing_Order'] ?? null;
        if (! $email instanceof WC_Email || ! $email->is_enabled()) {
            return false;
        }

        self::$last_dispatch = array(
            'wp_mail_invoked' => false,
            'recipient' => '',
            'subject' => '',
            'wp_mail_error' => '',
        );
        self::$capture_active = true;
        add_filter('wp_mail', array(__CLASS__, 'capture_wp_mail'), PHP_INT_MAX);
        add_action('wp_mail_failed', array(__CLASS__, 'capture_wp_mail_failed'), PHP_INT_MAX);

        try {
            $email->trigger($order->get_id(), $order);
        } finally {
            remove_filter('wp_mail', array(__CLASS__, 'capture_wp_mail'), PHP_INT_MAX);
            remove_action('wp_mail_failed', array(__CLASS__, 'capture_wp_mail_failed'), PHP_INT_MAX);
            self::$capture_active = false;
        }

        return self::$last_dispatch;
    }

    /**
     * @param array<string, mixed> $args
     * @return array<string, mixed>
     */
    public static function capture_wp_mail(array $args): array
    {
        if (! self::$capture_active) {
            return $args;
        }

        $recipients = $args['to'] ?? array();
        if (! is_array($recipients)) {
            $recipients = array($recipients);
        }

        self::$last_dispatch['wp_mail_invoked'] = true;
        self::$last_dispatch['recipient'] = implode(', ', array_map('strval', $recipients));
        self::$last_dispatch['subject'] = isset($args['subject']) ? (string) $args['subject'] : '';

        return $args;
    }

    /**
     * @param WP_Error $error Error reported by WordPress mailer.
     */
    public static function capture_wp_mail_failed($error): void
    {
        if (self::$capture_active && $error instanceof WP_Error) {
            self::$last_dispatch['wp_mail_error'] = $error->get_error_message();
        }
    }
}
