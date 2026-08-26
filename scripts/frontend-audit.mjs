/* eslint-disable no-console */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.LM_BASE_URL || 'http://localhost:8088';
const outputDirectory = path.resolve(
	process.env.LM_AUDIT_OUTPUT || 'reports/frontend'
);
const chromePath = process.env.CHROME_PATH;
const widths = [ 1440, 1280, 1024, 768, 390 ];
const routes = [
	[ 'inicio', '/' ],
	[ 'tienda', '/tienda/' ],
	[ 'categoria-altares', '/categoria-producto/altares/' ],
	[ 'categoria-otras', '/categoria-producto/otras-piezas/' ],
	[ 'carrito-vacio', '/carrito/' ],
	[ 'producto-variable', '/producto/altar-chico/', 'audit-variations' ],
	[ 'producto-bajo-pedido', '/producto/nicho/' ],
	[ 'carrito-lleno', '/carrito/', 'fill-cart' ],
	[ 'checkout', '/finalizar-compra/' ],
	[ 'cuenta', '/mi-cuenta/' ],
	[ 'nosotros', '/nosotros/' ],
	[ 'contacto', '/contacto/' ],
	[ 'preguntas-frecuentes', '/preguntas-frecuentes/' ],
	[ 'envios-devoluciones', '/envios-y-devoluciones/' ],
	[ 'aviso-privacidad', '/aviso-de-privacidad/' ],
	[ 'terminos', '/terminos-y-condiciones/' ],
	[ 'busqueda', '/?s=altar&post_type=product' ],
	[ 'error-404', '/esta-ruta-no-existe/' ],
];
const requiredContent = {
	'carrito-vacio': '.wp-block-woocommerce-empty-cart-block',
	'producto-variable': '.single_add_to_cart_button',
	'producto-bajo-pedido': '.single_add_to_cart_button',
	'carrito-lleno':
		'.wc-block-cart-item__product .wc-block-components-product-name',
	checkout: '.wc-block-components-checkout-place-order-button',
	nosotros: '.lm-about-editorial__content',
	contacto: '[data-lm-contact-form]',
	'preguntas-frecuentes': '.lm-faq-list details',
	'envios-devoluciones': '.lm-document',
	'aviso-privacidad': '.lm-document',
	terminos: '.lm-document',
};

const actionAuditSelectors = {
	inicio: [
		{ selector: '.lm-hero .wp-element-button', variant: 'primary' },
		{
			selector: '.lm-featured-cta .wp-element-button',
			variant: 'secondary',
		},
	],
	'carrito-vacio': [
		{
			selector:
				'.wp-block-woocommerce-empty-cart-block .wp-element-button',
			variant: 'primary',
		},
	],
	'producto-bajo-pedido': [
		{ selector: '.single_add_to_cart_button', variant: 'primary' },
	],
	cuenta: [
		{ selector: '.woocommerce-form-login__submit', variant: 'primary' },
	],
	nosotros: [ { selector: '.lm-about-cta .lm-button', variant: 'inverted' } ],
};

const waitForCommerceBlock = async ( page, rootSelector, contentSelector ) => {
	await page
		.locator( contentSelector )
		.first()
		.waitFor( {
			state: 'visible',
			timeout: 20_000,
		} )
		.catch( () => {} );
	await page
		.waitForFunction(
			( selectors ) => {
				const root = document.querySelector( selectors.root );
				return Boolean(
					root &&
						! root.classList.contains( 'is-loading' ) &&
						! root.querySelector( '.wc-block-components-skeleton' )
				);
			},
			{ root: rootSelector },
			{ timeout: 20_000 }
		)
		.catch( () => {} );
};

const collectFiles = async ( directory ) => {
	const entries = await fs.readdir( directory, { withFileTypes: true } );
	const files = await Promise.all(
		entries.map( ( entry ) => {
			const entryPath = path.join( directory, entry.name );
			return entry.isDirectory() ? collectFiles( entryPath ) : entryPath;
		} )
	);
	return files.flat();
};

const motionPatterns = [
	[ 'legacy data hook', /data-lm-(?:reveal|stagger|gallery)/g ],
	[ 'legacy JavaScript class', /\blm-has-js\b/g ],
];

const themeRoot = path.resolve( 'wp-content/themes/lupita-marquez' );
const motionSourceFiles = (
	await Promise.all(
		[ 'src', 'templates', 'parts' ].map( ( directory ) =>
			collectFiles( path.join( themeRoot, directory ) )
		)
	)
)
	.flat()
	.filter( ( file ) => /\.(?:css|html|js)$/.test( file ) );
const sourceMotionViolations = [];
const sourceContractViolations = [];

for ( const file of motionSourceFiles ) {
	const source = await fs.readFile( file, 'utf8' );
	for ( const [ label, pattern ] of motionPatterns ) {
		for ( const match of source.matchAll( pattern ) ) {
			sourceMotionViolations.push( {
				file: path.relative( process.cwd(), file ),
				line: source.slice( 0, match.index ).split( '\n' ).length,
				type: label,
			} );
		}
	}
}

const sourceContractPatterns = [
	[
		'legacy layout class',
		/\b(?:alignfull|alignwide|has-global-padding|wp-container-)/g,
	],
	[ 'inline style', /\bstyle\s*=/g ],
	[ '!important', /!important\b/g ],
];

for ( const file of motionSourceFiles ) {
	const source = await fs.readFile( file, 'utf8' );
	for ( const [ label, pattern ] of sourceContractPatterns ) {
		for ( const match of source.matchAll( pattern ) ) {
			const precedingLines = source
				.slice( 0, match.index )
				.split( '\n' )
				.slice( -3 );
			if (
				label === '!important' &&
				precedingLines.some( ( line ) =>
					line.includes( 'Documented exception:' )
				)
			) {
				continue;
			}
			sourceContractViolations.push( {
				file: path.relative( process.cwd(), file ),
				line: source.slice( 0, match.index ).split( '\n' ).length,
				type: label,
			} );
		}
	}
}

const cssSourceFiles = motionSourceFiles.filter( ( file ) =>
	file.endsWith( '.css' )
);
const integrationSelectorViolations = [];
for ( const file of cssSourceFiles ) {
	if ( path.basename( file ) === 'woocommerce.css' ) {
		continue;
	}
	const source = await fs.readFile( file, 'utf8' );
	for ( const match of source.matchAll(
		/\.(?:wp-block-|wc-block-|woocommerce-|products\b|product\b)/g
	) ) {
		integrationSelectorViolations.push( {
			file: path.relative( process.cwd(), file ),
			line: source.slice( 0, match.index ).split( '\n' ).length,
			type: 'integration selector outside adapter',
		} );
	}
}

await fs.mkdir( outputDirectory, { recursive: true } );

const browser = await chromium.launch( {
	headless: true,
	...( chromePath ? { executablePath: chromePath } : {} ),
} );
const report = {
	baseURL,
	generatedAt: new Date().toISOString(),
	themeMotion: { sourceViolations: sourceMotionViolations },
	themeContract: {
		sourceViolations: sourceContractViolations,
		integrationSelectorViolations,
	},
	pages: [],
	commerceInteractions: {
		catalog: [],
		cart: [],
		checkout: [],
		account: [],
		contact: [],
	},
};

const getStoreBadgeCount = async ( page ) =>
	page.evaluate( () => {
		const badge = document.querySelector( '.wc-block-mini-cart__badge' );
		const value = Number( badge?.textContent.trim() || 0 );
		return Number.isFinite( value ) ? value : 0;
	} );

const waitForStoreBadge = async ( page, expected ) => {
	await page
		.waitForFunction(
			( value ) => {
				const badge = document.querySelector(
					'.wc-block-mini-cart__badge'
				);
				const count = Number( badge?.textContent.trim() || 0 );
				return Number.isFinite( count ) && count === value;
			},
			expected,
			{ timeout: 20_000 }
		)
		.catch( () => {} );
};

const waitForMiniCart = async ( page, expectedOpen ) => {
	await page
		.waitForFunction(
			( open ) => {
				const trigger = document.querySelector(
					'.wc-block-mini-cart__button'
				);
				const expanded =
					trigger?.getAttribute( 'aria-expanded' ) === 'true';
				const overlay = document.querySelector(
					'.wc-block-components-drawer__screen-overlay'
				);
				const overlayStyle = overlay
					? window.getComputedStyle( overlay )
					: null;
				const visible = Boolean(
					overlay &&
						! overlay.classList.contains(
							'wc-block-components-drawer__screen-overlay--is-hidden'
						) &&
						overlayStyle?.opacity !== '0' &&
						overlayStyle?.pointerEvents !== 'none' &&
						( overlay.getAttribute( 'aria-hidden' ) === 'false' ||
							overlay.classList.contains( 'is-open' ) ||
							overlay.classList.contains(
								'wc-block-components-drawer__screen-overlay--with-slide-in'
							) )
				);
				return open ? expanded || visible : ! expanded && ! visible;
			},
			expectedOpen,
			{ timeout: 15_000 }
		)
		.catch( () => {} );
};

const auditDocumentScrollRestored = async ( page ) =>
	page.evaluate( () => {
		const root = document.documentElement;
		const initialScrollY = window.scrollY;
		const maximumScrollY = Math.max(
			0,
			document.documentElement.scrollHeight - window.innerHeight
		);
		const targetScrollY = Math.min( maximumScrollY, 160 );
		window.scrollTo( 0, 0 );
		window.scrollTo( 0, targetScrollY );
		const moved = targetScrollY > 0 && window.scrollY === targetScrollY;
		window.scrollTo( 0, initialScrollY );
		return {
			moved,
			passed:
				! root.classList.contains( 'lm-drawer-is-open' ) &&
				( maximumScrollY === 0 || moved ),
			themeScrollLockActive:
				root.classList.contains( 'lm-drawer-is-open' ),
		};
	} );

const addSimpleProductForAudit = async ( page ) => {
	await page.goto( new URL( '/tienda/', baseURL ).href, {
		waitUntil: 'networkidle',
		timeout: 45_000,
	} );
	const card = page
		.locator( '.wc-block-product' )
		.filter( { hasText: 'Altar para mascotas' } )
		.first();
	const button = card.locator(
		'.wc-block-components-product-button__button'
	);
	if ( ! ( await button.count() ) ) {
		return false;
	}
	await button.evaluate( ( element ) => element.click() );
	await waitForStoreBadge( page, 1 );
	await page
		.waitForFunction(
			async () => {
				const response = await fetch( '/wp-json/wc/store/v1/cart', {
					cache: 'no-store',
				} );
				const cart = await response.json();
				return Boolean( cart.items?.length );
			},
			undefined,
			{ timeout: 15_000 }
		)
		.catch( () => {} );
	return ( await getStoreBadgeCount( page ) ) === 1;
};

const addDirectProductForAudit = async ( page ) => {
	await page.goto(
		new URL( '/producto/altar-para-mascotas/', baseURL ).href,
		{
			waitUntil: 'networkidle',
			timeout: 45_000,
		}
	);
	const button = page.locator( '.single_add_to_cart_button' );
	if ( ! ( await button.count() ) ) {
		return false;
	}
	await button.evaluate( ( element ) => element.click() );
	await waitForStoreBadge( page, 1 );
	await page
		.waitForFunction(
			async () => {
				const response = await fetch( '/wp-json/wc/store/v1/cart', {
					cache: 'no-store',
				} );
				const cart = await response.json();
				return Boolean( cart.items?.length );
			},
			undefined,
			{ timeout: 15_000 }
		)
		.catch( () => {} );
	return ( await getStoreBadgeCount( page ) ) > 0;
};

const auditTextFieldFocus = async ( locator ) => {
	const readPresentation = () =>
		locator.evaluate( ( element ) => {
			const style = window.getComputedStyle( element );
			return {
				active: element === element.ownerDocument.activeElement,
				borderColor: style.borderColor,
				boxShadow: style.boxShadow,
				outlineStyle: style.outlineStyle,
			};
		} );
	const rest = await readPresentation();
	await locator.focus();
	await locator.page().waitForTimeout( 180 );
	const focus = await readPresentation();
	return {
		focus,
		passed:
			focus.active &&
			focus.borderColor !== rest.borderColor &&
			focus.boxShadow !== 'none' &&
			focus.outlineStyle === 'none',
		rest,
	};
};

const auditActionPresentation = async ( page, { selector, variant } ) => {
	const locator = page.locator( selector ).first();
	if ( ! ( await locator.isVisible().catch( () => false ) ) ) {
		return { available: false, passed: false, selector, variant };
	}
	await locator.scrollIntoViewIfNeeded();
	const readPresentation = () =>
		locator.evaluate( ( element ) => {
			const style = window.getComputedStyle( element );
			return {
				active: element === element.ownerDocument.activeElement,
				background: style.backgroundColor,
				boxShadow: style.boxShadow,
				color: style.color,
			};
		} );
	const rest = await readPresentation();
	await locator.hover();
	await page.waitForTimeout( 220 );
	const hover = await readPresentation();
	await locator.focus();
	await page.waitForTimeout( 220 );
	const focus = await readPresentation();
	await locator.evaluate( ( element ) => element.blur() );
	const colors = {
		charcoal: 'rgb(41, 37, 34)',
		fuchsia: 'rgb(189, 21, 93)',
		ivory: 'rgb(251, 248, 242)',
		transparent: 'rgba(0, 0, 0, 0)',
		white: 'rgb(255, 255, 255)',
	};
	const restMatchesVariant =
		variant === 'primary' || variant === 'inverted'
			? rest.background === colors.fuchsia && rest.color === colors.white
			: rest.background === colors.transparent &&
			  rest.color === colors.charcoal;
	const interactiveState =
		variant === 'inverted'
			? { background: colors.ivory, color: colors.charcoal }
			: { background: colors.charcoal, color: colors.white };
	return {
		available: true,
		focus,
		hover,
		passed:
			restMatchesVariant &&
			hover.background === interactiveState.background &&
			hover.color === interactiveState.color &&
			focus.active &&
			focus.background === interactiveState.background &&
			focus.color === interactiveState.color &&
			focus.boxShadow !== 'none',
		rest,
		selector,
		variant,
	};
};

const auditFormPresentation = async ( page, rootSelector = 'main' ) => {
	const controls = page.locator(
		`${ rootSelector } input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([aria-hidden="true"]), ${ rootSelector } select:not([aria-hidden="true"]), ${ rootSelector } textarea:not([aria-hidden="true"])`
	);
	const results = [];
	const count = await controls.count();
	for ( let index = 0; index < count; index++ ) {
		const control = controls.nth( index );
		if ( ! ( await control.isVisible().catch( () => false ) ) ) {
			continue;
		}
		if (
			await control.evaluate( ( element ) =>
				Boolean( element.closest( '[aria-hidden="true"]' ) )
			)
		) {
			continue;
		}
		const readPresentation = () =>
			control.evaluate( ( element ) => {
				const explicitLabel = element.id
					? document.querySelector(
							`label[for="${ window.CSS.escape( element.id ) }"]`
					  )
					: null;
				const label = explicitLabel || element.closest( 'label' );
				const bounds = element.getBoundingClientRect();
				const style = window.getComputedStyle( element );
				const labelBounds = label?.getBoundingClientRect();
				const labelStyle = label && window.getComputedStyle( label );
				const compact = Boolean(
					element.matches(
						'.qty, .orderby, [data-lm-variation-source], .wc-block-components-quantity-selector__input'
					) ||
						element.closest(
							'.lm-quantity__actions, .lm-variation-option'
						)
				);
				const choice = element.matches(
					'input[type="checkbox"], input[type="radio"]'
				);
				return {
					active: element.ownerDocument.activeElement === element,
					choice,
					compact,
					disabled: element.matches( ':disabled, [readonly]' ),
					label: labelStyle
						? {
								color: labelStyle.color,
								fontSize: labelStyle.fontSize,
								fontWeight: labelStyle.fontWeight,
								left: labelStyle.left,
								position: labelStyle.position,
								top: labelStyle.top,
								transform: labelStyle.transform,
						  }
						: null,
					labelBounds: labelBounds
						? {
								bottom: labelBounds.bottom,
								height: labelBounds.height,
								top: labelBounds.top,
								width: labelBounds.width,
						  }
						: null,
					name:
						element.getAttribute( 'name' ) ||
						element.id ||
						element.className ||
						element.tagName.toLowerCase(),
					rect: {
						bottom: bounds.bottom,
						height: bounds.height,
						top: bounds.top,
						width: bounds.width,
					},
					style: {
						borderColor: style.borderColor,
						boxShadow: style.boxShadow,
						fontSize: style.fontSize,
						lineHeight: style.lineHeight,
						outlineStyle: style.outlineStyle,
						outlineWidth: style.outlineWidth,
						paddingBottom: style.paddingBottom,
						paddingLeft: style.paddingLeft,
						paddingRight: style.paddingRight,
						paddingTop: style.paddingTop,
					},
					tag: element.tagName.toLowerCase(),
					type: element.getAttribute( 'type' ) || '',
					visuallyHidden: bounds.width <= 1.5 || bounds.height <= 1.5,
				};
			} );
		const rest = await readPresentation();
		let focus = null;
		if ( ! rest.disabled && ! rest.visuallyHidden ) {
			await control.focus();
			await page.waitForTimeout( 180 );
			focus = await readPresentation();
			await control.evaluate( ( element ) => element.blur() );
		}
		const visualLabel = Boolean(
			rest.labelBounds?.width > 1 && rest.labelBounds?.height > 1
		);
		const labelStable = Boolean(
			rest.visuallyHidden ||
				! visualLabel ||
				( focus &&
					Object.keys( rest.label ).every(
						( property ) =>
							rest.label[ property ] === focus.label?.[ property ]
					) )
		);
		const layoutStable = Boolean(
			! focus ||
				( Math.abs( rest.rect.height - focus.rect.height ) <= 0.5 &&
					Math.abs( rest.rect.width - focus.rect.width ) <= 0.5 &&
					[
						'paddingBottom',
						'paddingLeft',
						'paddingRight',
						'paddingTop',
					].every(
						( property ) =>
							rest.style[ property ] === focus.style[ property ]
					) )
		);
		const standardControl = ! rest.choice && ! rest.compact;
		const expectedSize = Boolean(
			rest.visuallyHidden ||
				( rest.choice
					? Math.abs( rest.rect.width - 20 ) <= 1 &&
					  Math.abs( rest.rect.height - 20 ) <= 1
					: ! standardControl ||
					  ( rest.tag === 'textarea'
							? rest.rect.height >= 120
							: Math.abs( rest.rect.height - 52 ) <= 1 ) )
		);
		const expectedPadding = Boolean(
			! standardControl ||
				Number.parseFloat( rest.style.paddingLeft ) >= 15.5
		);
		const readableLineHeight = Boolean(
			! standardControl || Number.parseFloat( rest.style.lineHeight ) > 0
		);
		const labelClearance = Boolean(
			! visualLabel ||
				rest.choice ||
				rest.compact ||
				rest.labelBounds.bottom + 4 <= rest.rect.top
		);
		const labelTypography = Boolean(
			! visualLabel ||
				rest.choice ||
				rest.compact ||
				( Number.parseFloat( rest.label.fontSize ) >= 13 &&
					Number.parseFloat( rest.label.fontSize ) <= 15 &&
					Number.parseFloat( rest.label.fontWeight ) === 600 )
		);
		const focusVisible = Boolean(
			rest.disabled ||
				rest.visuallyHidden ||
				( standardControl
					? focus?.active &&
					  focus.style.borderColor !== rest.style.borderColor &&
					  focus.style.boxShadow !== 'none'
					: focus?.active &&
					  ( focus.style.borderColor !== rest.style.borderColor ||
							focus.style.boxShadow !== 'none' ||
							focus.style.outlineStyle !== 'none' ) )
		);
		results.push( {
			expectedPadding,
			expectedSize,
			focusVisible,
			labelClearance,
			labelStable,
			labelTypography,
			layoutStable,
			name: rest.name,
			readableLineHeight,
			rest,
		} );
	}
	await page.evaluate( () => {
		const root = document.documentElement;
		const activeElement = root.ownerDocument.activeElement;
		if ( activeElement instanceof window.HTMLElement ) {
			activeElement.blur();
		}
		window.scrollTo( 0, 0 );
	} );
	return {
		controls: results,
		passed: results.every(
			( control ) =>
				control.expectedPadding &&
				control.expectedSize &&
				control.focusVisible &&
				control.labelClearance &&
				control.labelStable &&
				control.labelTypography &&
				control.layoutStable &&
				control.readableLineHeight
		),
	};
};

const auditCheckoutFieldLayout = async ( page ) =>
	page.evaluate( () => {
		const readRect = ( element ) => {
			const rect = element?.getBoundingClientRect();
			return (
				rect && {
					top: rect.top,
					bottom: rect.bottom,
					left: rect.left,
					right: rect.right,
				}
			);
		};
		const readField = ( selector ) => document.querySelector( selector );
		const email = readField(
			'.wc-block-checkout__contact-fields .wc-block-components-text-input'
		);
		const emailInput = email?.querySelector( 'input' );
		const emailLabel = email?.querySelector( 'label' );
		const shippingForm = readField(
			'.wc-block-checkout__shipping-fields .wc-block-components-address-form'
		);
		const city = shippingForm?.querySelector(
			'.wc-block-components-address-form__city'
		);
		const state = shippingForm?.querySelector(
			'.wc-block-components-address-form__state'
		);
		const stateSelect = state?.querySelector( 'select' );
		const stateLabel = state?.querySelector( 'label' );
		const emailInputRect = readRect( emailInput );
		const emailLabelRect = readRect( emailLabel );
		const cityRect = readRect( city );
		const stateRect = readRect( state );
		const formStyle =
			shippingForm && window.getComputedStyle( shippingForm );
		const readLabelPresentation = ( label ) => {
			const style = label && window.getComputedStyle( label );
			return (
				style && {
					color: style.color,
					fontSize: style.fontSize,
					fontWeight: style.fontWeight,
					transform: style.transform,
				}
			);
		};
		const labelRest = readLabelPresentation( stateLabel );
		stateSelect?.focus();
		const labelFocus = readLabelPresentation( stateLabel );
		const selectStyle =
			stateSelect && window.getComputedStyle( stateSelect );
		const twoColumns = window.innerWidth > 640;
		return {
			labelClearance: Boolean(
				emailInputRect &&
					emailLabelRect &&
					emailLabelRect.bottom + 4 <= emailInputRect.top
			),
			pairedFieldsAligned: Boolean(
				cityRect &&
					stateRect &&
					( ! twoColumns ||
						Math.abs( cityRect.top - stateRect.top ) < 1 )
			),
			shippingGrid: Boolean(
				formStyle &&
					formStyle.display === 'grid' &&
					parseFloat( formStyle.rowGap ) > 0 &&
					( ! twoColumns || parseFloat( formStyle.columnGap ) > 0 )
			),
			labelStable: Boolean(
				labelRest &&
					labelFocus &&
					Object.keys( labelRest ).every(
						( property ) =>
							labelRest[ property ] === labelFocus[ property ]
					)
			),
			selectVerticallyCentered: Boolean(
				selectStyle &&
					selectStyle.paddingTop === selectStyle.paddingBottom
			),
		};
	} );

const runCatalogInteractionAudit = async ( width ) => {
	const result = {
		width,
		addNoNavigation: false,
		drawerOpened: false,
		scrollRestoredAfterClose: null,
		successLabel: false,
		removeNoNavigation: false,
		errorFeedbackVisible: false,
		errorControlRecovered: false,
		passed: false,
	};
	const context = await browser.newContext( {
		viewport: { width, height: 900 },
	} );
	const page = await context.newPage();
	let navigations = 0;
	let routeActive = false;
	page.on( 'framenavigated', ( frame ) => {
		if ( frame === page.mainFrame() ) {
			navigations += 1;
		}
	} );
	try {
		await page.goto( new URL( '/tienda/', baseURL ).href, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
		navigations = 0;
		const card = page
			.locator( '.wc-block-product' )
			.filter( { hasText: 'Altar para mascotas' } )
			.first();
		const button = card.locator(
			'.wc-block-components-product-button__button'
		);
		if ( ! ( await button.count() ) ) {
			throw new Error( 'No se encontró el botón simple del catálogo.' );
		}

		await button.evaluate( ( element ) => element.click() );
		await waitForStoreBadge( page, 1 );
		await waitForMiniCart( page, true );
		await page
			.waitForFunction(
				() =>
					document
						.querySelector(
							'.wc-block-product .wc-block-components-product-button__button [data-wp-text]'
						)
						?.textContent.includes( 'en carrito' ),
				undefined,
				{ timeout: 15_000 }
			)
			.catch( () => {} );
		result.addNoNavigation = navigations === 0;
		result.drawerOpened = await page.evaluate( () => {
			const overlay = document.querySelector(
				'.wc-block-components-drawer__screen-overlay'
			);
			const style = overlay ? window.getComputedStyle( overlay ) : null;
			return Boolean(
				overlay &&
					! overlay.classList.contains(
						'wc-block-components-drawer__screen-overlay--is-hidden'
					) &&
					style?.opacity !== '0' &&
					style?.pointerEvents !== 'none'
			);
		} );
		result.successLabel = ( await button.textContent() )
			.trim()
			.toLowerCase()
			.includes( 'en carrito' );

		const closeButton = page.locator(
			'.wc-block-mini-cart__drawer .wc-block-components-drawer__close'
		);
		await closeButton.first().evaluate( ( element ) => element.click() );
		await waitForMiniCart( page, false );
		await page.waitForTimeout( 160 );
		result.scrollRestoredAfterClose =
			await auditDocumentScrollRestored( page );
		await page
			.locator( '.wc-block-mini-cart__button' )
			.first()
			.evaluate( ( element ) => element.click() );
		await waitForMiniCart( page, true );
		const removeButton = page.locator(
			'.wc-block-mini-cart__drawer [aria-label^="Eliminar"]'
		);
		navigations = 0;
		await removeButton.first().evaluate( ( element ) => element.click() );
		await waitForStoreBadge( page, 0 );
		result.removeNoNavigation = navigations === 0;

		await page.route( '**/wp-json/wc/store/v1/batch**', ( route ) =>
			route.abort()
		);
		routeActive = true;
		const failingButton = card.locator(
			'.wc-block-components-product-button__button'
		);
		navigations = 0;
		await failingButton.evaluate( ( element ) => element.click() );
		await page.waitForTimeout( 180 );
		await page.evaluate( () => {
			const failedControl = document.querySelector(
				'.wc-block-product .wc-block-components-product-button__button'
			);
			document.body.dispatchEvent(
				new CustomEvent( 'wc-blocks_add_to_cart_failed', {
					bubbles: true,
					detail: { button: failedControl },
				} )
			);
		} );
		await page
			.locator( '.lm-store-feedback.is-visible' )
			.waitFor( { state: 'visible', timeout: 5_000 } );
		result.errorFeedbackVisible = true;
		await page.waitForTimeout( 2_400 );
		result.errorControlRecovered = await failingButton.evaluate(
			( element ) =>
				! element.hasAttribute( 'aria-busy' ) &&
				! element.classList.contains( 'lm-is-pending' ) &&
				! element.classList.contains( 'lm-is-error' )
		);
		result.passed = Boolean(
			result.addNoNavigation &&
				result.drawerOpened &&
				result.scrollRestoredAfterClose?.passed &&
				result.successLabel &&
				result.removeNoNavigation &&
				result.errorFeedbackVisible &&
				result.errorControlRecovered
		);
	} catch ( error ) {
		result.error = error.message;
	} finally {
		if ( routeActive ) {
			await page.unroute( '**/wp-json/wc/store/v1/batch**' );
		}
		await context.close();
	}
	return result;
};

const runCartInteractionAudit = async ( width ) => {
	const result = {
		width,
		cartHydrated: false,
		quantityNoNavigation: false,
		removeNoNavigation: false,
		passed: false,
	};
	const context = await browser.newContext( {
		viewport: { width, height: 900 },
	} );
	const page = await context.newPage();
	let navigations = 0;
	page.on( 'framenavigated', ( frame ) => {
		if ( frame === page.mainFrame() ) {
			navigations += 1;
		}
	} );
	try {
		if ( ! ( await addSimpleProductForAudit( page ) ) ) {
			throw new Error( 'No se pudo preparar el carrito de auditoría.' );
		}
		await page.goto( new URL( '/carrito/', baseURL ).href, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
		navigations = 0;
		await waitForCommerceBlock(
			page,
			'.wp-block-woocommerce-cart',
			requiredContent[ 'carrito-lleno' ]
		);
		result.cartHydrated = await page.evaluate( () => {
			const root = document.querySelector( '.wc-block-cart' );
			return Boolean(
				root?.querySelector( '.wc-block-cart-item__product' ) &&
					! root.querySelector( '.wc-block-components-skeleton' )
			);
		} );
		if ( ! result.cartHydrated ) {
			await page.reload( { waitUntil: 'networkidle', timeout: 45_000 } );
			navigations = 0;
			await waitForCommerceBlock(
				page,
				'.wp-block-woocommerce-cart',
				requiredContent[ 'carrito-lleno' ]
			);
			result.cartHydrated = await page.evaluate( () => {
				const root = document.querySelector( '.wc-block-cart' );
				return Boolean(
					root?.querySelector( '.wc-block-cart-item__product' ) &&
						! root.querySelector( '.wc-block-components-skeleton' )
				);
			} );
		}
		const quantityInput = page.locator(
			'.wc-block-cart input.wc-block-components-quantity-selector__input'
		);
		const plusButton = page.locator(
			'.wc-block-cart .wc-block-components-quantity-selector__button--plus'
		);
		await quantityInput.waitFor( { state: 'visible', timeout: 15_000 } );
		const beforeQuantity = await quantityInput.inputValue();
		await plusButton.first().evaluate( ( element ) => element.click() );
		await page.waitForFunction(
			( value ) =>
				document.querySelector(
					'.wc-block-cart input.wc-block-components-quantity-selector__input'
				)?.value !== value,
			beforeQuantity,
			{ timeout: 15_000 }
		);
		result.quantityNoNavigation = navigations === 0;
		const removeButton = page.locator(
			'.wc-block-cart [aria-label^="Eliminar"]'
		);
		await removeButton.first().evaluate( ( element ) => element.click() );
		await page
			.locator( '.wp-block-woocommerce-empty-cart-block' )
			.waitFor( { state: 'visible', timeout: 15_000 } );
		result.removeNoNavigation = navigations === 0;
		result.passed = Boolean(
			result.cartHydrated &&
				result.quantityNoNavigation &&
				result.removeNoNavigation
		);
	} catch ( error ) {
		result.error = error.message;
	} finally {
		await context.close();
	}
	return result;
};

const runCheckoutInteractionAudit = async ( width ) => {
	const result = {
		width,
		blockHydrated: false,
		fieldFocus: null,
		fieldLayout: null,
		loginHrefPreserved: false,
		englishLabelCount: 0,
		passed: false,
	};
	const context = await browser.newContext( {
		viewport: { width, height: 900 },
	} );
	const page = await context.newPage();
	try {
		if (
			! ( await addSimpleProductForAudit( page ) ) &&
			! ( await addDirectProductForAudit( page ) )
		) {
			throw new Error( 'No se pudo preparar el checkout de auditoría.' );
		}
		const checkoutUrl = new URL( '/finalizar-compra/', baseURL ).href;
		await page.goto( checkoutUrl, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
		if ( ! page.url().includes( '/finalizar-compra/' ) ) {
			if (
				! ( await addSimpleProductForAudit( page ) ) &&
				! ( await addDirectProductForAudit( page ) )
			) {
				throw new Error( 'El carrito de checkout quedó vacío.' );
			}
			await page.goto( checkoutUrl, {
				waitUntil: 'networkidle',
				timeout: 45_000,
			} );
		}
		await waitForCommerceBlock(
			page,
			'.wc-block-checkout',
			requiredContent.checkout
		);
		const readCheckoutState = () =>
			page.evaluate( () => {
				const root = document.querySelector( '.wc-block-checkout' );
				const login = root?.querySelector(
					'.wc-block-checkout__login-prompt'
				);
				return {
					hydrated: Boolean(
						root &&
							root.querySelector(
								'.wc-block-components-checkout-place-order-button'
							) &&
							! root.querySelector(
								'.wc-block-components-skeleton'
							)
					),
					loginHref: login?.getAttribute( 'href' ) || '',
					englishLabelCount: [
						...document.querySelectorAll( 'label' ),
					].filter( ( label ) =>
						label.textContent.includes(
							'Create an account with Lupita Márquez'
						)
					).length,
				};
			} );
		let state = await readCheckoutState();
		if ( ! state.hydrated ) {
			await page.waitForTimeout( 1_200 );
			state = await readCheckoutState();
		}
		if ( ! state.hydrated ) {
			await page.reload( { waitUntil: 'networkidle', timeout: 45_000 } );
			await waitForCommerceBlock(
				page,
				'.wc-block-checkout',
				requiredContent.checkout
			);
			state = await readCheckoutState();
		}
		result.blockHydrated = state.hydrated;
		const checkoutField = page
			.locator( '.wc-block-components-text-input input' )
			.first();
		await checkoutField.waitFor( { state: 'visible', timeout: 15_000 } );
		result.fieldFocus = await auditTextFieldFocus( checkoutField );
		result.fieldLayout = await auditCheckoutFieldLayout( page );
		result.loginHrefPreserved =
			state.loginHref.includes( '/mi-cuenta/' ) &&
			state.loginHref.includes( 'redirect_to=' );
		result.englishLabelCount = state.englishLabelCount;
		result.passed = Boolean(
			result.blockHydrated &&
				result.fieldFocus.passed &&
				result.fieldLayout.labelClearance &&
				result.fieldLayout.pairedFieldsAligned &&
				result.fieldLayout.shippingGrid &&
				result.fieldLayout.labelStable &&
				result.fieldLayout.selectVerticallyCentered &&
				result.loginHrefPreserved &&
				result.englishLabelCount === 0
		);
	} catch ( error ) {
		result.error = error.message;
	} finally {
		await context.close();
	}
	return result;
};

const auditPasswordVisibilityControl = async ( page ) => {
	const control = page
		.locator( '.password-input .show-password-input' )
		.first();
	await control.waitFor( { state: 'visible', timeout: 15_000 } );

	const readState = async () =>
		control.evaluate( ( button ) => {
			const field = button.parentElement?.querySelector( 'input' );
			const buttonBounds = button.getBoundingClientRect();
			const fieldBounds = field?.getBoundingClientRect();
			return {
				ariaControls: button.getAttribute( 'aria-controls' ),
				ariaLabel: button.getAttribute( 'aria-label' ),
				ariaPressed: button.getAttribute( 'aria-pressed' ),
				contained: Boolean(
					fieldBounds &&
						buttonBounds.left >= fieldBounds.left &&
						buttonBounds.right <= fieldBounds.right
				),
				height: buttonBounds.height,
				inputId: field?.id || '',
				isVisible: button.classList.contains(
					'lm-password-toggle--visible'
				),
				type: field?.type || '',
				width: buttonBounds.width,
			};
		} );

	const hidden = await readState();
	await control.click();
	await page.waitForFunction(
		() => {
			const button = document.querySelector(
				'.password-input .show-password-input'
			);
			const field = button?.parentElement?.querySelector( 'input' );
			return Boolean(
				button?.classList.contains( 'lm-password-toggle--visible' ) &&
					field?.type === 'text'
			);
		},
		{ timeout: 10_000 }
	);
	const shown = await readState();
	await control.click();
	await page.waitForFunction(
		() => {
			const button = document.querySelector(
				'.password-input .show-password-input'
			);
			const field = button?.parentElement?.querySelector( 'input' );
			return Boolean(
				! button?.classList.contains( 'lm-password-toggle--visible' ) &&
					field?.type === 'password'
			);
		},
		{ timeout: 10_000 }
	);
	const restored = await readState();

	return {
		hidden,
		passed:
			hidden.type === 'password' &&
			hidden.ariaLabel === 'Mostrar contraseña' &&
			hidden.ariaPressed === 'false' &&
			hidden.ariaControls === hidden.inputId &&
			hidden.contained &&
			hidden.width >= 43.5 &&
			hidden.height >= 43.5 &&
			shown.type === 'text' &&
			shown.isVisible &&
			shown.ariaLabel === 'Ocultar contraseña' &&
			shown.ariaPressed === 'true' &&
			restored.type === 'password' &&
			! restored.isVisible &&
			restored.ariaLabel === 'Mostrar contraseña' &&
			restored.ariaPressed === 'false',
		restored,
		shown,
	};
};

const runAccountInteractionAudit = async ( width ) => {
	const result = {
		width,
		fieldFocus: null,
		passwordVisibility: null,
		loginFormNative: false,
		passwordRecoveryAvailable: false,
		singleFormDefault: false,
		registrationSwitchAvailable: false,
		registrationViewAccessible: false,
		loginViewRestored: false,
		registrationFallbackAvailable: false,
		registrationErrorLocalized: false,
		loginErrorLocalized: false,
		authNoticeAligned: false,
		accountIntroAbsent: false,
		semanticTitlePresent: false,
		authenticatedAccount: null,
		passed: false,
	};
	const context = await browser.newContext( {
		viewport: { width, height: 900 },
	} );
	const page = await context.newPage();
	try {
		await page.goto( new URL( '/mi-cuenta/', baseURL ).href, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
		const state = await page.evaluate( () => {
			const form = document.querySelector(
				'form.woocommerce-form-login'
			);
			const recovery = document.querySelector(
				'.woocommerce-LostPassword a'
			);
			return {
				accountIntroPresent: Boolean(
					document.querySelector( '.lm-account-page .lm-page-intro' )
				),
				formAction:
					form?.action || form?.getAttribute( 'action' ) || '',
				formMethod:
					form?.method || form?.getAttribute( 'method' ) || '',
				recoveryHref: recovery?.getAttribute( 'href' ) || '',
				semanticTitle:
					document
						.querySelector( '.lm-account-page h1.lm-sr-only' )
						?.textContent?.trim() || '',
			};
		} );
		result.accountIntroAbsent = ! state.accountIntroPresent;
		result.semanticTitlePresent = state.semanticTitle === 'Mi cuenta';
		const accountField = page
			.locator( '.woocommerce-form-login input[name="username"]' )
			.first();
		await accountField.waitFor( { state: 'visible', timeout: 15_000 } );
		result.fieldFocus = await auditTextFieldFocus( accountField );
		result.loginFormNative =
			state.formMethod.toLowerCase() === 'post' &&
			state.formAction.includes( '/mi-cuenta/' );
		result.passwordRecoveryAvailable =
			state.recoveryHref.includes( 'lost-password' );
		result.passwordVisibility =
			await auditPasswordVisibilityControl( page );
		const loginForm = page.locator( '.woocommerce-form-login' );
		const registrationForm = page.locator( '.woocommerce-form-register' );
		const registrationSwitch = page.locator(
			'[data-lm-account-view-target="register"]'
		);
		result.singleFormDefault =
			( await loginForm.isVisible() ) &&
			! ( await registrationForm.isVisible() );
		result.registrationSwitchAvailable =
			await registrationSwitch.isVisible();
		await registrationSwitch.click();
		result.registrationViewAccessible =
			( await registrationForm.isVisible() ) &&
			! ( await loginForm.isVisible() ) &&
			( await page
				.locator(
					'[data-lm-account-panel="register"] [data-lm-account-panel-title]'
				)
				.evaluate(
					( heading ) =>
						heading === heading.ownerDocument.activeElement
				) );
		await page.locator( '[data-lm-account-view-target="login"]' ).click();
		result.loginViewRestored =
			( await loginForm.isVisible() ) &&
			! ( await registrationForm.isVisible() );
		const registrationURL = new URL( '/mi-cuenta/', baseURL );
		registrationURL.searchParams.set( 'lm-account-view', 'register' );
		await page.goto( registrationURL.href, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
		result.registrationFallbackAvailable =
			( await page
				.locator( '.woocommerce-form-register' )
				.isVisible() ) &&
			! ( await page.locator( '.woocommerce-form-login' ).isVisible() );
		await page
			.locator( '.woocommerce-form-register input[name="email"]' )
			.fill( 'admin@example.test' );
		await page
			.locator( '.woocommerce-form-register button[name="register"]' )
			.click();
		await page.waitForLoadState( 'networkidle' );
		const registrationError = await page.evaluate( () => {
			const notice = document.querySelector(
				'.lm-account-section .wc-block-components-notice-banner.is-error'
			);
			const auth = document.querySelector( '.lm-account-auth' );
			const noticeRect = notice?.getBoundingClientRect();
			const authRect = auth?.getBoundingClientRect();
			const text =
				notice?.textContent?.replace( /\s+/g, ' ' ).trim() || '';
			return {
				text,
				aligned: Boolean(
					noticeRect &&
						authRect &&
						Math.abs( noticeRect.width - authRect.width ) < 2 &&
						Math.abs( noticeRect.left - authRect.left ) < 2
				),
			};
		} );
		result.registrationErrorLocalized =
			registrationError.text.includes(
				'Ya existe una cuenta asociada'
			) &&
			! /an account is already registered/i.test(
				registrationError.text
			);
		result.authNoticeAligned = registrationError.aligned;
		await page.goto( new URL( '/mi-cuenta/', baseURL ).href, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
		await accountField.fill( 'admin' );
		await page
			.locator( '.woocommerce-form-login input[name="password"]' )
			.fill( 'incorrect-password' );
		await page
			.locator( '.woocommerce-form-login button[name="login"]' )
			.click();
		await page.waitForLoadState( 'networkidle' );
		result.loginErrorLocalized = await page.evaluate( () => {
			const text =
				document.querySelector(
					'.lm-account-section .wc-block-components-notice-banner.is-error'
				)?.textContent || '';
			return (
				/(contraseña|correo|sesión)/i.test( text ) &&
				! /the password you entered|an account is already registered/i.test(
					text
				)
			);
		} );
		await page.goto( new URL( '/mi-cuenta/', baseURL ).href, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
		await accountField.fill( 'admin' );
		await page
			.locator( '.woocommerce-form-login input[name="password"]' )
			.fill( 'admin-local-only' );
		await page
			.locator( '.woocommerce-form-login button[name="login"]' )
			.click();
		await page.waitForLoadState( 'networkidle' );
		result.authenticatedAccount = await page.evaluate( () => {
			const navigation = document.querySelector(
				'.woocommerce-MyAccount-navigation'
			);
			const links = [ ...( navigation?.querySelectorAll( 'a' ) || [] ) ];
			const navigationLabels = links.map( ( link ) =>
				link.textContent?.trim().toLowerCase()
			);
			return {
				profileSummaryPresent: Boolean(
					document.querySelector( '.lm-account-profile__identity' )
				),
				twoPrimaryTabs:
					navigationLabels.length === 2 &&
					navigationLabels.includes( 'pedidos' ) &&
					navigationLabels.includes( 'mi perfil' ),
				navigationVisible: Boolean(
					navigation?.getClientRects().length
				),
			};
		} );
		await page.goto( new URL( '/mi-cuenta/orders/', baseURL ).href, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
		Object.assign(
			result.authenticatedAccount,
			await page.evaluate( () => ( {
				englishNoticeCount: [
					...document.querySelectorAll(
						'.wc-block-components-notice-banner'
					),
				].filter( ( notice ) =>
					/confirm your email address|confirm email address|temporary password|\bresend\b/i.test(
						notice.textContent || ''
					)
				).length,
				ordersListPresent: Boolean(
					document.querySelector( '.lm-account-orders' )
				),
			} ) )
		);
		result.passed = Boolean(
			result.fieldFocus.passed &&
				result.passwordVisibility.passed &&
				result.loginFormNative &&
				result.passwordRecoveryAvailable &&
				result.singleFormDefault &&
				result.registrationSwitchAvailable &&
				result.registrationViewAccessible &&
				result.loginViewRestored &&
				result.registrationFallbackAvailable &&
				result.registrationErrorLocalized &&
				result.loginErrorLocalized &&
				result.authNoticeAligned &&
				result.accountIntroAbsent &&
				result.semanticTitlePresent &&
				result.authenticatedAccount.profileSummaryPresent &&
				result.authenticatedAccount.twoPrimaryTabs &&
				result.authenticatedAccount.navigationVisible &&
				result.authenticatedAccount.englishNoticeCount === 0 &&
				result.authenticatedAccount.ordersListPresent
		);
	} catch ( error ) {
		result.error = error.message;
	} finally {
		await context.close();
	}
	return result;
};

const runContactInteractionAudit = async ( width ) => {
	const result = {
		width,
		fieldFocus: null,
		layout: null,
		nativeValidationAvailable: false,
		invalidSubmissionBlocked: false,
		asyncSuccessVisible: false,
		fieldsResetAfterSuccess: false,
		heading: null,
		passed: false,
	};
	const context = await browser.newContext( {
		viewport: { width, height: 900 },
	} );
	const page = await context.newPage();
	try {
		await page.goto( new URL( '/contacto/', baseURL ).href, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
		const form = page.locator( '[data-lm-contact-form]' );
		result.heading = await page.evaluate( () => {
			const heading = document.querySelector( '.lm-contact-copy h1' );
			const copy = document.querySelector( '.lm-contact-copy' );
			return {
				centered: Boolean(
					heading &&
						copy &&
						window.getComputedStyle( copy ).textAlign === 'center'
				),
				duplicateHeadingAbsent:
					document.querySelectorAll( '.lm-contact-copy h1' )
						.length === 1 &&
					document.querySelectorAll( '.lm-page-intro--contact' )
						.length === 0 &&
					document.querySelectorAll( '.lm-eyebrow' ).length === 0,
				text: heading?.textContent?.trim() || '',
			};
		} );
		result.fieldFocus = await auditTextFieldFocus(
			form.locator( '[name="name"]' )
		);
		result.layout = await form.evaluate( ( element ) => {
			const approximately = ( value, expected, tolerance = 0.75 ) =>
				Math.abs( value - expected ) <= tolerance;
			const bounds = ( target ) => target.getBoundingClientRect();
			const fields = [
				...element.querySelectorAll( '.lm-contact-form__field' ),
			].map( ( field ) => {
				const label = field.querySelector( 'label' );
				const control = field.querySelector( 'input, textarea' );
				const fieldBounds = bounds( field );
				const labelBounds = bounds( label );
				const controlBounds = bounds( control );
				const labelStyle = window.getComputedStyle( label );

				return {
					bottom: fieldBounds.bottom,
					control: control.name,
					labelControlGap: controlBounds.top - labelBounds.bottom,
					labelFontSize: Number.parseFloat( labelStyle.fontSize ),
					labelFontWeight: Number.parseInt(
						labelStyle.fontWeight,
						10
					),
					labelLineHeight: Number.parseFloat( labelStyle.lineHeight ),
					top: fieldBounds.top,
				};
			} );
			const rows = [];
			for ( const field of fields ) {
				const row = rows.find( ( item ) =>
					approximately( item.top, field.top, 1 )
				);
				if ( row ) {
					row.bottom = Math.max( row.bottom, field.bottom );
				} else {
					rows.push( { bottom: field.bottom, top: field.top } );
				}
			}
			rows.sort( ( first, second ) => first.top - second.top );
			const fieldRowGaps = rows
				.slice( 1 )
				.map( ( row, index ) => row.top - rows[ index ].bottom );
			const consent = element.querySelector(
				'.lm-contact-form__consent'
			);
			const consentLabel = element.querySelector(
				'.lm-contact-form__consent-label'
			);
			const actions = element.querySelector(
				'.lm-contact-form__actions'
			);
			const message = element.querySelector(
				'.lm-contact-form__field--wide'
			);
			const note = element.querySelector( '.lm-contact-form__note' );
			const submit = element.querySelector( '[data-lm-contact-submit]' );
			const consentBounds = bounds( consent );
			const actionsBounds = bounds( actions );
			const messageBounds = bounds( message );
			const noteBounds = bounds( note );
			const submitBounds = bounds( submit );
			const actionsStyle = window.getComputedStyle( actions );
			const consentStyle = window.getComputedStyle( consentLabel );
			const actionGap =
				actionsStyle.flexDirection === 'column'
					? noteBounds.top - submitBounds.bottom
					: noteBounds.left - submitBounds.right;
			const unexpectedVisibleDirectChildren = [
				...element.children,
			].filter(
				( child ) =>
					child.getClientRects().length > 0 &&
					! child.matches(
						'.lm-contact-form__field, .lm-contact-form__trap, .lm-contact-form__consent, .lm-contact-form__status, .lm-contact-form__actions, input[type="hidden"]'
					)
			).length;
			const labelFontSizes = fields.map(
				( field ) => field.labelFontSize
			);
			const fieldLabelsConsistent = Boolean(
				fields.length === 5 &&
					Math.max( ...labelFontSizes ) -
						Math.min( ...labelFontSizes ) <=
						0.1 &&
					fields.every(
						( field ) =>
							field.labelFontWeight === 600 &&
							field.labelLineHeight >= 17 &&
							field.labelLineHeight <= 19.5
					)
			);
			const consentTypographyMatches = Boolean(
				approximately(
					Number.parseFloat( consentStyle.fontSize ),
					labelFontSizes[ 0 ],
					0.1
				) && Number.parseInt( consentStyle.fontWeight, 10 ) === 600
			);
			const layoutResult = {
				actionGap,
				consentActionsGap: actionsBounds.top - consentBounds.bottom,
				consentTypographyMatches,
				emptyActionParagraphs: element.querySelectorAll(
					'.lm-contact-form__actions > p:empty'
				).length,
				fieldLabelsConsistent,
				fieldRowGaps,
				fields,
				lineBreaks: element.querySelectorAll( 'br' ).length,
				messageConsentGap: consentBounds.top - messageBounds.bottom,
				unexpectedVisibleDirectChildren,
			};
			layoutResult.passed = Boolean(
				layoutResult.lineBreaks === 0 &&
					layoutResult.emptyActionParagraphs === 0 &&
					layoutResult.unexpectedVisibleDirectChildren === 0 &&
					layoutResult.fieldLabelsConsistent &&
					layoutResult.consentTypographyMatches &&
					fields.every( ( field ) =>
						approximately( field.labelControlGap, 8 )
					) &&
					fieldRowGaps.every( ( gap ) => approximately( gap, 20 ) ) &&
					approximately( layoutResult.messageConsentGap, 20 ) &&
					approximately( layoutResult.consentActionsGap, 20 ) &&
					approximately( layoutResult.actionGap, 16 )
			);

			return layoutResult;
		} );
		result.nativeValidationAvailable = await form.evaluate(
			( element ) =>
				element.querySelectorAll( '[required]' ).length === 5 &&
				typeof element.checkValidity === 'function'
		);
		await form.locator( '[name="name"]' ).fill( 'Auditoría frontend' );
		await form
			.locator( '[name="email"]' )
			.fill( `auditoria-${ Date.now() }@example.test` );
		await form.locator( '[name="subject"]' ).fill( 'Prueba automatizada' );
		await form
			.locator( '[name="message"]' )
			.fill( 'Validación automática del formulario de contacto.' );
		result.invalidSubmissionBlocked = await form.evaluate(
			( element ) => ! element.checkValidity()
		);
		await form.locator( '[name="privacy"]' ).check();
		await form.locator( '[data-lm-contact-submit]' ).click();
		await form
			.locator( '[data-lm-contact-status].is-success' )
			.waitFor( { state: 'visible', timeout: 15_000 } );
		result.asyncSuccessVisible = true;
		result.fieldsResetAfterSuccess = await form.evaluate(
			( element ) =>
				[ 'name', 'email', 'subject', 'message' ].every(
					( name ) => ! element.elements.namedItem( name )?.value
				) && ! element.elements.namedItem( 'privacy' )?.checked
		);
		result.passed = Boolean(
			result.fieldFocus.passed &&
				result.layout.passed &&
				result.heading.centered &&
				result.heading.duplicateHeadingAbsent &&
				result.heading.text === 'Contacto' &&
				result.nativeValidationAvailable &&
				result.invalidSubmissionBlocked &&
				result.asyncSuccessVisible &&
				result.fieldsResetAfterSuccess
		);
	} catch ( error ) {
		result.error = error.message;
	} finally {
		await context.close();
	}
	return result;
};

for ( const width of widths ) {
	const context = await browser.newContext( {
		viewport: { width, height: 900 },
	} );

	for ( const [ name, pathname, setup ] of routes ) {
		const page = await context.newPage();
		const messages = [];
		const pageErrors = [];
		let interactionAudit = null;
		const actionAudit = [];
		let formAudit = null;
		let mobileNavigationAudit = null;
		let productMediaAudit = null;
		let singleProductGalleryAudit = null;
		let stickyHeaderAudit = null;
		let variationAudit = null;

		page.on( 'console', ( message ) => {
			if ( message.type() === 'error' || message.type() === 'warning' ) {
				if (
					name === 'error-404' &&
					message.text().includes( 'status of 404' )
				) {
					return;
				}
				messages.push( { type: message.type(), text: message.text() } );
			}
		} );
		page.on( 'pageerror', ( error ) => pageErrors.push( error.message ) );

		await page.addInitScript( () => {
			window.__lmCLS = 0;
			new PerformanceObserver( ( list ) => {
				for ( const entry of list.getEntries() ) {
					if ( ! entry.hadRecentInput ) {
						window.__lmCLS += entry.value;
					}
				}
			} ).observe( { type: 'layout-shift', buffered: true } );
		} );

		if ( setup === 'fill-cart' ) {
			await page.goto(
				new URL( '/producto/altar-para-mascotas/', baseURL ).href,
				{
					waitUntil: 'networkidle',
					timeout: 45_000,
				}
			);
			const addButton = page.locator( '.single_add_to_cart_button' );
			if ( await addButton.isVisible() ) {
				await addButton.click();
				await page
					.waitForFunction(
						() =>
							document
								.querySelector( '.lm-cart-status' )
								?.textContent.includes(
									'se agregó al carrito'
								) ||
							Number(
								document
									.querySelector(
										'.wc-block-mini-cart__badge'
									)
									?.textContent.trim()
							) > 0,
						undefined,
						{ timeout: 15_000 }
					)
					.catch( () => {} );
				await page.waitForLoadState( 'networkidle' );
			}
		}

		const response = await page.goto( new URL( pathname, baseURL ).href, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
		if ( setup === 'audit-variations' ) {
			const finishSelect = page.locator(
				'select[name="attribute_acabado"]'
			);
			await finishSelect.waitFor( {
				state: 'attached',
				timeout: 15_000,
			} );
			const finishOptions = page.locator( '.lm-variation-options' );
			await finishOptions.waitFor( {
				state: 'visible',
				timeout: 15_000,
			} );
			const defaultFinish = await finishSelect.inputValue();

			const selectAndRead = async ( label, expectedPrice ) => {
				const option = finishOptions
					.locator( '.lm-variation-option' )
					.filter( { hasText: label } );
				const fromHeight = await page
					.locator( '.lm-product-gallery' )
					.evaluate(
						( element ) => element.getBoundingClientRect().height
					);
				await option.click();
				await page.waitForFunction(
					( price ) =>
						Number(
							document.querySelector(
								'input[name="variation_id"]'
							)?.value
						) > 0 &&
						document
							.querySelector( '.woocommerce-variation-price' )
							?.textContent.includes( price ),
					expectedPrice,
					{ timeout: 15_000 }
				);
				await page.waitForFunction(
					() => {
						const gallery = document.querySelector(
							'.lm-product-gallery'
						);
						return Boolean(
							gallery?.classList.contains( 'lm-is-resizing' ) &&
								gallery.style.height
						);
					},
					undefined,
					{ timeout: 15_000 }
				);
				const transition = await page
					.locator( '.lm-product-gallery' )
					.evaluate( ( element, initialHeight ) => {
						const style = window.getComputedStyle( element );
						return {
							duration: Number.parseFloat(
								style.transitionDuration
							),
							fromHeight: initialHeight,
							property: style.transitionProperty,
							started:
								element.classList.contains( 'lm-is-resizing' ),
							targetHeight: Number.parseFloat(
								element.style.height
							),
						};
					}, fromHeight );
				await page.waitForFunction(
					() =>
						! document
							.querySelector( '.lm-product-gallery' )
							?.classList.contains( 'lm-is-resizing' ),
					undefined,
					{ timeout: 15_000 }
				);
				const result = await page.evaluate( ( optionLabel ) => {
					const gallery = document.querySelector(
						'.lm-product-gallery .woocommerce-product-gallery'
					);
					const details = document.querySelector(
						'.lm-product-details-section'
					);
					const purchase = document.querySelector(
						'.lm-product-purchase'
					);
					const description = document.querySelector(
						'.woocommerce-variation-description'
					);
					const selectedOption = [
						...document.querySelectorAll( '.lm-variation-option' ),
					].find(
						( item ) => item.textContent.trim() === optionLabel
					);
					const selectedOptionText =
						selectedOption?.querySelector( 'span' );
					const optionBounds =
						selectedOption?.getBoundingClientRect();
					const optionTextBounds =
						selectedOptionText?.getBoundingClientRect();
					const checkStyle = selectedOption
						? window.getComputedStyle( selectedOption, '::after' )
						: null;
					return {
						variationId: Number(
							document.querySelector(
								'input[name="variation_id"]'
							)?.value
						),
						gallery: [
							...new Set(
								[
									...document.querySelectorAll(
										'.woocommerce-product-gallery img, .wp-block-woocommerce-product-gallery img, .wp-block-woocommerce-product-image-gallery img, .lm-product-gallery img'
									),
								]
									.map(
										( image ) =>
											image.currentSrc || image.src
									)
									.filter( ( source ) =>
										source.includes( '/uploads/' )
									)
							),
						],
						offerAvailabilityText:
							document
								.querySelector(
									'.lm-product-offer__availability'
								)
								?.textContent.trim() || '',
						offerPriceText:
							document
								.querySelector( '.lm-product-offer__price' )
								?.textContent.trim() || '',
						optionSelected: Boolean(
							selectedOption?.classList.contains( 'is-selected' )
						),
						optionPresentation: {
							checkPositioned:
								checkStyle?.position === 'absolute' &&
								Number.parseFloat( checkStyle.right ) > 0,
							textCenterOffset:
								optionBounds && optionTextBounds
									? optionTextBounds.left +
									  optionTextBounds.width / 2 -
									  ( optionBounds.left +
											optionBounds.width / 2 )
									: Infinity,
						},
						priceText:
							document
								.querySelector( '.woocommerce-variation-price' )
								?.textContent.trim() || '',
						variationPriceHidden:
							document.querySelector(
								'.woocommerce-variation-price'
							) &&
							window.getComputedStyle(
								document.querySelector(
									'.woocommerce-variation-price'
								)
							).display === 'none',
						layout: {
							descriptionHidden:
								! description ||
								window.getComputedStyle( description )
									.display === 'none',
							detailsTop:
								( details?.getBoundingClientRect().top || 0 ) +
								window.scrollY,
							galleryHeight:
								gallery?.getBoundingClientRect().height || 0,
							purchaseHeight:
								purchase?.getBoundingClientRect().height || 0,
						},
					};
				}, label );
				result.transition = transition;
				return result;
			};
			const auditActiveGallery = async () =>
				page.evaluate( () => {
					const gallery = document.querySelector(
						'.lm-product-gallery .woocommerce-product-gallery'
					);
					const stage =
						gallery?.querySelector( '.flex-viewport' ) ||
						gallery?.querySelector(
							'.woocommerce-product-gallery__wrapper'
						);
					const active =
						gallery?.querySelector( '.flex-active-slide' ) ||
						gallery?.querySelector(
							'.woocommerce-product-gallery__image'
						);
					const image = active?.querySelector( 'img' );
					const stageBounds = stage?.getBoundingClientRect();
					const activeBounds = active?.getBoundingClientRect();
					const overlapsStage =
						Boolean( stageBounds && activeBounds ) &&
						activeBounds.right > stageBounds.left &&
						activeBounds.left < stageBounds.right &&
						activeBounds.bottom > stageBounds.top &&
						activeBounds.top < stageBounds.bottom;
					return {
						activeHeight: activeBounds?.height || 0,
						activeWidth: activeBounds?.width || 0,
						imageDecoded: Boolean(
							image?.complete && image.naturalWidth
						),
						imageObjectFit: image
							? window.getComputedStyle( image ).objectFit
							: '',
						overlapsStage,
						stageHeight: stageBounds?.height || 0,
						stageWidth: stageBounds?.width || 0,
					};
				} );
			const auditGalleryNavigation = async () => {
				const thumbs = page.locator(
					'.lm-product-gallery .flex-control-thumbs img'
				);
				const results = [];
				for (
					let index = 0;
					index < ( await thumbs.count() );
					index++
				) {
					await thumbs.nth( index ).click();
					await page.waitForTimeout( 650 );
					results.push( await auditActiveGallery() );
				}
				return results;
			};

			const natural = await selectAndRead( 'Natural', '599' );
			const naturalGallery = await auditActiveGallery();
			const painted = await selectAndRead( 'Pintado', '719' );
			const paintedGallery = await auditGalleryNavigation();
			const quantity = page.locator( '.lm-quantity-control' );
			const quantityInput = quantity.locator( 'input.qty' );
			const decrement = quantity.locator(
				'[data-lm-quantity-step="decrease"]'
			);
			const increment = quantity.locator(
				'[data-lm-quantity-step="increase"]'
			);
			const initiallyAtMinimum = await decrement.isDisabled();
			await increment.click();
			const afterIncrease = await quantityInput.inputValue();
			await quantityInput.fill( '5' );
			await quantityInput.dispatchEvent( 'change' );
			const atMaximum = await increment.isDisabled();
			await quantityInput.fill( '1' );
			await quantityInput.dispatchEvent( 'change' );
			const cartBefore = await page.evaluate( async () =>
				fetch( '/wp-json/wc/store/v1/cart' ).then( ( result ) =>
					result.json()
				)
			);
			const cartItemBefore = cartBefore.items?.find(
				( item ) => item.sku === 'LM-ALT-CHI-PIN'
			);
			const beforeAdd = await page.evaluate( () => ( {
				documentStartedAt: window.performance.timeOrigin,
				href: window.location.href,
				scrollY: window.scrollY,
			} ) );
			await page
				.locator( '.single_add_to_cart_button' )
				.evaluate( ( button ) => {
					button.click();
					button.click();
				} );
			await page.waitForFunction(
				() =>
					Boolean(
						document.querySelector(
							'.wc-block-components-drawer__screen-overlay.is-open, .wc-block-components-drawer__screen-overlay[aria-hidden="false"], .wc-block-components-drawer__screen-overlay--with-slide-in'
						)
					),
				undefined,
				{ timeout: 15_000 }
			);
			await page.waitForTimeout( 350 );
			const afterAdd = await page.evaluate( () => {
				const drawer = document.querySelector(
					'.wc-block-components-drawer__screen-overlay.is-open, .wc-block-components-drawer__screen-overlay[aria-hidden="false"], .wc-block-components-drawer__screen-overlay--with-slide-in'
				);
				const successNotice = document.querySelector(
					'.woocommerce-message, .wc-block-components-notice-banner.is-success'
				);
				const drawerDescription = drawer?.querySelector(
					'.wc-block-components-product-metadata__description'
				);
				return {
					buttonDisabled: Boolean(
						document.querySelector( '.single_add_to_cart_button' )
							?.disabled
					),
					buttonLabel:
						document
							.querySelector( '.single_add_to_cart_button' )
							?.textContent.trim() || '',
					documentStartedAt: window.performance.timeOrigin,
					drawerDescriptionHidden:
						! drawerDescription ||
						window.getComputedStyle( drawerDescription ).display ===
							'none',
					drawerFocused: Boolean(
						drawer?.contains( drawer.ownerDocument.activeElement )
					),
					drawerOpen: Boolean( drawer ),
					href: window.location.href,
					scrollY: window.scrollY,
					successNoticeVisible: Boolean(
						successNotice?.getClientRects().length
					),
				};
			} );
			await page.keyboard.press( 'Escape' );
			await page.waitForFunction(
				() =>
					! document.querySelector(
						'.wc-block-components-drawer__screen-overlay.is-open, .wc-block-components-drawer__screen-overlay[aria-hidden="false"], .wc-block-components-drawer__screen-overlay--with-slide-in'
					),
				undefined,
				{ timeout: 15_000 }
			);
			const drawerClosedWithEscape = await page.evaluate(
				() =>
					! document.querySelector(
						'.wc-block-components-drawer__screen-overlay.is-open, .wc-block-components-drawer__screen-overlay[aria-hidden="false"], .wc-block-components-drawer__screen-overlay--with-slide-in'
					)
			);
			await page.waitForTimeout( 160 );
			const scrollRestoredAfterClose =
				await auditDocumentScrollRestored( page );
			await page.waitForFunction(
				() => {
					const button = document.querySelector(
						'.single_add_to_cart_button'
					);
					return Boolean(
						button &&
							! button.disabled &&
							button.textContent.includes( 'Agregar al carrito' )
					);
				},
				undefined,
				{ timeout: 5_000 }
			);
			const buttonRestored = await page.evaluate( () => {
				const button = document.querySelector(
					'.single_add_to_cart_button'
				);
				return Boolean(
					button &&
						! button.disabled &&
						button.textContent.includes( 'Agregar al carrito' )
				);
			} );
			const cart = await page.evaluate( async () =>
				fetch( '/wp-json/wc/store/v1/cart' ).then( ( result ) =>
					result.json()
				)
			);
			const cartItem = cart.items?.find(
				( item ) => item.sku === 'LM-ALT-CHI-PIN'
			);
			await quantityInput.fill( '5' );
			await quantityInput.dispatchEvent( 'change' );
			const beforeError = await page.evaluate( () => ( {
				documentStartedAt: window.performance.timeOrigin,
				href: window.location.href,
				scrollY: window.scrollY,
			} ) );
			await page
				.locator( '.single_add_to_cart_button' )
				.evaluate( ( button ) => button.click() );
			await page.waitForFunction(
				() =>
					document
						.querySelector( '[data-lm-product-feedback]' )
						?.classList.contains( 'is-visible' ),
				undefined,
				{ timeout: 15_000 }
			);
			await page.waitForTimeout( 250 );
			const productError = await page.evaluate( () => {
				const feedback = document.querySelector(
					'[data-lm-product-feedback]'
				);
				const notice = feedback?.querySelector(
					'.lm-product-feedback__notice'
				);
				const style = window.getComputedStyle( feedback );
				return {
					buttonLabel:
						document
							.querySelector( '.single_add_to_cart_button' )
							?.textContent.trim() || '',
					cartLink:
						notice?.querySelector( 'a' )?.textContent.trim() || '',
					dismissLabel:
						notice
							?.querySelector( 'button' )
							?.getAttribute( 'aria-label' ) || '',
					documentStartedAt: window.performance.timeOrigin,
					href: window.location.href,
					message:
						notice?.querySelector( 'p' )?.textContent.trim() || '',
					placement: Boolean(
						feedback?.closest( '.lm-product-purchase' )
					),
					role: notice?.getAttribute( 'role' ) || '',
					scrollY: window.scrollY,
					topNoticeCount: document.querySelectorAll(
						'.lm-product-overview > .lm-shell > .wp-block-woocommerce-store-notices, .lm-product-overview > .lm-shell > .woocommerce-error, .lm-product-overview > .lm-shell > .wc-block-components-notice-banner'
					).length,
					transitionDuration: Number.parseFloat(
						style.transitionDuration
					),
				};
			} );
			if ( width === 1280 || width === 390 ) {
				await page.screenshot( {
					path: path.join(
						outputDirectory,
						`producto-variable-error-${ width }.png`
					),
					fullPage: true,
				} );
			}
			await page.locator( '[data-lm-dismiss-product-feedback]' ).click();
			await page.waitForFunction(
				() =>
					! document
						.querySelector( '[data-lm-product-feedback]' )
						?.classList.contains( 'is-visible' )
			);
			const errorDismissed = await page.evaluate( () => ( {
				collapsed: ! document
					.querySelector( '[data-lm-product-feedback]' )
					?.classList.contains( 'is-visible' ),
				focusReturned: Boolean(
					document
						.querySelector( '[data-lm-product-feedback]' )
						?.ownerDocument.activeElement?.matches(
							'.single_add_to_cart_button, input.qty'
						)
				),
			} ) );
			await page.reload( { waitUntil: 'networkidle' } );
			const afterErrorReload = await page.evaluate( () => ( {
				errorCount: document.querySelectorAll(
					'.woocommerce-error, .wc-block-components-notice-banner.is-error'
				).length,
				feedbackVisible: Boolean(
					document
						.querySelector( '[data-lm-product-feedback]' )
						?.classList.contains( 'is-visible' )
				),
				successCount: document.querySelectorAll(
					'.woocommerce-message, .wc-block-components-notice-banner.is-success'
				).length,
			} ) );
			const purchaseSupport = await page.evaluate( () => ( {
				benefits: [
					...document.querySelectorAll(
						'.lm-product-assurance span'
					),
				].map( ( item ) => item.textContent.trim() ),
				metaPresent: Boolean(
					document.querySelector( '.lm-product-meta, .product_meta' )
				),
			} ) );
			variationAudit = {
				defaultFinish,
				natural,
				naturalGallery,
				painted,
				paintedGallery,
				quantity: { afterIncrease, atMaximum, initiallyAtMinimum },
				cartFeedback: {
					afterAdd,
					beforeAdd,
					buttonRestored,
					drawerClosedWithEscape,
					scrollRestoredAfterClose,
				},
				cartQuantityDelta:
					Number( cartItem?.quantity || 0 ) -
					Number( cartItemBefore?.quantity || 0 ),
				cartSku: cartItem?.sku || '',
				cartPrice: cartItem?.prices?.price || '',
				cartFinish:
					cartItem?.variation?.find(
						( attribute ) => attribute.attribute === 'Acabado'
					)?.value || '',
				productError: {
					afterReload: afterErrorReload,
					before: beforeError,
					dismissed: errorDismissed,
					feedback: productError,
				},
				purchaseSupport,
			};
			variationAudit.passed = Boolean(
				defaultFinish.toLowerCase() === 'pintado' &&
					natural.variationId &&
					painted.variationId &&
					natural.variationId !== painted.variationId &&
					natural.optionSelected &&
					painted.optionSelected &&
					Math.abs( natural.optionPresentation.textCenterOffset ) <=
						1 &&
					Math.abs( painted.optionPresentation.textCenterOffset ) <=
						1 &&
					natural.optionPresentation.checkPositioned &&
					painted.optionPresentation.checkPositioned &&
					natural.offerPriceText.includes( '599' ) &&
					painted.offerPriceText.includes( '719' ) &&
					natural.offerAvailabilityText.includes( 'disponibles' ) &&
					painted.offerAvailabilityText.includes( 'disponibles' ) &&
					natural.variationPriceHidden &&
					painted.variationPriceHidden &&
					natural.layout.descriptionHidden &&
					painted.layout.descriptionHidden &&
					natural.transition.started &&
					painted.transition.started &&
					natural.transition.property.includes( 'height' ) &&
					painted.transition.property.includes( 'height' ) &&
					natural.transition.duration >= 0.18 &&
					painted.transition.duration >= 0.18 &&
					Math.abs(
						natural.transition.targetHeight -
							natural.transition.fromHeight
					) >= 40 &&
					Math.abs(
						painted.transition.targetHeight -
							painted.transition.fromHeight
					) >= 40 &&
					Math.abs(
						natural.layout.galleryHeight -
							painted.layout.galleryHeight
					) >= 40 &&
					Math.abs(
						natural.layout.detailsTop - painted.layout.detailsTop
					) >= 20 &&
					Math.abs(
						natural.layout.detailsTop - painted.layout.detailsTop
					) <=
						Math.abs(
							natural.layout.galleryHeight -
								painted.layout.galleryHeight
						) +
							1 &&
					Math.abs(
						natural.layout.purchaseHeight -
							painted.layout.purchaseHeight
					) <= 1 &&
					natural.gallery.length &&
					painted.gallery.length &&
					naturalGallery.imageDecoded &&
					naturalGallery.imageObjectFit === 'contain' &&
					naturalGallery.overlapsStage &&
					paintedGallery.length > 0 &&
					paintedGallery.every(
						( item ) =>
							item.imageDecoded &&
							item.imageObjectFit === 'contain' &&
							item.overlapsStage &&
							item.activeWidth > 0 &&
							item.activeHeight > 0
					) &&
					variationAudit.quantity.initiallyAtMinimum &&
					variationAudit.quantity.afterIncrease === '2' &&
					variationAudit.quantity.atMaximum &&
					natural.priceText.includes( '599' ) &&
					painted.priceText.includes( '719' ) &&
					JSON.stringify( natural.gallery ) !==
						JSON.stringify( painted.gallery ) &&
					beforeAdd.documentStartedAt ===
						afterAdd.documentStartedAt &&
					beforeAdd.href === afterAdd.href &&
					Math.abs( beforeAdd.scrollY - afterAdd.scrollY ) <= 1 &&
					afterAdd.drawerOpen &&
					afterAdd.drawerFocused &&
					afterAdd.drawerDescriptionHidden &&
					afterAdd.buttonDisabled &&
					afterAdd.buttonLabel === 'Agregado ✓' &&
					! afterAdd.successNoticeVisible &&
					buttonRestored &&
					drawerClosedWithEscape &&
					scrollRestoredAfterClose.passed &&
					variationAudit.cartQuantityDelta === 1 &&
					beforeError.documentStartedAt ===
						productError.documentStartedAt &&
					beforeError.href === productError.href &&
					Math.abs( beforeError.scrollY - productError.scrollY ) <=
						1 &&
					productError.placement &&
					productError.role === 'alert' &&
					productError.dismissLabel === 'Cerrar mensaje' &&
					productError.cartLink === 'Ver carrito' &&
					productError.buttonLabel === 'No se pudo agregar' &&
					productError.message.includes( '5 existencias' ) &&
					! productError.message.includes( 'Ver carrito' ) &&
					productError.topNoticeCount === 0 &&
					productError.transitionDuration >= 0.14 &&
					errorDismissed.collapsed &&
					errorDismissed.focusReturned &&
					! afterErrorReload.feedbackVisible &&
					afterErrorReload.errorCount === 0 &&
					afterErrorReload.successCount === 0 &&
					! purchaseSupport.metaPresent &&
					JSON.stringify( purchaseSupport.benefits ) ===
						JSON.stringify( [
							'Hecho en México',
							'Envíos seguros',
							'Compra segura',
						] ) &&
					variationAudit.cartSku === 'LM-ALT-CHI-PIN' &&
					variationAudit.cartPrice === '71900' &&
					variationAudit.cartFinish === 'Pintado'
			);
		}
		if ( name === 'carrito-lleno' || name === 'checkout' ) {
			const hydratedSelector = requiredContent[ name ];
			await waitForCommerceBlock(
				page,
				name === 'carrito-lleno'
					? '.wp-block-woocommerce-cart'
					: '.wc-block-checkout',
				hydratedSelector
			);
			await page.evaluate( () => {
				// Exclude the intentional WooCommerce skeleton-to-content hydration shift.
				window.__lmCLS = 0;
			} );
		}

		await page.evaluate( async () => {
			for (
				let y = 0;
				y < document.documentElement.scrollHeight;
				y += window.innerHeight * 0.8
			) {
				window.scrollTo( 0, y );
				await new Promise( ( resolve ) => setTimeout( resolve, 80 ) );
			}
			window.scrollTo( 0, 0 );
			await document.fonts.ready;
			await Promise.all(
				[ ...document.images ].map(
					( image ) =>
						new Promise( ( resolve ) => {
							if ( image.complete ) {
								resolve();
								return;
							}
							image.addEventListener( 'load', resolve, {
								once: true,
							} );
							image.addEventListener( 'error', resolve, {
								once: true,
							} );
							setTimeout( resolve, 5_000 );
						} )
				)
			);
			await Promise.all(
				[ ...document.images ].map( ( image ) =>
					Promise.race( [
						typeof image.decode === 'function'
							? image.decode().catch( () => {} )
							: Promise.resolve(),
						new Promise( ( resolve ) =>
							setTimeout( resolve, 2_000 )
						),
					] )
				)
			);
		} );
		await page.waitForTimeout( 700 );

		const metrics = await page.evaluate( async () => {
			const visible = ( element ) => {
				const style = window.getComputedStyle( element );
				const rect = element.getBoundingClientRect();
				return (
					style.visibility !== 'hidden' &&
					style.display !== 'none' &&
					rect.right > 0 &&
					rect.left < document.documentElement.clientWidth &&
					rect.width > 0 &&
					rect.height > 0
				);
			};
			const rect = ( element ) => {
				const bounds = element.getBoundingClientRect();
				return {
					left: +bounds.left.toFixed( 2 ),
					right: +bounds.right.toFixed( 2 ),
					width: +bounds.width.toFixed( 2 ),
				};
			};
			const wide = [ ...document.querySelectorAll( '.alignwide' ) ]
				.filter( visible )
				.map( ( element ) => ( {
					tag: element.tagName.toLowerCase(),
					classes: element.className,
					...rect( element ),
				} ) );
			const shells = [ ...document.querySelectorAll( '.lm-shell' ) ]
				.filter( visible )
				.map( ( element ) => ( {
					tag: element.tagName.toLowerCase(),
					classes: element.className,
					...rect( element ),
				} ) );
			const shellEdges = shells.length
				? {
						minLeft: Math.min(
							...shells.map( ( item ) => item.left )
						),
						maxLeft: Math.max(
							...shells.map( ( item ) => item.left )
						),
						minRight: Math.min(
							...shells.map( ( item ) => item.right )
						),
						maxRight: Math.max(
							...shells.map( ( item ) => item.right )
						),
				  }
				: null;
			const shellEdgeSpread = shellEdges
				? Math.max(
						shellEdges.maxLeft - shellEdges.minLeft,
						shellEdges.maxRight - shellEdges.minRight
				  )
				: 0;
			const shellElements = [
				...document.querySelectorAll( '.lm-shell' ),
			].filter( visible );
			const shellContentEdges = shellElements.length
				? shellElements.map( ( element ) => {
						const style = window.getComputedStyle( element );
						const bounds = element.getBoundingClientRect();
						const leftPadding = Number.parseFloat(
							style?.paddingLeft || '0'
						);
						const rightPadding = Number.parseFloat(
							style?.paddingRight || '0'
						);
						return {
							left: +(
								( bounds?.left || 0 ) + leftPadding
							).toFixed( 2 ),
							right: +(
								( bounds?.right || 0 ) - rightPadding
							).toFixed( 2 ),
						};
				  } )
				: [];
			const rootFontSize =
				Number.parseFloat(
					window.getComputedStyle( document.documentElement ).fontSize
				) || 16;
			const compactSpacingExpected = {
				'05': 4,
				10: 8,
				15: 12,
				20: 7.04,
				25: 20,
				30: 10.72,
				35: 28,
				40: 16,
				45: 40,
				50: 24,
				55: 56,
				60: 36,
				65: 80,
				70: 54.08,
			};
			const cssValueToPixels = ( value ) => {
				const rawValue = value.trim();
				if ( rawValue.endsWith( 'rem' ) ) {
					return Number.parseFloat( rawValue ) * rootFontSize;
				}
				if ( rawValue.endsWith( 'px' ) ) {
					return Number.parseFloat( rawValue );
				}
				return null;
			};
			const spacingTokenValues = Object.fromEntries(
				Object.keys( compactSpacingExpected ).map( ( slug ) => [
					slug,
					window
						.getComputedStyle( document.documentElement )
						.getPropertyValue( `--wp--preset--spacing--${ slug }` )
						.trim(),
				] )
			);
			const compactSpacingValid = Object.entries(
				compactSpacingExpected
			).every( ( [ slug, expected ] ) => {
				const actual = cssValueToPixels( spacingTokenValues[ slug ] );
				return actual !== null && Math.abs( actual - expected ) <= 0.2;
			} );
			const runtimeGeneratedClasses = {
				alignfull: document.querySelectorAll( '.alignfull' ).length,
				alignwide: document.querySelectorAll( '.alignwide' ).length,
				hasGlobalPadding: document.querySelectorAll(
					'.has-global-padding'
				).length,
				wpContainer: document.querySelectorAll(
					'[class*="wp-container-"]'
				).length,
				classicProduct:
					document.querySelectorAll( '.products .product' ).length,
			};
			const images = [ ...document.images ].filter( visible );
			const undecodedImageURLs = [
				...new Set(
					images
						.filter(
							( image ) =>
								! image.complete || image.naturalWidth === 0
						)
						.map( ( image ) => image.currentSrc || image.src )
				),
			];
			const brokenImages = (
				await Promise.all(
					undecodedImageURLs.map( async ( url ) => {
						try {
							const imageResponse = await fetch( url, {
								cache: 'no-store',
							} );
							if ( ! imageResponse.ok ) {
								return url;
							}
							const bitmap = await window.createImageBitmap(
								await imageResponse.blob()
							);
							bitmap.close();
							return null;
						} catch {
							return url;
						}
					} )
				)
			).filter( Boolean );
			const controls = [
				...document.querySelectorAll(
					'a, button, input, select, summary, textarea, [role="button"]'
				),
			].filter( visible );
			const hasAccessibleName = ( element ) => {
				const labelledBy = element.getAttribute( 'aria-labelledby' );
				const labelledText = labelledBy
					?.split( /\s+/ )
					.map(
						( id ) =>
							document.getElementById( id )?.textContent || ''
					)
					.join( ' ' )
					.trim();
				const explicitLabel = element.id
					? document
							.querySelector(
								`label[for="${ window.CSS.escape(
									element.id
								) }"]`
							)
							?.textContent.trim()
					: '';
				return Boolean(
					element.getAttribute( 'aria-label' )?.trim() ||
						labelledText ||
						explicitLabel ||
						element.closest( 'label' )?.textContent.trim() ||
						element.getAttribute( 'title' )?.trim() ||
						element.textContent?.trim() ||
						element
							.querySelector( 'img[alt]' )
							?.getAttribute( 'alt' )
							?.trim() ||
						( [ 'submit', 'button' ].includes( element.type ) &&
							element.value?.trim() )
				);
			};
			const criticalTargets = controls.filter( ( element ) => {
				if ( element.matches( '.skip-link, .screen-reader-text' ) ) {
					return false;
				}
				if (
					element.matches(
						'input[type="checkbox"], input[type="radio"]'
					)
				) {
					return false;
				}
				if ( element.tagName === 'A' ) {
					// Text links are exempt from the target-size requirement;
					// non-link controls remain subject to the 24px minimum.
					return false;
				}
				const bounds = element.getBoundingClientRect();
				return bounds.width < 24 || bounds.height < 24;
			} );
			const footer = document.querySelector( '.wp-site-blocks > footer' );
			const previousRootBlock = footer?.previousElementSibling;
			const footerGap =
				footer && previousRootBlock
					? footer.getBoundingClientRect().top -
					  previousRootBlock.getBoundingClientRect().bottom
					: 0;
			const headingLevels = [
				...document.querySelectorAll( 'h1, h2, h3, h4, h5, h6' ),
			]
				.filter( visible )
				.map( ( heading ) => Number( heading.tagName.slice( 1 ) ) );
			const headingLevelJumps = headingLevels.filter(
				( level, index ) =>
					index > 0 && level > headingLevels[ index - 1 ] + 1
			);
			const featuredCards = [
				...document.querySelectorAll(
					'.lm-featured-collection .wc-block-product'
				),
			].filter( visible );
			const featuredRows = featuredCards.reduce( ( rows, card ) => {
				const top = Math.round( card.getBoundingClientRect().top );
				const row = rows.find(
					( item ) => Math.abs( item.top - top ) <= 2
				);
				const button = card.querySelector(
					'.wp-block-woocommerce-product-button'
				);
				if ( row ) {
					row.bottoms.push(
						button?.getBoundingClientRect().bottom || 0
					);
				} else {
					rows.push( {
						top,
						bottoms: [
							button?.getBoundingClientRect().bottom || 0,
						],
					} );
				}
				return rows;
			}, [] );
			const featuredButtonSpread = featuredRows.length
				? Math.max(
						...featuredRows.map(
							( row ) =>
								Math.max( ...row.bottoms ) -
								Math.min( ...row.bottoms )
						)
				  )
				: 0;
			const productActions = featuredCards.map( ( card ) => {
				const media = card.querySelector(
					'.wc-block-components-product-image > a, .wp-block-woocommerce-product-image > a'
				);
				const control = card.querySelector(
					'.wp-block-woocommerce-product-button .wp-element-button'
				);
				const mediaBounds = media?.getBoundingClientRect();
				const controlBounds = control?.getBoundingClientRect();
				const action = card.querySelector(
					'.wp-block-woocommerce-product-button'
				);
				const actionStyle = action
					? window.getComputedStyle( action )
					: null;
				const label = control?.getAttribute( 'aria-label' ) || '';
				return {
					height: controlBounds?.height || 0,
					hidden: actionStyle?.display === 'none',
					labelValid: card.classList.contains(
						'product-type-variable'
					)
						? label.startsWith( 'Ver opciones de' )
						: label.startsWith( 'Agregar' ) &&
						  label.endsWith( 'al carrito' ),
					overlaysMedia: Boolean(
						mediaBounds &&
							controlBounds &&
							controlBounds.left >= mediaBounds.left &&
							controlBounds.right <= mediaBounds.right &&
							controlBounds.top >= mediaBounds.top &&
							controlBounds.bottom <= mediaBounds.bottom
					),
					width: controlBounds?.width || 0,
				};
			} );
			const productMediaItems = [
				...document.querySelectorAll(
					'.lm-product-grid .wc-block-product, .lm-related-products .wc-block-product'
				),
			]
				.filter( visible )
				.filter( ( card ) =>
					card.querySelector(
						'.wc-block-components-product-image > a, .wp-block-woocommerce-product-image > a'
					)
				)
				.map( ( card ) => {
					const wrapper = card.querySelector(
						'.wc-block-components-product-image, .wp-block-woocommerce-product-image'
					);
					const frame = wrapper?.querySelector( ':scope > a' );
					const productImage = frame?.querySelector( 'img' );
					const frameBounds = frame?.getBoundingClientRect();
					const frameStyle = frame
						? window.getComputedStyle( frame )
						: null;
					const imageStyle = productImage
						? window.getComputedStyle( productImage )
						: null;
					return {
						frameBackground: frameStyle?.backgroundColor || '',
						frameBorder: frameStyle?.border || '',
						framePadding: frameStyle?.padding || '',
						frameRadius: frameStyle?.borderRadius || '',
						imageRadius: imageStyle?.borderRadius || '',
						imageTransitionDuration:
							imageStyle?.transitionDuration || '',
						imageTransitionProperty:
							imageStyle?.transitionProperty || '',
						imageSizingNative:
							productImage?.style.objectFit === 'contain' &&
							[ '1', '1 / 1' ].includes(
								productImage?.style.aspectRatio
							),
						objectFit: imageStyle?.objectFit || '',
						square: frameBounds
							? Math.abs(
									frameBounds.width - frameBounds.height
							  ) <= 0.5
							: false,
						wrapperOverflow: wrapper
							? window.getComputedStyle( wrapper ).overflow
							: '',
					};
				} );
			const heroImage = document.querySelector( '.lm-hero__picture img' );
			const heroImageSource =
				heroImage?.currentSrc || heroImage?.src || '';
			const chevron = document.querySelector(
				'.lm-site-header .wp-block-navigation__submenu-icon svg'
			);
			const chevronItem = chevron?.closest( '.wp-block-navigation-item' );
			const nextNavigationItem = chevronItem?.nextElementSibling;
			const navigationChevronGap =
				chevron &&
				nextNavigationItem &&
				visible( chevron ) &&
				visible( nextNavigationItem )
					? nextNavigationItem.getBoundingClientRect().left -
					  chevron.getBoundingClientRect().right
					: null;
			const rounded = ( value ) =>
				typeof value === 'number' ? +value.toFixed( 2 ) : null;
			const fontSize = ( selector ) => {
				const element = document.querySelector( selector );
				return element && visible( element )
					? rounded(
							Number.parseFloat(
								window.getComputedStyle( element ).fontSize
							)
					  )
					: null;
			};
			const dimensions = ( selector ) => {
				const element = document.querySelector( selector );
				if ( ! element || ! visible( element ) ) {
					return null;
				}
				const bounds = element.getBoundingClientRect();
				return {
					height: rounded( bounds.height ),
					width: rounded( bounds.width ),
				};
			};
			const maximumFontSize = ( selector ) => {
				const sizes = [ ...document.querySelectorAll( selector ) ]
					.filter( visible )
					.map( ( element ) =>
						Number.parseFloat(
							window.getComputedStyle( element ).fontSize
						)
					);
				return sizes.length ? rounded( Math.max( ...sizes ) ) : null;
			};
			const productPage = Boolean(
				document.querySelector( '.lm-product-main' )
			);
			const productRailSelectors = [
				'.lm-product-layout',
				'.lm-product-details-heading',
				'.lm-product-description',
				'.lm-product-reviews-heading',
				'.lm-product-reviews-content',
				'.lm-related-products',
			];
			const productRails = productPage
				? productRailSelectors
						.map( ( selector ) => {
							const element = document.querySelector( selector );
							if ( ! element ) {
								return null;
							}
							const bounds = element.getBoundingClientRect();
							return {
								selector,
								left: rounded( bounds.left ),
								right: rounded( bounds.right ),
								width: rounded( bounds.width ),
							};
						} )
						.filter( Boolean )
				: [];
			const productRailSpread = productRails.length
				? Math.max(
						Math.max(
							...productRails.map( ( rail ) => rail.left )
						) -
							Math.min(
								...productRails.map( ( rail ) => rail.left )
							),
						Math.max(
							...productRails.map( ( rail ) => rail.right )
						) -
							Math.min(
								...productRails.map( ( rail ) => rail.right )
							)
				  )
				: 0;
			const overviewShell = document.querySelector(
				'.lm-product-overview .lm-shell'
			);
			const overviewShellBounds = overviewShell?.getBoundingClientRect();
			const overviewShellStyle = overviewShell
				? window.getComputedStyle( overviewShell )
				: null;
			const overviewShellContentEdges = overviewShellBounds
				? {
						left: rounded(
							overviewShellBounds.left +
								Number.parseFloat(
									overviewShellStyle.paddingLeft
								)
						),
						right: rounded(
							overviewShellBounds.right -
								Number.parseFloat(
									overviewShellStyle.paddingRight
								)
						),
				  }
				: null;
			const productRailsAligned = Boolean(
				productRails.length &&
					overviewShellContentEdges &&
					productRails.every(
						( rail ) =>
							Math.abs(
								rail.left - overviewShellContentEdges.left
							) <= 1 &&
							Math.abs(
								rail.right - overviewShellContentEdges.right
							) <= 1
					)
			);
			const siteHeader = document.querySelector( '.lm-site-header' );
			const productMain = document.querySelector( '.lm-product-main' );
			const productStartGap =
				productPage && siteHeader && productMain
					? rounded(
							productMain.getBoundingClientRect().top -
								siteHeader.getBoundingClientRect().bottom
					  )
					: null;
			const quantityButtons = [
				...document.querySelectorAll(
					'.lm-product-purchase .lm-quantity__button'
				),
			].filter( visible );
			const quantityTargetSizes = quantityButtons.map( ( button ) => {
				const bounds = button.getBoundingClientRect();
				return {
					width: rounded( bounds.width ),
					height: rounded( bounds.height ),
				};
			} );
			const quantityInput = document.querySelector(
				'.lm-product-purchase .wp-block-add-to-cart-form form.cart .quantity .qty'
			);
			const quantityInputStyle = quantityInput
				? window.getComputedStyle( quantityInput )
				: null;
			const styleNumber = ( selector, property ) => {
				const element = document.querySelector( selector );
				return element
					? Number.parseFloat(
							window.getComputedStyle( element )[ property ]
					  )
					: 0;
			};
			const productSpacing = productPage
				? {
						productStartGap,
						layoutMarginStart: styleNumber(
							'.lm-product-layout',
							'marginBlockStart'
						),
						variationMarginBottom: styleNumber(
							'.lm-product-purchase .woocommerce-variation',
							'marginBottom'
						),
						reviewToggleMarginStart: styleNumber(
							'.lm-product-reviews-summary > .lm-product-reviews-toggle',
							'marginBlockStart'
						),
						relatedTemplateMarginStart: styleNumber(
							'.lm-related-products > .wc-block-product-template',
							'marginBlockStart'
						),
						reviewContentMarginStart: styleNumber(
							'.lm-product-review__body > .wp-block-woocommerce-product-review-content',
							'marginBlockStart'
						),
						quantityInputMarginRight: Number.parseFloat(
							quantityInputStyle?.marginRight || '0'
						),
						quantityTargets: quantityTargetSizes,
						quantityTargetsValid:
							quantityTargetSizes.length > 0 &&
							quantityTargetSizes.every(
								( size ) =>
									size.width >= 44 && size.height >= 44
							),
						quantityInputMarginValid:
							! quantityInput ||
							Math.abs(
								Number.parseFloat(
									quantityInputStyle.marginRight
								)
							) <= 0.1,
				  }
				: null;

			return {
				title: document.title,
				cls: +( window.__lmCLS || 0 ).toFixed( 4 ),
				compactSpacing: {
					values: spacingTokenValues,
					valid: compactSpacingValid,
				},
				overflow: Math.max(
					0,
					document.documentElement.scrollWidth - window.innerWidth
				),
				brokenImages,
				missingImageAlt: images
					.filter( ( image ) => ! image.hasAttribute( 'alt' ) )
					.map( ( image ) => image.currentSrc || image.src ),
				unnamedControls: controls
					.filter( ( element ) => ! hasAccessibleName( element ) )
					.map( ( element ) => element.outerHTML.slice( 0, 180 ) ),
				criticalSmallTargets: criticalTargets.map( ( element ) => {
					const bounds = element.getBoundingClientRect();
					return {
						label:
							element.getAttribute( 'aria-label' ) ||
							element.textContent?.trim(),
						width: +bounds.width.toFixed( 1 ),
						height: +bounds.height.toFixed( 1 ),
					};
				} ),
				missingLanguage: ! document.documentElement.lang,
				mainLandmarks: document.querySelectorAll( 'main' ).length,
				missingH1: ! document.querySelector( 'h1' ),
				headingLevelJumps,
				homeLayout: {
					featuredProductCount: featuredCards.length,
					featuredButtonSpread: +featuredButtonSpread.toFixed( 2 ),
					productActionCount: productActions.length,
					productActionLabelsValid: productActions.every(
						( action ) => action.labelValid
					),
					productActionsPresentationValid:
						window.innerWidth <= 782
							? productActions.every(
									( action ) => action.hidden
							  )
							: productActions.every(
									( action ) =>
										! action.hidden &&
										action.overlaysMedia &&
										action.width >= 43.5 &&
										action.height >= 43.5
							  ),
					heroAssetCorrect: heroImage
						? heroImageSource.includes(
								window.innerWidth <= 782
									? 'hero-mobile.jpg'
									: 'hero-desktop.jpg'
						  )
						: false,
				},
				productMedia: {
					count: productMediaItems.length,
					consistentSurface:
						productMediaItems.length === 0 ||
						productMediaItems.every(
							( item ) =>
								item.frameBackground ===
									productMediaItems[ 0 ].frameBackground &&
								item.frameBorder ===
									productMediaItems[ 0 ].frameBorder &&
								item.frameRadius ===
									productMediaItems[ 0 ].frameRadius
						),
					compositionValid: productMediaItems.every(
						( item ) =>
							item.square &&
							item.objectFit === 'contain' &&
							item.imageSizingNative &&
							item.framePadding === '8px' &&
							item.frameRadius === '16px' &&
							item.imageRadius === '8px' &&
							item.imageTransitionDuration === '0.5s' &&
							item.imageTransitionProperty === 'transform' &&
							item.wrapperOverflow === 'visible'
					),
				},
				productRails: {
					aligned: productRailsAligned,
					spread: rounded( productRailSpread ),
					edges: productRails,
					shellContentEdges: overviewShellContentEdges,
				},
				productSpacing,
				uiScale: {
					body: fontSize( 'body' ),
					navigationChevronGap: rounded( navigationChevronGap ),
					navigation: fontSize(
						'.lm-site-header .wp-block-navigation-item__content'
					),
					heroTitle: fontSize( '.lm-hero h1' ),
					featuredTitle: fontSize( '.lm-featured-heading h2' ),
					pageTitle: fontSize(
						'.lm-page-intro h1, .lm-commerce-heading h1'
					),
					singleProductTitle: fontSize( '.lm-product-summary h1' ),
					maximumProductTitle: maximumFontSize(
						'.wc-block-product .wp-block-post-title'
					),
					maximumProductPrice: maximumFontSize(
						'.wc-block-product .wp-block-woocommerce-product-price'
					),
					controls: {
						account: dimensions(
							'.lm-site-header .wc-block-customer-account__link, .lm-site-header .wc-block-customer-account__toggle'
						),
						cart: dimensions(
							'.lm-site-header .wc-block-mini-cart__button'
						),
					},
					glyphs: {
						account: dimensions(
							'.lm-site-header .wc-block-customer-account__account-icon'
						),
						cart: dimensions(
							'.lm-site-header .wc-block-mini-cart__icon'
						),
						chevron: dimensions(
							'.lm-site-header .wp-block-navigation__submenu-icon svg'
						),
					},
				},
				legacyMotionHooks: document.querySelectorAll(
					'[data-lm-reveal], [data-lm-stagger], [data-lm-gallery]'
				).length,
				themeScriptInitialized:
					document.documentElement.classList.contains(
						'lm-interactions-ready'
					),
				themeScriptTagPresent: Boolean(
					document.querySelector(
						'script[src*="/themes/lupita-marquez/build/index.js"]'
					)
				),
				footerGap: +footerGap.toFixed( 2 ),
				unexpectedLongPageFooterGap:
					document.documentElement.scrollHeight >
						window.innerHeight + 1 && footerGap > 1,
				smallTargets: controls
					.map( ( element ) => ( {
						element,
						bounds: element.getBoundingClientRect(),
					} ) )
					.filter(
						( { bounds } ) =>
							bounds.width < 44 || bounds.height < 44
					)
					.slice( 0, 30 )
					.map( ( { element, bounds } ) => ( {
						label: (
							element.getAttribute( 'aria-label' ) ||
							element.textContent ||
							element.tagName
						)
							.trim()
							.slice( 0, 80 ),
						width: +bounds.width.toFixed( 1 ),
						height: +bounds.height.toFixed( 1 ),
					} ) ),
				wideBands: wide,
				shells,
				shellEdges,
				shellContentEdges,
				shellEdgeSpread: +shellEdgeSpread.toFixed( 2 ),
				runtimeGeneratedClasses,
				wideEdges: wide.length
					? {
							minLeft: Math.min(
								...wide.map( ( item ) => item.left )
							),
							maxLeft: Math.max(
								...wide.map( ( item ) => item.left )
							),
							minRight: Math.min(
								...wide.map( ( item ) => item.right )
							),
							maxRight: Math.max(
								...wide.map( ( item ) => item.right )
							),
					  }
					: null,
			};
		} );
		if (
			width === 1280 &&
			[ 'inicio', 'tienda', 'producto-variable' ].includes( name )
		) {
			const productCardSelectors = {
				inicio: '.lm-featured-collection .wc-block-product',
				'producto-variable': '.lm-related-products .wc-block-product',
				tienda: '.wc-block-product',
			};
			const cardSelector = productCardSelectors[ name ];
			const card = page.locator( cardSelector ).first();
			if ( await card.count() ) {
				await card.scrollIntoViewIfNeeded();
				const readProductMedia = () =>
					card.evaluate( ( productCard ) => {
						const frame = productCard.querySelector(
							'.wc-block-components-product-image > a, .wp-block-woocommerce-product-image > a'
						);
						const productImage = frame.querySelector( 'img' );
						const frameBounds = frame.getBoundingClientRect();
						const frameStyle = window.getComputedStyle( frame );
						const imageStyle =
							window.getComputedStyle( productImage );
						return {
							frame: {
								background: frameStyle.backgroundColor,
								border: frameStyle.border,
								height: frameBounds.height,
								shadow: frameStyle.boxShadow,
								width: frameBounds.width,
								x: frameBounds.x,
								y: frameBounds.y,
							},
							imageTransform: imageStyle.transform,
						};
					} );
				const mediaAtRest = await readProductMedia();
				await card.hover();
				await page.waitForTimeout( 600 );
				const mediaOnHover = await readProductMedia();
				await page.mouse.move( width - 4, 400 );
				await page.waitForTimeout( 600 );
				const mediaAfterHover = await readProductMedia();
				const frameStable = Object.keys( mediaAtRest.frame ).every(
					( property ) =>
						mediaAtRest.frame[ property ] ===
						mediaOnHover.frame[ property ]
				);
				productMediaAudit = {
					frameStable,
					imageReturned: mediaAfterHover.imageTransform === 'none',
					imageScaled:
						mediaOnHover.imageTransform.startsWith(
							'matrix(1.015'
						) && mediaOnHover.imageTransform.endsWith( ', 0, 0)' ),
				};
			}
		}
		if ( name.startsWith( 'producto-' ) ) {
			const gallery = page.locator(
				'.lm-product-gallery .woocommerce-product-gallery'
			);
			if ( await gallery.count() ) {
				singleProductGalleryAudit = await gallery.evaluate(
					( element ) => {
						const stage =
							element.querySelector( '.flex-viewport' ) ||
							element.querySelector(
								'.woocommerce-product-gallery__wrapper'
							);
						const thumbs = element.querySelector(
							'.flex-control-thumbs'
						);
						const image = element.querySelector(
							'.woocommerce-product-gallery__image img'
						);
						const imageLink = image?.closest( 'a' );
						const trigger = element.querySelector(
							'.woocommerce-product-gallery__trigger'
						);
						const stageBounds = stage?.getBoundingClientRect();
						const thumbsBounds = thumbs?.getBoundingClientRect();
						const triggerBounds = trigger?.getBoundingClientRect();
						const desktop = window.innerWidth > 960;
						return {
							present: Boolean(
								stage && thumbs && image && trigger
							),
							imageContained:
								window.getComputedStyle( image ).objectFit ===
								'contain',
							lightboxSourcePreserved:
								Boolean(
									imageLink?.href && image.dataset.large_image
								) &&
								new URL( imageLink.href ).pathname ===
									new URL( image.dataset.large_image )
										.pathname,
							stageAspect:
								stageBounds?.height > 0
									? stageBounds.width / stageBounds.height
									: 0,
							thumbnailPlacement:
								Boolean( stageBounds && thumbsBounds ) &&
								( desktop
									? thumbsBounds.right <= stageBounds.left + 1
									: thumbsBounds.top >=
									  stageBounds.bottom - 1 ),
							triggerTarget:
								Boolean( triggerBounds ) &&
								triggerBounds.width >= 43.5 &&
								triggerBounds.height >= 43.5,
						};
					}
				);
			}
		}
		if ( name === 'inicio' ) {
			const header = page.locator( '.lm-site-header' );
			const headerIsVisible = () =>
				header.evaluate( ( element ) => {
					const bounds = element.getBoundingClientRect();
					return bounds.bottom > 0 && bounds.top < window.innerHeight;
				} );
			await page.evaluate( () => window.scrollTo( 0, 0 ) );
			await page.waitForTimeout( 350 );
			const initialVisible = await headerIsVisible();
			await page.evaluate( () => window.scrollTo( 0, 600 ) );
			await page.waitForTimeout( 100 );
			const scrolledState = await header.evaluate( ( element ) => ( {
				headerStayedVisible: element.getBoundingClientRect().bottom > 0,
				headerPinnedToTop:
					Math.abs( element.getBoundingClientRect().top ) <= 1,
				topbarOutsideViewport:
					element.ownerDocument
						.querySelector( '.lm-topbar' )
						?.getBoundingClientRect().bottom <= 0,
			} ) );
			await page.evaluate( () => window.scrollTo( 0, 0 ) );
			await page.waitForTimeout( 100 );
			stickyHeaderAudit = {
				initialVisible,
				...scrolledState,
			};
			interactionAudit = {
				accountIconVisible: await page
					.locator(
						'.lm-site-header .wc-block-customer-account__link, .lm-site-header .wc-block-customer-account__toggle'
					)
					.first()
					.isVisible(),
				accountTextLinkCount: await page
					.locator( '.lm-site-header .lm-nav-account-link' )
					.count(),
				desktop: null,
				headerSearchCount: await page
					.locator( '.lm-site-header .lm-header-search' )
					.count(),
			};

			if ( width <= 960 ) {
				const mobileMenuToggle = page.locator(
					'.lm-mobile-menu-toggle'
				);
				await mobileMenuToggle.click();
				await page.waitForTimeout( 350 );
				mobileNavigationAudit = await page.evaluate( () => {
					const headerElement =
						document.querySelector( '.lm-site-header' );
					const toggle = document.querySelector(
						'.lm-mobile-menu-toggle'
					);
					const brand = document.querySelector( '.lm-brand' );
					const drawer =
						document.querySelector( '.lm-mobile-drawer' );
					const backdrop = document.querySelector(
						'.lm-mobile-menu-backdrop'
					);
					const navigation = drawer?.querySelector(
						'.lm-mobile-drawer__navigation'
					);
					const visible = ( element ) => {
						if ( ! element ) {
							return false;
						}
						const rect = element.getBoundingClientRect();
						const style = window.getComputedStyle( element );
						return (
							style.display !== 'none' &&
							style.visibility !== 'hidden' &&
							rect.width > 0 &&
							rect.height > 0
						);
					};
					const links = navigation
						? [
								...navigation.querySelectorAll( 'a[href]' ),
						  ].filter( visible )
						: [];
					const bounds = ( element ) =>
						element?.getBoundingClientRect();
					const headerBounds = bounds( headerElement );
					const brandBounds = bounds( brand );
					const drawerBounds = bounds( drawer );
					const linkBounds = links.map( bounds );
					const brandCenteredDifference = brandBounds
						? Math.abs(
								brandBounds.left +
									brandBounds.width / 2 -
									window.innerWidth / 2
						  )
						: Number.POSITIVE_INFINITY;
					const targetMinimum = linkBounds.length
						? Math.min(
								...linkBounds.map( ( item ) => item.height )
						  )
						: 0;
					const visibleDestinations = links.map( ( link ) =>
						link.textContent.trim()
					);
					const expectedDestinations = [
						'Inicio',
						'Todas las piezas',
						'Altares',
						'Otras piezas',
						'Nosotros',
						'Contacto',
					];
					const currentLinks = navigation?.querySelectorAll(
						'a[aria-current="page"]'
					);
					const backdropStyle = window.getComputedStyle( backdrop );
					const toggleLines = [
						...toggle.querySelectorAll(
							'.lm-mobile-menu-toggle__line'
						),
					];
					const lineStyles = toggleLines.map( ( line ) =>
						window.getComputedStyle( line )
					);

					return {
						backdropVisible:
							backdropStyle.visibility === 'visible' &&
							Number( backdropStyle.opacity ) > 0.95,
						brandCenteredDifference,
						drawerTopDifference: Math.abs(
							drawerBounds.top - headerBounds.bottom
						),
						drawerOverflow: Math.max(
							0,
							drawer.scrollHeight - drawer.clientHeight
						),
						drawerWidth: drawerBounds.width,
						hasNumbering: Boolean(
							navigation?.querySelector( '[data-lm-index]' )
						),
						hamburgerTransformed:
							lineStyles[ 0 ].transform !== 'none' &&
							Number( lineStyles[ 1 ].opacity ) === 0 &&
							lineStyles[ 2 ].transform !== 'none',
						passed:
							brandCenteredDifference <= 1.5 &&
							Math.abs( drawerBounds.left ) <= 0.5 &&
							drawerBounds.right < window.innerWidth &&
							drawerBounds.width <= 380.5 &&
							Math.abs(
								drawerBounds.width -
									Math.min( window.innerWidth * 0.86, 380 )
							) <= 1 &&
							Math.abs(
								drawerBounds.top - headerBounds.bottom
							) <= 1 &&
							drawer.scrollHeight - drawer.clientHeight <= 1 &&
							targetMinimum >= 57.5 &&
							visibleDestinations.join( '|' ) ===
								expectedDestinations.join( '|' ) &&
							currentLinks?.length === 1 &&
							! navigation?.querySelector( '[data-lm-index]' ) &&
							toggle.getAttribute( 'aria-expanded' ) === 'true' &&
							drawer.getAttribute( 'aria-hidden' ) === 'false' &&
							backdropStyle.visibility === 'visible' &&
							Number( backdropStyle.opacity ) > 0.95 &&
							lineStyles[ 0 ].transform !== 'none' &&
							Number( lineStyles[ 1 ].opacity ) === 0 &&
							lineStyles[ 2 ].transform !== 'none',
						targetMinimum,
						visibleDestinations,
					};
				} );
				if ( name === 'inicio' && width === 390 ) {
					await page.screenshot( {
						path: path.join(
							outputDirectory,
							'inicio-mobile-menu-390.png'
						),
					} );
				}
				await page.keyboard.press( 'Escape' );
				await page.waitForTimeout( 300 );
				mobileNavigationAudit.closedWithEscape =
					( await mobileMenuToggle.getAttribute(
						'aria-expanded'
					) ) === 'false' &&
					( await mobileMenuToggle.evaluate(
						( element ) =>
							element === element.ownerDocument.activeElement
					) );
				mobileNavigationAudit.passed =
					mobileNavigationAudit.passed &&
					mobileNavigationAudit.closedWithEscape;
				await mobileMenuToggle.click();
				await page.waitForTimeout( 50 );
				await page.locator( '.lm-mobile-menu-backdrop' ).click( {
					position: { x: width - 8, y: 20 },
				} );
				await page.waitForTimeout( 300 );
				mobileNavigationAudit.closedWithBackdrop =
					( await mobileMenuToggle.getAttribute(
						'aria-expanded'
					) ) === 'false';
				mobileNavigationAudit.passed =
					mobileNavigationAudit.passed &&
					mobileNavigationAudit.closedWithBackdrop;

				await page.evaluate( () => window.scrollTo( 0, 600 ) );
				await page.waitForTimeout( 100 );
				const scrollBeforeScrolledOpen = await page.evaluate(
					() => window.scrollY
				);
				await mobileMenuToggle.click();
				await page.waitForTimeout( 350 );
				mobileNavigationAudit.scrolledOpenStable = await page.evaluate(
					( expectedScroll ) => {
						const headerBounds = document
							.querySelector( '.lm-site-header' )
							.getBoundingClientRect();
						const drawerBounds = document
							.querySelector( '.lm-mobile-drawer' )
							.getBoundingClientRect();
						const bodyStyle = window.getComputedStyle(
							document.body
						);
						return (
							Math.abs( headerBounds.top ) <= 1 &&
							Math.abs(
								drawerBounds.top - headerBounds.bottom
							) <= 1 &&
							bodyStyle.position === 'fixed' &&
							Math.abs(
								Number.parseFloat( bodyStyle.top ) +
									expectedScroll
							) <= 1
						);
					},
					scrollBeforeScrolledOpen
				);
				await page.keyboard.press( 'Escape' );
				await page.waitForTimeout( 300 );
				mobileNavigationAudit.scrollPositionRestored =
					await page.evaluate(
						( expectedScroll ) =>
							Math.abs( window.scrollY - expectedScroll ) <= 1 &&
							Math.abs(
								document
									.querySelector( '.lm-site-header' )
									.getBoundingClientRect().top
							) <= 1,
						scrollBeforeScrolledOpen
					);
				mobileNavigationAudit.passed =
					mobileNavigationAudit.passed &&
					mobileNavigationAudit.scrolledOpenStable &&
					mobileNavigationAudit.scrollPositionRestored;
				await page.evaluate( () => window.scrollTo( 0, 0 ) );
				await page.waitForTimeout( 100 );

				if ( name === 'inicio' && width === 390 ) {
					await mobileMenuToggle.click();
					await page
						.locator(
							'.lm-site-header .wc-block-mini-cart__button'
						)
						.click();
					await page.waitForTimeout( 500 );
					mobileNavigationAudit.cartReplacedMenu =
						( await mobileMenuToggle.getAttribute(
							'aria-expanded'
						) ) === 'false' &&
						( await page
							.locator(
								'.wc-block-components-drawer__screen-overlay.is-open, .wc-block-components-drawer__screen-overlay--with-slide-in'
							)
							.count() ) > 0;
					mobileNavigationAudit.passed =
						mobileNavigationAudit.passed &&
						mobileNavigationAudit.cartReplacedMenu;
					await page.keyboard.press( 'Escape' );
					await page.waitForTimeout( 300 );

					await page.setViewportSize( { width: 390, height: 560 } );
					await mobileMenuToggle.click();
					await page.waitForTimeout( 350 );
					mobileNavigationAudit.compactViewportScrollable =
						await page.evaluate( () => {
							const drawer =
								document.querySelector( '.lm-mobile-drawer' );
							const overflow =
								drawer.scrollHeight - drawer.clientHeight;
							if ( overflow <= 1 ) {
								return true;
							}
							drawer.scrollTop = Math.min( 40, overflow );
							const drawerStyle =
								window.getComputedStyle( drawer );
							return (
								drawerStyle.overflowY === 'auto' &&
								drawer.scrollTop > 0
							);
						} );
					mobileNavigationAudit.passed =
						mobileNavigationAudit.passed &&
						mobileNavigationAudit.compactViewportScrollable;
					await page.keyboard.press( 'Escape' );
					await page.setViewportSize( { width: 390, height: 900 } );
					await page.waitForTimeout( 300 );
				}
			}

			if ( width === 1280 ) {
				const readMotion = ( locator ) =>
					locator.evaluate( ( element ) => {
						const style = window.getComputedStyle( element );
						return {
							boxShadow: style.boxShadow,
							opacity: Number.parseFloat( style.opacity ),
							transform: style.transform,
							visibility: style.visibility,
						};
					} );
				const submenuToggle = page
					.locator(
						'.lm-site-header .wp-block-navigation__submenu-icon'
					)
					.first();
				const submenu = page
					.locator(
						'.lm-site-header .wp-block-navigation__submenu-container'
					)
					.first();
				const chevron = submenuToggle.locator( 'svg' );

				await page.evaluate( () => window.scrollTo( 0, 0 ) );
				await submenuToggle.hover();
				await page.waitForTimeout( 280 );
				const submenuOpen = await readMotion( submenu );
				const chevronOpen = await readMotion( chevron );
				const expandedAfterHover =
					( await submenuToggle.getAttribute( 'aria-expanded' ) ) ===
					'true';
				await page.screenshot( {
					path: path.join(
						outputDirectory,
						'inicio-dropdown-1280.png'
					),
				} );
				await page.mouse.move( width - 4, 400 );
				await page.waitForTimeout( 280 );
				const submenuClosed = await readMotion( submenu );

				const heroCta = page.locator( '.lm-hero__copy a' ).first();
				await heroCta.hover();
				await page.waitForTimeout( 280 );
				const heroHover = await readMotion( heroCta );

				const featuredCard = page
					.locator( '.lm-featured-collection .wc-block-product' )
					.first();
				await featuredCard.scrollIntoViewIfNeeded();
				await page.evaluate( () => window.scrollBy( 0, -120 ) );
				await page.mouse.move( width - 4, 400 );
				const productAction = featuredCard.locator(
					'.wp-block-woocommerce-product-button'
				);
				const productControl =
					productAction.locator( '.wp-element-button' );
				const cardBoundsBefore = await featuredCard.boundingBox();
				const actionAtRest = await readMotion( productAction );
				await featuredCard.hover();
				await page.waitForTimeout( 300 );
				const cardHover = await readMotion( featuredCard );
				const actionOnHover = await readMotion( productAction );
				const cardBoundsAfter = await featuredCard.boundingBox();
				await page.screenshot( {
					path: path.join(
						outputDirectory,
						'inicio-product-hover-1280.png'
					),
				} );
				await page.mouse.move( width - 4, 400 );
				await productControl.focus();
				await page.waitForTimeout( 300 );
				const actionOnFocus = await readMotion( productAction );

				const socialMark = page
					.locator( '.lm-footer-social a svg' )
					.first();
				await socialMark.scrollIntoViewIfNeeded();
				await socialMark.hover();
				await page.waitForTimeout( 280 );
				const socialHover = await readMotion( socialMark );

				interactionAudit.desktop = {
					cardStable:
						cardHover.transform === 'none' &&
						cardHover.boxShadow === 'none' &&
						Math.abs(
							cardBoundsBefore.height - cardBoundsAfter.height
						) <= 0.5 &&
						Math.abs(
							cardBoundsBefore.width - cardBoundsAfter.width
						) <= 0.5,
					productActionConcealed:
						actionAtRest.opacity === 0 &&
						actionAtRest.transform !== 'none',
					productActionFocusRevealed: actionOnFocus.opacity === 1,
					productActionHoverRevealed: actionOnHover.opacity === 1,
					chevronRotated: chevronOpen.transform !== 'none',
					expandedAfterHover,
					heroRaised:
						heroHover.transform !== 'none' &&
						heroHover.boxShadow !== 'none',
					socialRaised:
						socialHover.transform !== 'none' &&
						socialHover.boxShadow !== 'none',
					submenuClosed:
						submenuClosed.opacity === 0 &&
						submenuClosed.visibility === 'hidden',
					submenuOpened:
						submenuOpen.opacity === 1 &&
						submenuOpen.visibility === 'visible',
				};
				await page.evaluate( () => window.scrollTo( 0, 0 ) );
				await page.mouse.move( width - 4, 400 );
				await page.waitForTimeout( 280 );
			}
		}
		const requiredSelector = requiredContent[ name ];
		const requiredContentMissing = requiredSelector
			? ! ( await page.locator( requiredSelector ).first().isVisible() )
			: false;
		const pagePurposeAudit = await page.evaluate( ( pageName ) => {
			const informationalPages = new Set( [
				'nosotros',
				'contacto',
				'preguntas-frecuentes',
				'envios-devoluciones',
				'aviso-privacidad',
				'terminos',
			] );
			const trustStripAbsent =
				! document.querySelector( '.lm-trust-strip' );
			if ( pageName === 'producto-variable' ) {
				const assuranceLabels = [
					...document.querySelectorAll(
						'.lm-product-assurance span'
					),
				].map( ( item ) => item.textContent.trim() );
				return {
					assuranceLabels,
					passed:
						trustStripAbsent &&
						[
							'Hecho en México',
							'Envíos seguros',
							'Compra segura',
						].every( ( label ) =>
							assuranceLabels.includes( label )
						),
					trustStripAbsent,
				};
			}
			if ( ! informationalPages.has( pageName ) ) {
				return null;
			}
			const contextualLinks = [
				...document.querySelectorAll(
					'.lm-contextual-actions a, .lm-legal-help a, .lm-about-cta__inner a'
				),
			].map( ( link ) => link.getAttribute( 'href' ) || '' );
			const expectedLinks = {
				nosotros: [ '/tienda/' ],
				contacto: [],
				'preguntas-frecuentes': [ '/contacto/' ],
				'envios-devoluciones': [
					'/preguntas-frecuentes/',
					'/contacto/',
				],
				'aviso-privacidad': [],
				terminos: [],
			}[ pageName ];
			return {
				contextualLinks,
				passed:
					trustStripAbsent &&
					expectedLinks.every( ( link ) =>
						contextualLinks.includes( link )
					),
				trustStripAbsent,
			};
		}, name );
		if ( name === 'carrito-lleno' || name === 'checkout' ) {
			await waitForCommerceBlock(
				page,
				name === 'carrito-lleno'
					? '.wp-block-woocommerce-cart'
					: '.wc-block-checkout',
				requiredSelector
			);
			await page.waitForTimeout( 350 );
		}
		formAudit = await auditFormPresentation( page );
		for ( const action of actionAuditSelectors[ name ] || [] ) {
			actionAudit.push( await auditActionPresentation( page, action ) );
		}

		await page.screenshot( {
			path: path.join( outputDirectory, `${ name }-${ width }.png` ),
			fullPage: true,
		} );
		report.pages.push( {
			name,
			pathname,
			width,
			status: response?.status() ?? null,
			console: messages,
			pageErrors,
			pagePurposeAudit,
			actionAudit,
			formAudit,
			requiredContentMissing,
			interactionAudit,
			mobileNavigationAudit,
			productMediaAudit,
			singleProductGalleryAudit,
			stickyHeaderAudit,
			variationAudit,
			...metrics,
		} );
		await page.close();
	}

	await context.close();
}

report.productDetails = [];
report.productReviews = [];
for ( const width of [ 1280, 390 ] ) {
	const context = await browser.newContext( {
		viewport: { width, height: 1100 },
	} );
	const page = await context.newPage();
	await page.goto( new URL( '/producto/altar-chico/', baseURL ).href, {
		waitUntil: 'networkidle',
		timeout: 45_000,
	} );
	const section = page.locator( '.lm-product-details-section' );
	await section.scrollIntoViewIfNeeded();
	const presentation = await section.evaluate( ( root ) => {
		const description = root.querySelector(
			'.lm-product-description-content'
		);
		const descriptionStyle = description
			? window.getComputedStyle( description )
			: null;
		const specs = description?.querySelector( '.lm-product-specs' );
		const specLabels = specs
			? [
					...specs.querySelectorAll(
						':scope > .lm-product-spec > dt'
					),
			  ].map( ( label ) => label.textContent.trim() )
			: [];
		const reviewsSection = document.querySelector(
			'.lm-product-reviews-section'
		);
		const overviewSection = document.querySelector(
			'.lm-product-overview'
		);
		const relatedSection = document.querySelector( '.lm-related-section' );
		const sectionStyle = window.getComputedStyle( root );
		const overviewStyle = overviewSection
			? window.getComputedStyle( overviewSection )
			: null;
		const reviewsStyle = reviewsSection
			? window.getComputedStyle( reviewsSection )
			: null;
		const relatedStyle = relatedSection
			? window.getComputedStyle( relatedSection )
			: null;
		let descriptionDividers = 0;
		if ( description ) {
			for ( const paragraph of description.querySelectorAll(
				':scope > p:not(:first-child)'
			) ) {
				if (
					Number.parseFloat(
						window.getComputedStyle( paragraph ).borderTopWidth
					) > 0
				) {
					descriptionDividers += 1;
				}
			}
		}
		const railSelectors = [
			'.lm-product-details-heading',
			'.lm-product-description',
			'.lm-product-reviews-heading',
			'.lm-product-reviews-content',
			'.lm-related-products',
		];
		const rails = railSelectors.map( ( selector ) => {
			const element = document.querySelector( selector );
			if ( ! element ) {
				return null;
			}
			const bounds = element.getBoundingClientRect();
			return {
				left: Math.round( bounds.left ),
				right: Math.round( bounds.right ),
				width: Math.round( bounds.width ),
			};
		} );
		const firstRail = rails[ 0 ];
		const railsAligned = Boolean(
			firstRail &&
				rails.every(
					( rail ) =>
						rail &&
						Math.abs( rail.left - firstRail.left ) <= 1 &&
						Math.abs( rail.right - firstRail.right ) <= 1
				)
		);
		return {
			descriptionParagraphs:
				description?.querySelectorAll( ':scope > p' ).length || 0,
			descriptionSpecCount:
				specs?.querySelectorAll( ':scope > .lm-product-spec' ).length ||
				0,
			descriptionSpecLabels: specLabels,
			descriptionHeadingCount:
				description?.querySelectorAll(
					':scope > h1, :scope > h2, :scope > h3'
				).length || 0,
			descriptionDividers,
			descriptionAccordionCount:
				description?.querySelectorAll( 'details, [role="button"]' )
					.length || 0,
			heading:
				root
					.querySelector( '.lm-product-details-heading h2' )
					?.textContent.trim() || '',
			overflow: root.scrollWidth - root.clientWidth,
			sectionBorders: [
				Number.parseFloat( sectionStyle.borderTopWidth ),
				Number.parseFloat( sectionStyle.borderBottomWidth ),
			],
			sectionShadow: window.getComputedStyle( root ).boxShadow,
			surfaceBackground: sectionStyle.backgroundColor,
			overviewSurfaceBackground: overviewStyle?.backgroundColor || '',
			relatedSurfaceBackground: relatedStyle?.backgroundColor || '',
			reviewsSurfaceBackground: reviewsStyle?.backgroundColor || '',
			verticalDivider: Number.parseFloat(
				descriptionStyle?.borderLeftWidth || '0'
			),
			tabCount: root.querySelectorAll( '[role="tab"], .woocommerce-tabs' )
				.length,
			rails,
			railsAligned,
		};
	} );
	await section.screenshot( {
		path: path.join( outputDirectory, `producto-detalles-${ width }.png` ),
	} );
	report.productDetails.push( {
		passed: Boolean(
			presentation.heading === 'Detalles del producto' &&
				presentation.tabCount === 0 &&
				presentation.descriptionParagraphs >= 1 &&
				presentation.descriptionSpecCount === 1 &&
				[ 'Medidas aproximadas' ].every( ( label ) =>
					presentation.descriptionSpecLabels.includes( label )
				) &&
				! presentation.descriptionSpecLabels.includes( 'Cuidados' ) &&
				! presentation.descriptionSpecLabels.includes(
					'Disponibilidad'
				) &&
				presentation.descriptionHeadingCount === 0 &&
				presentation.descriptionDividers === 0 &&
				presentation.descriptionAccordionCount === 0 &&
				presentation.overflow <= 1 &&
				presentation.sectionBorders.every(
					( border ) => border === 0
				) &&
				presentation.sectionShadow === 'none' &&
				presentation.surfaceBackground ===
					presentation.overviewSurfaceBackground &&
				presentation.surfaceBackground ===
					presentation.reviewsSurfaceBackground &&
				presentation.surfaceBackground ===
					presentation.relatedSurfaceBackground &&
				presentation.verticalDivider === 0 &&
				presentation.railsAligned
		),
		presentation,
		width,
	} );

	const reviewsSection = page.locator( '.lm-product-reviews-section' );
	await reviewsSection.scrollIntoViewIfNeeded();
	const closedReviews = await reviewsSection.evaluate( ( root ) => {
		const button = root.querySelector( '[data-lm-review-form-toggle]' );
		const form = root.querySelector( '[id="review_form_wrapper"]' );
		const surfaceStyle = window.getComputedStyle( root );
		const contentStyle = window.getComputedStyle(
			root.querySelector( '.lm-product-reviews-content' )
		);
		const headingStyle = window.getComputedStyle(
			root.querySelector( '.lm-product-reviews-heading' )
		);
		return {
			buttonHidden: button?.hidden ?? true,
			buttonLabel: button?.textContent.trim() || '',
			expanded: button?.getAttribute( 'aria-expanded' ) || '',
			formHidden: form?.hidden ?? false,
			heading:
				root
					.querySelector( '.lm-product-reviews-heading h2' )
					?.textContent.trim() || '',
			overflow: root.scrollWidth - root.clientWidth,
			sectionBorders: [
				Number.parseFloat( surfaceStyle.borderTopWidth ),
				Number.parseFloat( surfaceStyle.borderBottomWidth ),
			],
			ratingSummary: Boolean(
				root.querySelector(
					'.lm-product-reviews-summary .wc-block-components-product-rating__stars'
				)
			),
			shadow: surfaceStyle.boxShadow,
			headingBorderBottom: Number.parseFloat(
				headingStyle.borderBottomWidth
			),
			verticalDivider: Number.parseFloat( contentStyle.borderLeftWidth ),
			title:
				root
					.querySelector(
						'.wp-block-woocommerce-product-reviews-title'
					)
					?.textContent.trim() || '',
		};
	} );
	await reviewsSection.screenshot( {
		path: path.join(
			outputDirectory,
			`producto-valoraciones-cerrado-${ width }.png`
		),
	} );
	const reviewToggle = reviewsSection.locator(
		'[data-lm-review-form-toggle]'
	);
	await reviewToggle.click();
	await page.waitForTimeout( 60 );
	const reviewTransition = await reviewsSection
		.locator( '[id="review_form_wrapper"]' )
		.evaluate( ( form ) => {
			const style = window.getComputedStyle( form );
			return {
				duration: Number.parseFloat( style.transitionDuration ),
				height: form.style.height,
				started: form.classList.contains( 'lm-is-animating' ),
			};
		} );
	await page.waitForTimeout( 380 );
	const openedReviews = await reviewsSection.evaluate( ( root ) => {
		const bounds = ( selector ) =>
			root.querySelector( selector )?.getBoundingClientRect();
		const author = bounds( '.comment-form-author' );
		const button = root.querySelector( '[data-lm-review-form-toggle]' );
		const email = bounds( '.comment-form-email' );
		const form = root.querySelector( '[id="review_form_wrapper"]' );
		const stars = [
			...root.querySelectorAll( '.comment-form-rating .stars button' ),
		];
		return {
			buttonLabel: button?.textContent.trim() || '',
			existingRatings: [
				...root.querySelectorAll(
					'.wc-block-product-review-rating__stars[aria-label]'
				),
			].map( ( rating ) => rating.getAttribute( 'aria-label' ) ),
			expanded: button?.getAttribute( 'aria-expanded' ) || '',
			formColumns:
				author && email
					? {
							aligned: Math.abs( author.top - email.top ) <= 1,
							sameColumn:
								Math.abs( author.left - email.left ) <= 1,
					  }
					: null,
			formHidden: form?.hidden ?? true,
			inlineHeight: form?.style.height || '',
			reviewCount: root.querySelectorAll(
				'.wp-block-woocommerce-product-review-template > .review'
			).length,
			starLabels: stars.map( ( star ) =>
				star.getAttribute( 'aria-label' )
			),
			starTargets: stars.map( ( star ) => {
				const starBounds = star.getBoundingClientRect();
				return {
					height: starBounds.height,
					width: starBounds.width,
				};
			} ),
		};
	} );
	const reviewFormAudit = await auditFormPresentation(
		page,
		'.lm-product-reviews-content'
	);
	await reviewsSection.screenshot( {
		path: path.join(
			outputDirectory,
			`producto-valoraciones-abierto-${ width }.png`
		),
	} );
	const fourthStar = reviewsSection
		.locator( '.comment-form-rating .stars button' )
		.nth( 3 );
	await fourthStar.click();
	await page.waitForTimeout( 50 );
	const ratingSelected = await fourthStar.getAttribute( 'aria-checked' );
	await page.keyboard.press( 'Escape' );
	await page.waitForTimeout( 380 );
	const closedAfterEscape = await reviewsSection.evaluate( ( root ) => {
		const button = root.querySelector( '[data-lm-review-form-toggle]' );
		const form = root.querySelector( '[id="review_form_wrapper"]' );
		return {
			expanded: button?.getAttribute( 'aria-expanded' ) || '',
			focusReturned: button === button?.ownerDocument.activeElement,
			formHidden: form?.hidden ?? false,
			inlineHeight: form?.style.height || '',
		};
	} );
	const reviewLinkTarget = await page
		.locator( '.lm-product-heading .woocommerce-review-link' )
		.getAttribute( 'href' );
	const reviewIds = await page.locator( '[id="reviews"]' ).count();
	const expectedStarLabels = [
		'1 estrella de 5',
		'2 estrellas de 5',
		'3 estrellas de 5',
		'4 estrellas de 5',
		'5 estrellas de 5',
	];
	report.productReviews.push( {
		closedAfterEscape,
		closedReviews,
		openedReviews,
		passed: Boolean(
			closedReviews.heading === 'Opiniones sobre esta pieza' &&
				closedReviews.title === '1 valoración' &&
				closedReviews.buttonLabel === 'Escribir una valoración' &&
				! closedReviews.buttonHidden &&
				closedReviews.expanded === 'false' &&
				closedReviews.formHidden &&
				closedReviews.overflow <= 1 &&
				closedReviews.ratingSummary &&
				closedReviews.shadow === 'none' &&
				closedReviews.sectionBorders.every(
					( border ) => border === 0
				) &&
				closedReviews.headingBorderBottom === 0 &&
				closedReviews.verticalDivider === 0 &&
				reviewTransition.started &&
				reviewTransition.duration >= 0.18 &&
				Boolean( reviewTransition.height ) &&
				openedReviews.buttonLabel === 'Cerrar formulario' &&
				openedReviews.expanded === 'true' &&
				! openedReviews.formHidden &&
				openedReviews.inlineHeight === '' &&
				openedReviews.reviewCount >= 1 &&
				openedReviews.existingRatings.some( ( label ) =>
					label.includes( '5 de 5' )
				) &&
				JSON.stringify( openedReviews.starLabels ) ===
					JSON.stringify( expectedStarLabels ) &&
				openedReviews.starTargets.every(
					( target ) => target.width >= 43.5 && target.height >= 43.5
				) &&
				reviewFormAudit.passed &&
				ratingSelected === 'true' &&
				closedAfterEscape.expanded === 'false' &&
				closedAfterEscape.formHidden &&
				closedAfterEscape.focusReturned &&
				closedAfterEscape.inlineHeight === '' &&
				reviewLinkTarget === '#reviews' &&
				reviewIds === 1 &&
				( width <= 520
					? openedReviews.formColumns?.sameColumn &&
					  ! openedReviews.formColumns?.aligned
					: openedReviews.formColumns?.aligned &&
					  ! openedReviews.formColumns?.sameColumn )
		),
		ratingSelected,
		reviewIds,
		reviewLinkTarget,
		reviewTransition,
		reviewFormAudit,
		width,
	} );
	await context.close();
}

const emptyReviewsContext = await browser.newContext( {
	viewport: { width: 390, height: 900 },
} );
const emptyReviewsPage = await emptyReviewsContext.newPage();
await emptyReviewsPage.goto(
	new URL( '/producto/altar-gigante/', baseURL ).href,
	{
		waitUntil: 'networkidle',
		timeout: 45_000,
	}
);
report.productReviewsEmpty = await emptyReviewsPage
	.locator( '.lm-product-reviews-section' )
	.evaluate( ( root ) => {
		const headingStyle = window.getComputedStyle(
			root.querySelector( '.lm-product-reviews-heading' )
		);
		return {
			buttonAvailable: ! root.querySelector(
				'[data-lm-review-form-toggle]'
			)?.hidden,
			compactHeight: root.getBoundingClientRect().height <= 240,
			formCollapsed:
				root.querySelector( '[id="review_form_wrapper"]' )?.hidden ??
				false,
			headingBorderBottom: Number.parseFloat(
				headingStyle.borderBottomWidth
			),
			reviewCount: root.querySelectorAll(
				'.wp-block-woocommerce-product-review-template > .review'
			).length,
			title:
				root
					.querySelector(
						'.wp-block-woocommerce-product-reviews-title'
					)
					?.textContent.trim() || '',
		};
	} );
report.productReviewsEmpty.passed = Boolean(
	report.productReviewsEmpty.title === 'Aún no hay valoraciones' &&
		report.productReviewsEmpty.reviewCount === 0 &&
		report.productReviewsEmpty.buttonAvailable &&
		report.productReviewsEmpty.formCollapsed &&
		report.productReviewsEmpty.compactHeight &&
		report.productReviewsEmpty.headingBorderBottom === 0
);
await emptyReviewsContext.close();

const noScriptReviewsContext = await browser.newContext( {
	javaScriptEnabled: false,
	viewport: { width: 390, height: 900 },
} );
const noScriptReviewsPage = await noScriptReviewsContext.newPage();
await noScriptReviewsPage.goto(
	new URL( '/producto/altar-chico/', baseURL ).href,
	{ waitUntil: 'networkidle', timeout: 45_000 }
);
report.productReviewsWithoutJavaScript = await noScriptReviewsPage
	.locator( '.lm-product-reviews-section' )
	.evaluate( ( root ) => ( {
		buttonHidden:
			root.querySelector( '[data-lm-review-form-toggle]' )?.hidden ??
			false,
		formVisible: Boolean(
			root.querySelector( '[id="review_form_wrapper"]' )?.getClientRects()
				.length
		),
	} ) );
report.productReviewsWithoutJavaScript.passed = Boolean(
	report.productReviewsWithoutJavaScript.buttonHidden &&
		report.productReviewsWithoutJavaScript.formVisible
);
await noScriptReviewsContext.close();

const reducedMotionContext = await browser.newContext( {
	viewport: { width: 1280, height: 900 },
	reducedMotion: 'reduce',
} );
const reducedMotionPage = await reducedMotionContext.newPage();
await reducedMotionPage.goto( new URL( '/', baseURL ).href, {
	waitUntil: 'networkidle',
	timeout: 45_000,
} );
const reducedMotionSamples = {};
const readReducedMotion = async ( name, locator ) => {
	const style = await locator.evaluate( ( element ) => {
		const computed = window.getComputedStyle( element );
		return {
			animationDuration: computed.animationDuration,
			transform: computed.transform,
			transitionDuration: computed.transitionDuration,
		};
	} );
	reducedMotionSamples[ name ] = style;
};
const reducedHeroCta = reducedMotionPage.locator( '.lm-hero__copy a' ).first();
await reducedHeroCta.hover();
await readReducedMotion( 'heroCta', reducedHeroCta );
const reducedCard = reducedMotionPage
	.locator( '.lm-featured-collection .wc-block-product' )
	.first();
await reducedCard.scrollIntoViewIfNeeded();
await reducedCard.hover();
await readReducedMotion( 'featuredCard', reducedCard );
const reducedSocial = reducedMotionPage
	.locator( '.lm-footer-social a svg' )
	.first();
await reducedSocial.scrollIntoViewIfNeeded();
await reducedSocial.hover();
await readReducedMotion( 'socialMark', reducedSocial );
await reducedMotionPage.evaluate( () => window.scrollTo( 0, 0 ) );
const reducedSubmenuToggle = reducedMotionPage
	.locator( '.lm-site-header .wp-block-navigation__submenu-icon' )
	.first();
await reducedSubmenuToggle.hover();
await readReducedMotion( 'chevron', reducedSubmenuToggle.locator( 'svg' ) );
await reducedMotionPage.evaluate( () => window.scrollTo( 0, 600 ) );
await reducedMotionPage.waitForTimeout( 100 );
const durationIsZero = ( value ) =>
	value.split( ',' ).every( ( duration ) => duration.trim() === '0s' );
const motionDisabled = Object.values( reducedMotionSamples ).every(
	( sample ) =>
		durationIsZero( sample.animationDuration ) &&
		durationIsZero( sample.transitionDuration ) &&
		sample.transform === 'none'
);
report.reducedMotion = await reducedMotionPage.evaluate( () => ( {
	headerStayedVisible: ( () => {
		const header = document.querySelector( '.lm-site-header' );
		const bounds = header.getBoundingClientRect();
		return bounds.bottom > 0 && bounds.top < window.innerHeight;
	} )(),
} ) );
report.reducedMotion.motionDisabled = motionDisabled;
report.reducedMotion.samples = reducedMotionSamples;
await reducedMotionPage.setViewportSize( { width: 390, height: 900 } );
await reducedMotionPage.evaluate( () => window.scrollTo( 0, 0 ) );
await reducedMotionPage.locator( '.lm-mobile-menu-toggle' ).click();
report.reducedMotion.mobileMenuTransitionDisabled =
	await reducedMotionPage.evaluate( () => {
		const selectors = [
			'.lm-mobile-menu-toggle__line',
			'.lm-mobile-menu-backdrop',
			'.lm-mobile-drawer',
			'.lm-mobile-drawer__navigation a',
		];
		return selectors.every( ( selector ) => {
			const style = window.getComputedStyle(
				document.querySelector( selector )
			);
			return style.transitionDuration
				.split( ',' )
				.every( ( duration ) => duration.trim() === '0s' );
		} );
	} );
await reducedMotionPage.goto(
	new URL( '/producto/altar-chico/', baseURL ).href,
	{
		waitUntil: 'networkidle',
		timeout: 45_000,
	}
);
await reducedMotionPage
	.locator( '.lm-variation-option' )
	.filter( { hasText: 'Natural' } )
	.click();
await reducedMotionPage.waitForTimeout( 100 );
report.reducedMotion.galleryTransitionSkipped =
	await reducedMotionPage.evaluate( () => {
		const gallery = document.querySelector( '.lm-product-gallery' );
		return Boolean(
			gallery &&
				! gallery.classList.contains( 'lm-is-resizing' ) &&
				! gallery.style.height
		);
	} );
report.reducedMotion.productFeedbackTransitionDisabled =
	await reducedMotionPage.evaluate( () => {
		const feedback = document.querySelector( '[data-lm-product-feedback]' );
		const durations = feedback
			? window
					.getComputedStyle( feedback )
					.transitionDuration.split( ',' )
			: [];
		return Boolean(
			feedback &&
				durations.length &&
				durations.every( ( duration ) => duration.trim() === '0s' )
		);
	} );
await reducedMotionPage.locator( '[data-lm-review-form-toggle]' ).click();
await reducedMotionPage.waitForTimeout( 50 );
report.reducedMotion.productReviewTransitionDisabled =
	await reducedMotionPage.evaluate( () => {
		const form = document.querySelector(
			'.lm-product-reviews-content [id="review_form_wrapper"]'
		);
		return Boolean(
			form &&
				! form.hidden &&
				! form.classList.contains( 'lm-is-animating' ) &&
				! form.style.height
		);
	} );
await reducedMotionContext.close();

const noJavaScriptContext = await browser.newContext( {
	viewport: { width: 390, height: 900 },
	javaScriptEnabled: false,
} );
const noJavaScriptPage = await noJavaScriptContext.newPage();
await noJavaScriptPage.goto( new URL( '/', baseURL ).href, {
	waitUntil: 'networkidle',
	timeout: 45_000,
} );
await noJavaScriptPage.evaluate( () => window.scrollTo( 0, 600 ) );
report.withoutJavaScript = await noJavaScriptPage.evaluate( () => ( {
	headerStayedVisible:
		document.querySelector( '.lm-site-header' ).getBoundingClientRect()
			.bottom > 0,
	topbarOutsideViewport:
		document.querySelector( '.lm-topbar' ).getBoundingClientRect().bottom <=
		0,
	mainVisible: Boolean(
		document.querySelector( 'main' )?.getBoundingClientRect().height
	),
	legacyMotionHooks: document.querySelectorAll(
		'[data-lm-reveal], [data-lm-stagger], [data-lm-gallery]'
	).length,
	themeScriptInitialized: document.documentElement.classList.contains(
		'lm-interactions-ready'
	),
	themeScriptTagPresent: Boolean(
		document.querySelector(
			'script[src*="/themes/lupita-marquez/build/index.js"]'
		)
	),
	customMenuHidden:
		document.querySelector( '.lm-mobile-menu-toggle' ).getClientRects()
			.length === 0,
	nativeMenuAvailable:
		document
			.querySelector( '.wp-block-navigation__responsive-container-open' )
			.getClientRects().length > 0,
	mobileHeaderLayout: ( () => {
		const header = document.querySelector( '.lm-site-header' );
		const brand = document.querySelector( '.lm-brand' );
		const nativeToggle = document.querySelector(
			'.wp-block-navigation__responsive-container-open'
		);
		const actions = document.querySelector( '.lm-header-actions' );
		const center = ( element ) => {
			const bounds = element?.getBoundingClientRect();
			return bounds ? bounds.left + bounds.width / 2 : null;
		};
		const headerBounds = header?.getBoundingClientRect();
		return {
			actionsCenter: center( actions ),
			brandCenter: center( brand ),
			headerHeight: headerBounds?.height || 0,
			nativeToggleCenter: center( nativeToggle ),
			passed:
				Math.abs( ( center( brand ) || 0 ) - window.innerWidth / 2 ) <=
					1.5 &&
				( headerBounds?.height || 0 ) > 0 &&
				center( nativeToggle ) !== null &&
				center( actions ) !== null,
		};
	} )(),
	runtimeGeneratedClasses: {
		alignfull: document.querySelectorAll( '.alignfull' ).length,
		alignwide: document.querySelectorAll( '.alignwide' ).length,
		hasGlobalPadding: document.querySelectorAll( '.has-global-padding' )
			.length,
		wpContainer: document.querySelectorAll( '[class*="wp-container-"]' )
			.length,
		classicProduct:
			document.querySelectorAll( '.products .product' ).length,
	},
} ) );
await noJavaScriptPage.goto(
	new URL( '/producto/altar-chico/', baseURL ).href,
	{
		waitUntil: 'networkidle',
		timeout: 45_000,
	}
);
report.withoutJavaScript.productNoticeFallback =
	await noJavaScriptPage.evaluate( () => {
		const feedback = document.querySelector( '[data-lm-product-feedback]' );
		return {
			insidePurchase: Boolean(
				feedback?.closest( '.lm-product-purchase' )
			),
			present: Boolean( feedback ),
			topNoticeCount: document.querySelectorAll(
				'.lm-product-overview > .lm-shell > .wp-block-woocommerce-store-notices'
			).length,
		};
	} );
await noJavaScriptContext.close();

for ( const width of [ 1280, 390 ] ) {
	report.commerceInteractions.catalog.push(
		await runCatalogInteractionAudit( width )
	);
	report.commerceInteractions.cart.push(
		await runCartInteractionAudit( width )
	);
	report.commerceInteractions.checkout.push(
		await runCheckoutInteractionAudit( width )
	);
	report.commerceInteractions.account.push(
		await runAccountInteractionAudit( width )
	);
	report.commerceInteractions.contact.push(
		await runContactInteractionAudit( width )
	);
}

await browser.close();
await fs.writeFile(
	path.join( outputDirectory, 'report.json' ),
	`${ JSON.stringify( report, null, 2 ) }\n`
);

const outside = ( value, minimum, maximum ) =>
	typeof value === 'number' && ( value < minimum || value > maximum );
const undersized = ( dimensions ) =>
	dimensions && ( dimensions.width < 43.5 || dimensions.height < 43.5 );
const oversized = ( dimensions, maximum ) =>
	dimensions && ( dimensions.width > maximum || dimensions.height > maximum );
const hasScaleFailure = ( page ) =>
	outside( page.uiScale.body, 14.9, 16.1 ) ||
	outside( page.uiScale.maximumProductTitle, 15.9, 18.1 ) ||
	outside( page.uiScale.maximumProductPrice, 12.4, 13.6 ) ||
	outside( page.uiScale.heroTitle, 39.9, page.width <= 520 ? 48.1 : 64.1 ) ||
	outside(
		page.uiScale.featuredTitle,
		31.9,
		page.width <= 520 ? 36.1 : 42.1
	) ||
	outside( page.uiScale.pageTitle, 31.9, 44.1 ) ||
	outside( page.uiScale.singleProductTitle, 35.9, 56.1 ) ||
	outside( page.uiScale.navigationChevronGap, 23, 25 ) ||
	undersized( page.uiScale.controls.account ) ||
	undersized( page.uiScale.controls.cart ) ||
	oversized( page.uiScale.glyphs.account, 22 ) ||
	oversized( page.uiScale.glyphs.cart, 22 ) ||
	oversized( page.uiScale.glyphs.chevron, 13 );

const failures = report.pages.filter(
	( page ) =>
		( page.status >= 400 && page.name !== 'error-404' ) ||
		page.overflow > 0 ||
		! page.compactSpacing?.valid ||
		page.brokenImages.length ||
		page.pageErrors.length ||
		page.console.some( ( message ) => message.type === 'error' ) ||
		page.requiredContentMissing ||
		page.actionAudit.some( ( action ) => ! action.passed ) ||
		( page.pagePurposeAudit && ! page.pagePurposeAudit.passed ) ||
		( page.productMedia.count > 0 &&
			( ! page.productMedia.consistentSurface ||
				! page.productMedia.compositionValid ) ) ||
		( page.productMediaAudit &&
			( ! page.productMediaAudit.frameStable ||
				! page.productMediaAudit.imageScaled ||
				! page.productMediaAudit.imageReturned ) ) ||
		( [ 'producto-variable', 'producto-bajo-pedido' ].includes(
			page.name
		) &&
			( ! page.productRails?.aligned ||
				page.productRails?.spread > 1 ||
				! page.productSpacing ||
				Math.abs( page.productSpacing.productStartGap ) > 1 ||
				Math.abs( page.productSpacing.layoutMarginStart ) > 0.1 ||
				Math.abs( page.productSpacing.variationMarginBottom ) > 0.1 ||
				Math.abs( page.productSpacing.reviewToggleMarginStart ) > 0.1 ||
				Math.abs( page.productSpacing.relatedTemplateMarginStart ) >
					0.1 ||
				Math.abs( page.productSpacing.reviewContentMarginStart ) >
					0.1 ||
				! page.productSpacing.quantityTargetsValid ||
				! page.productSpacing.quantityInputMarginValid ) ) ||
		( page.singleProductGalleryAudit &&
			( ! page.singleProductGalleryAudit.present ||
				! page.singleProductGalleryAudit.imageContained ||
				! page.singleProductGalleryAudit.lightboxSourcePreserved ||
				Math.abs( page.singleProductGalleryAudit.stageAspect - 0.9 ) >
					0.03 ||
				! page.singleProductGalleryAudit.thumbnailPlacement ||
				! page.singleProductGalleryAudit.triggerTarget ) ) ||
		( page.name === 'inicio' &&
			( page.homeLayout.featuredProductCount !== 6 ||
				page.homeLayout.featuredButtonSpread > 1 ||
				page.homeLayout.productActionCount !== 6 ||
				! page.homeLayout.productActionLabelsValid ||
				! page.homeLayout.productActionsPresentationValid ||
				! page.homeLayout.heroAssetCorrect ||
				page.interactionAudit?.accountTextLinkCount !== 0 ||
				! page.interactionAudit?.accountIconVisible ||
				page.interactionAudit?.headerSearchCount !== 0 ||
				( page.width <= 960 && ! page.mobileNavigationAudit?.passed ) ||
				( page.width === 1280 &&
					( ! page.interactionAudit?.desktop?.cardStable ||
						! page.interactionAudit?.desktop
							?.productActionConcealed ||
						! page.interactionAudit?.desktop
							?.productActionFocusRevealed ||
						! page.interactionAudit?.desktop
							?.productActionHoverRevealed ||
						! page.interactionAudit?.desktop?.chevronRotated ||
						! page.interactionAudit?.desktop?.expandedAfterHover ||
						! page.interactionAudit?.desktop?.heroRaised ||
						! page.interactionAudit?.desktop?.socialRaised ||
						! page.interactionAudit?.desktop?.submenuClosed ||
						! page.interactionAudit?.desktop?.submenuOpened ) ) ||
				! page.stickyHeaderAudit?.initialVisible ||
				! page.stickyHeaderAudit?.headerStayedVisible ||
				! page.stickyHeaderAudit?.headerPinnedToTop ||
				! page.stickyHeaderAudit?.topbarOutsideViewport ) ) ||
		( page.variationAudit && ! page.variationAudit.passed ) ||
		page.missingImageAlt.length ||
		page.unnamedControls.length ||
		page.criticalSmallTargets.length ||
		! page.formAudit?.passed ||
		page.missingLanguage ||
		page.mainLandmarks !== 1 ||
		page.missingH1 ||
		page.headingLevelJumps.length ||
		hasScaleFailure( page ) ||
		page.legacyMotionHooks ||
		! page.themeScriptInitialized ||
		page.shellEdgeSpread > 1 ||
		page.unexpectedLongPageFooterGap ||
		page.cls > 0.1
);
const enhancementFailures =
	sourceMotionViolations.length > 0 ||
	sourceContractViolations.length > 0 ||
	integrationSelectorViolations.length > 0 ||
	! report.withoutJavaScript.mainVisible ||
	! report.withoutJavaScript.headerStayedVisible ||
	! report.withoutJavaScript.topbarOutsideViewport ||
	! report.withoutJavaScript.customMenuHidden ||
	! report.withoutJavaScript.nativeMenuAvailable ||
	! report.withoutJavaScript.mobileHeaderLayout.passed ||
	! report.reducedMotion.headerStayedVisible ||
	! report.reducedMotion.motionDisabled ||
	! report.reducedMotion.mobileMenuTransitionDisabled ||
	! report.reducedMotion.galleryTransitionSkipped ||
	! report.reducedMotion.productFeedbackTransitionDisabled ||
	! report.reducedMotion.productReviewTransitionDisabled ||
	report.productDetails.some( ( details ) => ! details.passed ) ||
	report.productReviews.some( ( reviews ) => ! reviews.passed ) ||
	! report.productReviewsEmpty.passed ||
	! report.productReviewsWithoutJavaScript.passed ||
	report.commerceInteractions.catalog.some(
		( interaction ) => ! interaction.passed
	) ||
	report.commerceInteractions.cart.some(
		( interaction ) => ! interaction.passed
	) ||
	report.commerceInteractions.checkout.some(
		( interaction ) => ! interaction.passed
	) ||
	report.commerceInteractions.account.some(
		( interaction ) => ! interaction.passed
	) ||
	report.commerceInteractions.contact.some(
		( interaction ) => ! interaction.passed
	) ||
	! report.withoutJavaScript.productNoticeFallback.present ||
	! report.withoutJavaScript.productNoticeFallback.insidePurchase ||
	report.withoutJavaScript.productNoticeFallback.topNoticeCount > 0 ||
	report.withoutJavaScript.legacyMotionHooks > 0 ||
	report.withoutJavaScript.themeScriptInitialized;

console.log( `Audited ${ report.pages.length } page/viewport combinations.` );
console.log( `Report: ${ path.join( outputDirectory, 'report.json' ) }` );
if ( failures.length || enhancementFailures ) {
	console.error(
		`${
			failures.length
		} combinations failed automated thresholds; static theme contract passed: ${ ! enhancementFailures }.`
	);
	process.exitCode = 1;
}
