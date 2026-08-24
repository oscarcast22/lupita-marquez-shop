<?php
/**
 * Customer login and registration forms.
 *
 * Presents a single account task at a time while preserving WooCommerce's
 * native forms, hooks, nonces and progressive fallback.
 *
 * @package WooCommerce\Templates
 * @version 9.9.0
 */

defined('ABSPATH') || exit;

$registration_enabled = 'yes' === get_option('woocommerce_enable_myaccount_registration');
$requested_view = isset($_GET['lm-account-view']) && is_string($_GET['lm-account-view'])
    ? sanitize_key(wp_unslash($_GET['lm-account-view']))
    : 'login';
$registration_submitted = isset($_POST['register']);
$active_view = $registration_enabled && ('register' === $requested_view || $registration_submitted)
    ? 'register'
    : 'login';
$account_url = wc_get_page_permalink('myaccount');
$registration_url = add_query_arg('lm-account-view', 'register', $account_url);

do_action('woocommerce_before_customer_login_form');
?>

<div class="lm-account-auth" data-lm-account-auth data-lm-active-view="<?php echo esc_attr($active_view); ?>">
	<section
		id="lm-account-login"
		class="lm-account-auth__panel"
		data-lm-account-panel="login"
		<?php if ('login' !== $active_view) : ?>hidden<?php endif; ?>
	>
		<header class="lm-account-auth__header">
			<h2 tabindex="-1" data-lm-account-panel-title><?php esc_html_e('Iniciar sesión', 'lupita-marquez'); ?></h2>
			<p><?php esc_html_e('Accede para consultar tus pedidos y administrar tus datos de compra.', 'lupita-marquez'); ?></p>
		</header>

		<form class="woocommerce-form woocommerce-form-login login" method="post" novalidate>
			<?php do_action('woocommerce_login_form_start'); ?>

			<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
				<label for="username">
					<?php esc_html_e('Nombre de usuario o correo electrónico', 'lupita-marquez'); ?>&nbsp;<span class="required" aria-hidden="true">*</span>
					<span class="screen-reader-text"><?php esc_html_e('Obligatorio', 'lupita-marquez'); ?></span>
				</label>
				<input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="username" id="username" autocomplete="username" value="<?php echo (! empty($_POST['username']) && is_string($_POST['username'])) ? esc_attr(wp_unslash($_POST['username'])) : ''; ?>" required aria-required="true"><?php // @codingStandardsIgnoreLine ?>
			</p>
			<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
				<label for="password">
					<?php esc_html_e('Contraseña', 'lupita-marquez'); ?>&nbsp;<span class="required" aria-hidden="true">*</span>
					<span class="screen-reader-text"><?php esc_html_e('Obligatorio', 'lupita-marquez'); ?></span>
				</label>
				<input class="woocommerce-Input woocommerce-Input--text input-text" type="password" name="password" id="password" autocomplete="current-password" required aria-required="true">
			</p>

			<?php do_action('woocommerce_login_form'); ?>

			<div class="lm-account-auth__options">
				<label class="woocommerce-form__label woocommerce-form__label-for-checkbox woocommerce-form-login__rememberme">
					<input class="woocommerce-form__input woocommerce-form__input-checkbox" name="rememberme" type="checkbox" id="rememberme" value="forever">
					<span><?php esc_html_e('Recuérdame', 'lupita-marquez'); ?></span>
				</label>
				<p class="woocommerce-LostPassword lost_password">
					<a href="<?php echo esc_url(wp_lostpassword_url()); ?>"><?php esc_html_e('¿Olvidaste tu contraseña?', 'lupita-marquez'); ?></a>
				</p>
			</div>

			<p class="lm-account-auth__submit form-row">
				<?php wp_nonce_field('woocommerce-login', 'woocommerce-login-nonce'); ?>
				<button type="submit" class="woocommerce-button button woocommerce-form-login__submit<?php echo esc_attr(wc_wp_theme_get_element_class_name('button') ? ' ' . wc_wp_theme_get_element_class_name('button') : ''); ?>" name="login" value="<?php esc_attr_e('Iniciar sesión', 'lupita-marquez'); ?>"><?php esc_html_e('Iniciar sesión', 'lupita-marquez'); ?></button>
			</p>

			<?php do_action('woocommerce_login_form_end'); ?>
		</form>

		<?php if ($registration_enabled) : ?>
			<div class="lm-account-auth__switcher">
				<p><?php esc_html_e('¿Aún no tienes una cuenta?', 'lupita-marquez'); ?></p>
				<a
					class="lm-account-auth__switch lm-button wp-element-button is-style-outline"
					href="<?php echo esc_url($registration_url); ?>"
					aria-controls="lm-account-register"
					data-lm-account-view-target="register"
				><?php esc_html_e('Crear una cuenta', 'lupita-marquez'); ?></a>
			</div>
		<?php endif; ?>
	</section>

	<?php if ($registration_enabled) : ?>
		<section
			id="lm-account-register"
			class="lm-account-auth__panel"
			data-lm-account-panel="register"
			<?php if ('register' !== $active_view) : ?>hidden<?php endif; ?>
		>
			<header class="lm-account-auth__header">
				<h2 tabindex="-1" data-lm-account-panel-title><?php esc_html_e('Crear una cuenta', 'lupita-marquez'); ?></h2>
				<p><?php esc_html_e('Regístrate con tu correo para consultar pedidos y comprar con mayor facilidad.', 'lupita-marquez'); ?></p>
			</header>

			<form method="post" class="woocommerce-form woocommerce-form-register register" <?php do_action('woocommerce_register_form_tag'); ?>>
				<?php do_action('woocommerce_register_form_start'); ?>

				<?php if ('no' === get_option('woocommerce_registration_generate_username')) : ?>
					<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
						<label for="reg_username">
							<?php esc_html_e('Nombre de usuario', 'lupita-marquez'); ?>&nbsp;<span class="required" aria-hidden="true">*</span>
							<span class="screen-reader-text"><?php esc_html_e('Obligatorio', 'lupita-marquez'); ?></span>
						</label>
						<input type="text" class="woocommerce-Input woocommerce-Input--text input-text" name="username" id="reg_username" autocomplete="username" value="<?php echo (! empty($_POST['username']) && is_string($_POST['username'])) ? esc_attr(wp_unslash($_POST['username'])) : ''; ?>" required aria-required="true"><?php // @codingStandardsIgnoreLine ?>
					</p>
				<?php endif; ?>

				<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
					<label for="reg_email">
						<?php esc_html_e('Correo electrónico', 'lupita-marquez'); ?>&nbsp;<span class="required" aria-hidden="true">*</span>
						<span class="screen-reader-text"><?php esc_html_e('Obligatorio', 'lupita-marquez'); ?></span>
					</label>
					<input type="email" class="woocommerce-Input woocommerce-Input--text input-text" name="email" id="reg_email" autocomplete="email" value="<?php echo (! empty($_POST['email']) && is_string($_POST['email'])) ? esc_attr(wp_unslash($_POST['email'])) : ''; ?>" required aria-required="true"><?php // @codingStandardsIgnoreLine ?>
				</p>

				<?php if ('no' === get_option('woocommerce_registration_generate_password')) : ?>
					<p class="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
						<label for="reg_password">
							<?php esc_html_e('Contraseña', 'lupita-marquez'); ?>&nbsp;<span class="required" aria-hidden="true">*</span>
							<span class="screen-reader-text"><?php esc_html_e('Obligatorio', 'lupita-marquez'); ?></span>
						</label>
						<input type="password" class="woocommerce-Input woocommerce-Input--text input-text" name="password" id="reg_password" autocomplete="new-password" required aria-required="true">
					</p>
				<?php else : ?>
					<p class="lm-account-auth__note"><?php esc_html_e('Te enviaremos un enlace para crear tu contraseña.', 'lupita-marquez'); ?></p>
				<?php endif; ?>

				<?php do_action('woocommerce_register_form'); ?>

				<p class="lm-account-auth__submit woocommerce-form-row form-row">
					<?php wp_nonce_field('woocommerce-register', 'woocommerce-register-nonce'); ?>
					<button type="submit" class="woocommerce-Button woocommerce-button button<?php echo esc_attr(wc_wp_theme_get_element_class_name('button') ? ' ' . wc_wp_theme_get_element_class_name('button') : ''); ?> woocommerce-form-register__submit" name="register" value="<?php esc_attr_e('Crear una cuenta', 'lupita-marquez'); ?>"><?php esc_html_e('Crear una cuenta', 'lupita-marquez'); ?></button>
				</p>

				<?php do_action('woocommerce_register_form_end'); ?>
			</form>

			<div class="lm-account-auth__switcher">
				<p><?php esc_html_e('¿Ya tienes una cuenta?', 'lupita-marquez'); ?></p>
				<a
					class="lm-account-auth__switch lm-button wp-element-button is-style-outline"
					href="<?php echo esc_url($account_url); ?>"
					aria-controls="lm-account-login"
					data-lm-account-view-target="login"
				><?php esc_html_e('Volver a iniciar sesión', 'lupita-marquez'); ?></a>
			</div>
		</section>
	<?php endif; ?>
</div>

<?php do_action('woocommerce_after_customer_login_form'); ?>
