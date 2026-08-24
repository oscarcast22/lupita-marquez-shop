<?php
/**
 * Orders.
 *
 * A compact order history that preserves WooCommerce hooks, paging and every
 * available order action while making each purchase easy to scan.
 *
 * @package WooCommerce\Templates
 * @version 9.5.0
 */

defined('ABSPATH') || exit;

do_action('woocommerce_before_account_orders', $has_orders);
?>

<section class="lm-account-orders" aria-labelledby="lm-account-orders-title">
	<header class="lm-account-orders__header">
		<p class="lm-account-profile__eyebrow"><?php esc_html_e('Historial de compra', 'lupita-marquez'); ?></p>
		<h2 id="lm-account-orders-title"><?php esc_html_e('Pedidos', 'lupita-marquez'); ?></h2>
	</header>

	<?php if ($has_orders) : ?>
		<ol class="lm-account-orders__list">
			<?php foreach ($customer_orders->orders as $customer_order) : ?>
				<?php
				$order = wc_get_order($customer_order);
				$item_count = $order->get_item_count() - $order->get_item_count_refunded();
				$actions = wc_get_account_orders_actions($order);
				$thumbnails = array();

				foreach ($order->get_items() as $item) {
					$product = $item->get_product();

					if (! $product || ! $product->get_image_id()) {
						continue;
					}

					$thumbnails[] = $product->get_image('woocommerce_thumbnail', array('loading' => 'lazy'));

					if (3 === count($thumbnails)) {
						break;
					}
				}
				?>
				<li class="lm-account-orders__item lm-account-orders__item--<?php echo esc_attr($order->get_status()); ?>">
					<div class="lm-account-orders__overview">
						<?php if ($thumbnails) : ?>
							<div class="lm-account-orders__thumbnails" aria-hidden="true">
								<?php foreach ($thumbnails as $thumbnail) : ?>
									<span><?php echo wp_kses_post($thumbnail); ?></span>
								<?php endforeach; ?>
							</div>
						<?php endif; ?>
						<div class="lm-account-orders__details">
							<p class="lm-account-orders__status"><?php echo esc_html(wc_get_order_status_name($order->get_status())); ?></p>
							<h3><?php echo esc_html(sprintf(__('Pedido #%s', 'lupita-marquez'), $order->get_order_number())); ?></h3>
							<p>
								<time datetime="<?php echo esc_attr($order->get_date_created()->date('c')); ?>"><?php echo esc_html(wc_format_datetime($order->get_date_created())); ?></time>
								<span aria-hidden="true"> · </span>
								<?php echo wp_kses_post(sprintf(_n('%1$s pieza · %2$s', '%1$s piezas · %2$s', $item_count, 'lupita-marquez'), $item_count, $order->get_formatted_order_total())); ?>
							</p>
						</div>
					</div>
					<?php if ($actions) : ?>
						<div class="lm-account-orders__actions">
							<?php foreach ($actions as $key => $action) : ?>
								<?php
								$action_aria_label = ! empty($action['aria-label'])
									? $action['aria-label']
									: sprintf(__('%1$s pedido %2$s', 'lupita-marquez'), $action['name'], $order->get_order_number());
								?>
								<a href="<?php echo esc_url($action['url']); ?>" class="woocommerce-button button <?php echo esc_attr(sanitize_html_class($key)); ?>" aria-label="<?php echo esc_attr($action_aria_label); ?>"><?php echo esc_html($action['name']); ?></a>
							<?php endforeach; ?>
						</div>
					<?php endif; ?>
				</li>
			<?php endforeach; ?>
		</ol>

		<?php do_action('woocommerce_before_account_orders_pagination'); ?>

		<?php if (1 < $customer_orders->max_num_pages) : ?>
			<nav class="woocommerce-pagination woocommerce-pagination--without-numbers woocommerce-Pagination" aria-label="<?php esc_attr_e('Paginación de pedidos', 'lupita-marquez'); ?>">
				<?php if (1 !== $current_page) : ?>
					<a class="woocommerce-button woocommerce-button--previous woocommerce-Button woocommerce-Button--previous button" href="<?php echo esc_url(wc_get_endpoint_url('orders', $current_page - 1)); ?>"><?php esc_html_e('Anterior', 'lupita-marquez'); ?></a>
				<?php endif; ?>
				<?php if ((int) $customer_orders->max_num_pages !== $current_page) : ?>
					<a class="woocommerce-button woocommerce-button--next woocommerce-Button woocommerce-Button--next button" href="<?php echo esc_url(wc_get_endpoint_url('orders', $current_page + 1)); ?>"><?php esc_html_e('Siguiente', 'lupita-marquez'); ?></a>
				<?php endif; ?>
			</nav>
		<?php endif; ?>
	<?php else : ?>
		<div class="lm-account-orders__empty">
			<p><?php esc_html_e('Aún no tienes pedidos. Cuando elijas una pieza, aparecerá aquí.', 'lupita-marquez'); ?></p>
			<a class="lm-button wp-element-button" href="<?php echo esc_url(apply_filters('woocommerce_return_to_shop_redirect', wc_get_page_permalink('shop'))); ?>"><?php esc_html_e('Explorar colecciones', 'lupita-marquez'); ?></a>
		</div>
	<?php endif; ?>
</section>

<?php do_action('woocommerce_after_account_orders', $has_orders); ?>
