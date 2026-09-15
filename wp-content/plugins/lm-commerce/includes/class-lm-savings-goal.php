<?php
/**
 * Persists the savings target selected for the savings-challenge piggy bank.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Savings_Goal
{
    private const PRODUCT_SKU = 'LM-ALC-AHO';
    private const FIELD = 'lm_savings_goal';
    private const CART_KEY = 'lm_savings_goal';
    private const PRODUCT_META_KEY = '_lm_savings_goals';
    private const ORDER_META_KEY = 'Meta de ahorro';

    /**
     * @var list<int>
     */
    private const DEFAULT_GOALS = array(1000, 2000, 5000, 10000, 15000, 25000, 50000, 75000, 100000);

    public static function init(): void
    {
        add_action('woocommerce_before_add_to_cart_button', array(__CLASS__, 'render_field'));
        add_filter('woocommerce_add_to_cart_validation', array(__CLASS__, 'validate_selection'), 10, 6);
        add_filter('woocommerce_add_cart_item_data', array(__CLASS__, 'add_cart_item_data'), 10, 4);
        add_filter('woocommerce_get_cart_item_from_session', array(__CLASS__, 'restore_cart_item_data'), 10, 3);
        add_filter('woocommerce_get_item_data', array(__CLASS__, 'display_cart_item_data'), 10, 2);
        add_action('woocommerce_checkout_create_order_line_item', array(__CLASS__, 'add_order_item_meta'), 10, 4);
        add_action('woocommerce_product_options_general_product_data', array(__CLASS__, 'render_admin_field'));
        add_action('woocommerce_process_product_meta', array(__CLASS__, 'save_admin_field'));
    }

    public static function render_field(): void
    {
        global $product;

        if (! $product instanceof WC_Product || ! self::is_target_product($product->get_id())) {
            return;
        }

        $selected = self::selected_goal_from_request($product->get_id());
        $goals = self::goals_for_product($product->get_id());
        ?>
        <fieldset class="lm-savings-goal" aria-describedby="lm-savings-goal-help">
            <legend><?php esc_html_e('Elige tu meta de ahorro', 'lm-commerce'); ?></legend>
            <p id="lm-savings-goal-help" class="lm-savings-goal__help">
                <?php esc_html_e('La prepararemos con la meta que elijas.', 'lm-commerce'); ?>
            </p>
            <div class="lm-savings-goal__options">
                <?php foreach ($goals as $index => $goal) : ?>
                    <label class="lm-savings-goal__option">
                        <input
                            type="radio"
                            name="<?php echo esc_attr(self::FIELD); ?>"
                            value="<?php echo esc_attr((string) $goal); ?>"
                            <?php checked($selected, $goal); ?>
                            <?php echo 0 === $index ? 'required' : ''; ?>
                        >
                        <span><?php echo esc_html(self::format_goal($goal)); ?></span>
                    </label>
                <?php endforeach; ?>
            </div>
        </fieldset>
        <?php
    }

    public static function render_admin_field(): void
    {
        global $post;

        $product = $post instanceof WP_Post ? wc_get_product($post->ID) : false;
        if (! $product instanceof WC_Product || ! self::is_target_product($product->get_id())) {
            return;
        }

        woocommerce_wp_textarea_input(array(
            'id' => self::PRODUCT_META_KEY,
            'label' => __('Metas de ahorro', 'lm-commerce'),
            'description' => __('Montos en MXN separados por comas. Ejemplo: 1000, 2000, 5000. No modifica precio, stock ni envío.', 'lm-commerce'),
            'desc_tip' => true,
            'value' => implode(', ', self::goals_for_product($product->get_id())),
            'custom_attributes' => array('rows' => 3),
        ));
    }

    public static function save_admin_field(int $product_id): void
    {
        if (! self::is_target_product($product_id)) {
            return;
        }

        $submitted = $_POST[self::PRODUCT_META_KEY] ?? '';
        if (! is_scalar($submitted)) {
            return;
        }

        $raw_goals = trim(wp_unslash((string) $submitted));
        if ('' === $raw_goals) {
            delete_post_meta($product_id, self::PRODUCT_META_KEY);
            return;
        }

        $goals = self::parse_goal_list($raw_goals);
        if (null === $goals) {
            if (class_exists('WC_Admin_Meta_Boxes')) {
                WC_Admin_Meta_Boxes::add_error(__('Las metas de ahorro deben ser montos positivos, separados por comas.', 'lm-commerce'));
            }
            return;
        }

        update_post_meta($product_id, self::PRODUCT_META_KEY, implode(',', $goals));
    }

    /**
     * @param array<string, mixed> $cart_item_data
     */
    public static function validate_selection(
        bool $passed,
        int $product_id,
        int $quantity,
        int $variation_id = 0,
        array $variations = array(),
        array $cart_item_data = array()
    ): bool {
        if (! $passed || ! self::is_target_product($product_id)) {
            return $passed;
        }

        if (null === self::selected_goal_from_request($product_id)) {
            wc_add_notice(__('Selecciona una meta de ahorro para agregar la alcancía al carrito.', 'lm-commerce'), 'error');
            return false;
        }

        return true;
    }

    /**
     * @param array<string, mixed> $cart_item_data
     * @param array<string, mixed> $variation
     * @return array<string, mixed>
     */
    public static function add_cart_item_data(array $cart_item_data, int $product_id, int $variation_id, int $quantity): array
    {
        if (! self::is_target_product($product_id)) {
            return $cart_item_data;
        }

        $goal = self::selected_goal_from_request($product_id);
        if (null !== $goal) {
            $cart_item_data[self::CART_KEY] = $goal;
        }

        return $cart_item_data;
    }

    /**
     * @param array<string, mixed> $session_data
     * @param array<string, mixed> $values
     * @return array<string, mixed>
     */
    public static function restore_cart_item_data(array $session_data, array $values, string $cart_item_key): array
    {
        $goal = self::normalise_goal($values[self::CART_KEY] ?? null);
        if (null !== $goal) {
            $session_data[self::CART_KEY] = $goal;
        }

        return $session_data;
    }

    /**
     * @param list<array<string, mixed>> $item_data
     * @param array<string, mixed>       $cart_item
     * @return list<array<string, mixed>>
     */
    public static function display_cart_item_data(array $item_data, array $cart_item): array
    {
        $goal = self::normalise_goal($cart_item[self::CART_KEY] ?? null);
        if (null === $goal) {
            return $item_data;
        }

        $item_data[] = array(
            'key' => self::ORDER_META_KEY,
            'value' => self::format_goal($goal),
            'display' => self::format_goal($goal),
        );

        return $item_data;
    }

    /**
     * @param array<string, mixed> $values
     */
    public static function add_order_item_meta(WC_Order_Item_Product $item, string $cart_item_key, array $values, WC_Order $order): void
    {
        $goal = self::normalise_goal($values[self::CART_KEY] ?? null);
        if (null !== $goal) {
            $item->add_meta_data(self::ORDER_META_KEY, self::format_goal($goal), true);
        }
    }

    private static function is_target_product(int $product_id): bool
    {
        $product = wc_get_product($product_id);
        return $product instanceof WC_Product && self::PRODUCT_SKU === $product->get_sku();
    }

    private static function selected_goal_from_request(int $product_id): ?int
    {
        $raw_goal = $_POST[self::FIELD] ?? null;
        if (! is_scalar($raw_goal)) {
            return null;
        }

        $goal = self::normalise_goal(wp_unslash((string) $raw_goal));
        return null !== $goal && in_array($goal, self::goals_for_product($product_id), true) ? $goal : null;
    }

    /**
     * @param mixed $value
     */
    private static function normalise_goal($value): ?int
    {
        if (is_int($value)) {
            $goal = $value;
        } elseif (is_string($value) && ctype_digit($value)) {
            $goal = (int) $value;
        } else {
            return null;
        }

        return $goal > 0 ? $goal : null;
    }

    /**
     * @return list<int>
     */
    private static function goals_for_product(int $product_id): array
    {
        $configured = get_post_meta($product_id, self::PRODUCT_META_KEY, true);
        if (! is_string($configured) || '' === trim($configured)) {
            return self::DEFAULT_GOALS;
        }

        return self::parse_goal_list($configured) ?? self::DEFAULT_GOALS;
    }

    /**
     * @return list<int>|null
     */
    private static function parse_goal_list(string $raw_goals): ?array
    {
        $tokens = preg_split('/[\s,;]+/', trim($raw_goals), -1, PREG_SPLIT_NO_EMPTY);
        if (! is_array($tokens) || array() === $tokens || count($tokens) > 24) {
            return null;
        }

        $goals = array();
        foreach ($tokens as $token) {
            $goal = self::normalise_goal($token);
            if (null === $goal) {
                return null;
            }
            $goals[$goal] = $goal;
        }

        return array_values($goals);
    }

    private static function format_goal(int $goal): string
    {
        return sprintf('$%s MXN', number_format_i18n($goal, 0));
    }
}
