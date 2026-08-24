<?php
/**
 * My Account dashboard.
 *
 * Presents account details as a calm, practical profile while retaining
 * WooCommerce's native endpoints and extension hook.
 *
 * @package WooCommerce\Templates
 * @version 10.9.4
 */

defined('ABSPATH') || exit;

$customer_id = get_current_user_id();
$customer = new WC_Customer($customer_id);
$name = trim(implode(' ', array_filter(array($customer->get_first_name(), $customer->get_last_name()))));
$addresses = array(
    'billing' => __('Facturación', 'lupita-marquez'),
);

if (! wc_ship_to_billing_address_only() && wc_shipping_enabled()) {
    $addresses['shipping'] = __('Envío', 'lupita-marquez');
}
?>

<div class="lm-account-profile">
	<header class="lm-account-profile__header">
		<p class="lm-account-profile__eyebrow"><?php esc_html_e('Mi perfil', 'lupita-marquez'); ?></p>
		<h2><?php echo esc_html('' !== $name ? $name : __('Tu cuenta', 'lupita-marquez')); ?></h2>
	</header>

	<section class="lm-account-profile__identity" aria-labelledby="lm-account-contact-title">
		<div>
			<p id="lm-account-contact-title" class="lm-account-profile__label"><?php esc_html_e('Correo electrónico', 'lupita-marquez'); ?></p>
			<p><?php echo esc_html($customer->get_email()); ?></p>
		</div>
		<a href="<?php echo esc_url(wc_get_account_endpoint_url('edit-account')); ?>"><?php esc_html_e('Editar datos', 'lupita-marquez'); ?></a>
	</section>

	<section class="lm-account-profile__addresses" aria-labelledby="lm-account-addresses-title">
		<header>
			<h3 id="lm-account-addresses-title"><?php esc_html_e('Direcciones', 'lupita-marquez'); ?></h3>
			<a href="<?php echo esc_url(wc_get_account_endpoint_url('edit-address')); ?>"><?php esc_html_e('Administrar', 'lupita-marquez'); ?></a>
		</header>
		<div class="lm-account-profile__address-list">
			<?php foreach ($addresses as $type => $label) : ?>
				<?php $address = wc_get_account_formatted_address($type, $customer_id); ?>
				<div>
					<p class="lm-account-profile__label"><?php echo esc_html($label); ?></p>
					<div class="lm-account-profile__address-copy">
						<?php echo $address ? wp_kses_post($address) : esc_html__('Aún no has agregado una dirección.', 'lupita-marquez'); ?>
					</div>
				</div>
			<?php endforeach; ?>
		</div>
	</section>

	<div class="lm-account-profile__settings">
		<div>
			<h3><?php esc_html_e('Datos y contraseña', 'lupita-marquez'); ?></h3>
			<p><?php esc_html_e('Actualiza tu nombre, correo o contraseña.', 'lupita-marquez'); ?></p>
		</div>
		<a href="<?php echo esc_url(wc_get_account_endpoint_url('edit-account')); ?>"><?php esc_html_e('Administrar', 'lupita-marquez'); ?></a>
	</div>

	<a class="lm-account-profile__logout" href="<?php echo esc_url(wc_logout_url()); ?>"><?php esc_html_e('Cerrar sesión', 'lupita-marquez'); ?></a>
</div>

<?php do_action('woocommerce_account_dashboard'); ?>
