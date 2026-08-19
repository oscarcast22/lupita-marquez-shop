/* global Element, HTMLInputElement, MutationObserver */

const ADD_CONTROL_SELECTOR = [
	'.single_add_to_cart_button',
	'.wp-block-woocommerce-product-button .wp-element-button',
	'.wc-block-components-product-button__button',
	'a.add_to_cart_button',
].join( ', ' );

const MINI_CART_SELECTOR =
	'.wp-block-woocommerce-mini-cart, .wc-block-mini-cart';
const MINI_CART_BUTTON_SELECTOR = '.wc-block-mini-cart__button';
const PRODUCT_CART_LABEL_SELECTOR =
	'.wc-block-product .wc-block-components-product-button__button';
const ERROR_SELECTOR = [
	'.woocommerce-error',
	'.wc-block-components-notice-banner.is-error',
	'.wc-block-components-notice-banner[role="alert"]',
].join( ', ' );

const pendingControls = new Set();
const originalControlState = new WeakMap();
const pendingTimers = new WeakMap();
const pendingLabelTimers = new WeakMap();
let liveRegion;
let miniCartRoot;
let miniCartObserver;
let hasBadgeSnapshot = false;
let lastBadgeText = '';
let mobileMenu;
let mobileMenuToggle;
let mobileMenuBackdrop;
let mobileMenuOpen = false;
let mobileMenuFrame;
let mobileMenuInitialized = false;
let mobileMenuScrollY = 0;

const MOBILE_MENU_BREAKPOINT = 960;
const PENDING_LABEL_DELAY = 280;
const PRODUCT_VARIATION_FORM_SELECTOR =
	'.lm-product-purchase form.variations_form';
const PRODUCT_QUANTITY_SELECTOR = '.lm-product-purchase form.cart .quantity';
const PRODUCT_OFFER_PRICE_SELECTOR =
	'.lm-product-offer .wp-block-woocommerce-product-price';

const isElement = ( value ) => value instanceof Element;

const getNumericAttribute = ( input, attribute, fallback ) => {
	const value = Number( input.getAttribute( attribute ) );
	return Number.isFinite( value ) ? value : fallback;
};

const getQuantityState = ( input ) => {
	const minimum = getNumericAttribute( input, 'min', 1 );
	const maximum = getNumericAttribute( input, 'max', Infinity );
	const step = getNumericAttribute( input, 'step', 1 );
	const value = Number( input.value );
	return {
		maximum,
		minimum,
		step: step > 0 ? step : 1,
		value: Number.isFinite( value ) ? value : minimum,
	};
};

const syncQuantityControl = ( quantity ) => {
	const input = quantity.querySelector( 'input.qty' );
	if ( ! ( input instanceof HTMLInputElement ) ) {
		return;
	}

	const { maximum, minimum, value } = getQuantityState( input );
	quantity
		.querySelector( '[data-lm-quantity-step="decrease"]' )
		?.toggleAttribute( 'disabled', value <= minimum );
	quantity
		.querySelector( '[data-lm-quantity-step="increase"]' )
		?.toggleAttribute( 'disabled', value >= maximum );
};

const createQuantityButton = ( step, label, text ) => {
	const button = document.createElement( 'button' );
	button.className = 'lm-quantity__button';
	button.dataset.lmQuantityStep = step;
	button.setAttribute( 'aria-label', label );
	button.setAttribute( 'type', 'button' );
	button.textContent = text;
	return button;
};

const initProductQuantityControls = () => {
	document
		.querySelectorAll( PRODUCT_QUANTITY_SELECTOR )
		.forEach( ( quantity ) => {
			const input = quantity.querySelector( 'input.qty' );
			if ( ! ( input instanceof HTMLInputElement ) ) {
				return;
			}

			if ( ! quantity.classList.contains( 'lm-quantity-control' ) ) {
				quantity.classList.add( 'lm-quantity-control' );
				quantity.insertBefore(
					createQuantityButton( 'decrease', 'Reducir cantidad', '−' ),
					input
				);
				quantity.append(
					createQuantityButton( 'increase', 'Aumentar cantidad', '+' )
				);
				input.addEventListener( 'input', () =>
					syncQuantityControl( quantity )
				);
				input.addEventListener( 'change', () =>
					syncQuantityControl( quantity )
				);
			}

			syncQuantityControl( quantity );
		} );
};

const syncProductOffer = ( form, variation = null ) => {
	const summary = form.closest( '.lm-product-summary' );
	const price = summary?.querySelector( PRODUCT_OFFER_PRICE_SELECTOR );
	const availability = summary?.querySelector(
		'[data-lm-product-availability]'
	);
	if ( ! summary || ! price || ! availability ) {
		return;
	}

	if ( price.dataset.lmOriginalHtml === undefined ) {
		price.dataset.lmOriginalHtml = price.innerHTML;
	}

	const variationId = Number(
		form.querySelector( 'input[name="variation_id"]' )?.value
	);
	const isSelected = Number.isFinite( variationId ) && variationId > 0;
	const variationPrice = form.querySelector( '.woocommerce-variation-price' );
	const variationAvailability = form.querySelector(
		'.woocommerce-variation-availability'
	);
	const variationPriceHtml =
		variation?.price_html || variationPrice?.innerHTML || '';
	const variationAvailabilityHtml =
		variation?.availability_html || variationAvailability?.innerHTML || '';
	const hasVariationPrice = Boolean(
		isSelected && variationPriceHtml.trim()
	);

	price.innerHTML = hasVariationPrice
		? variationPriceHtml
		: price.dataset.lmOriginalHtml;
	availability.innerHTML = isSelected ? variationAvailabilityHtml : '';
	availability.hidden = ! availability.textContent.trim();
	summary.classList.add( 'lm-product-offer-ready' );
};

const syncVariationOptions = ( form ) => {
	const variationId = Number(
		form.querySelector( 'input[name="variation_id"]' )?.value
	);
	const isSelected = Number.isFinite( variationId ) && variationId > 0;
	form.classList.toggle( 'lm-has-selected-variation', isSelected );
	form.closest( '.lm-product-summary' )?.classList.toggle(
		'lm-has-selected-variation',
		isSelected
	);

	form.querySelectorAll( 'select[data-lm-variation-source]' ).forEach(
		( select ) => {
			const fieldset = form.querySelector(
				`[data-lm-variation-options-for="${ select.id }"]`
			);
			if ( ! fieldset ) {
				return;
			}

			fieldset
				.querySelectorAll( 'input[type="radio"]' )
				.forEach( ( radio ) => {
					const option = [ ...select.options ].find(
						( candidate ) => candidate.value === radio.value
					);
					radio.checked = select.value === radio.value;
					radio.disabled = Boolean( option?.disabled );
					radio
						.closest( '.lm-variation-option' )
						?.classList.toggle( 'is-selected', radio.checked );
				} );
		}
	);
};

const initVariationOptions = () => {
	document
		.querySelectorAll( PRODUCT_VARIATION_FORM_SELECTOR )
		.forEach( ( form ) => {
			form.querySelectorAll( '.variations select' ).forEach(
				( select, index ) => {
					if ( ! select.id ) {
						select.id = `lm-variation-${ index }`;
					}

					if ( ! select.dataset.lmVariationSource ) {
						const sourceLabel = form.querySelector(
							`label[for="${ select.id }"]`
						);
						const fieldset = document.createElement( 'fieldset' );
						fieldset.className = 'lm-variation-options';
						fieldset.dataset.lmVariationOptionsFor = select.id;
						const legend = document.createElement( 'legend' );
						legend.textContent =
							sourceLabel?.textContent.trim() || 'Opciones';
						fieldset.append( legend );
						const reset =
							index === 0
								? form.querySelector( '.reset_variations' )
								: null;
						if ( reset ) {
							reset.classList.add(
								'lm-variation-options__reset'
							);
							fieldset.append( reset );
						}

						[ ...select.options ]
							.filter( ( option ) => option.value )
							.forEach( ( option ) => {
								const label = document.createElement( 'label' );
								label.className = 'lm-variation-option';
								const radio = document.createElement( 'input' );
								radio.name = `lm-${ select.name }`;
								radio.type = 'radio';
								radio.value = option.value;
								radio.addEventListener( 'change', () => {
									select.value = radio.value;
									select.dispatchEvent(
										new Event( 'change', { bubbles: true } )
									);
									syncVariationOptions( form );
								} );
								const text = document.createElement( 'span' );
								text.textContent = option.textContent.trim();
								label.append( radio, text );
								fieldset.append( label );
							} );

						select.dataset.lmVariationSource = 'true';
						select.setAttribute( 'aria-hidden', 'true' );
						select.tabIndex = -1;
						select.insertAdjacentElement( 'afterend', fieldset );
						form.classList.add( 'lm-variation-options-ready' );
					}
				}
			);

			syncVariationOptions( form );
		} );
};

const syncProductGalleryTriggers = () => {
	document
		.querySelectorAll(
			'.lm-product-gallery .woocommerce-product-gallery__trigger'
		)
		.forEach( ( trigger ) => {
			if ( ! trigger.getAttribute( 'aria-label' ) ) {
				trigger.setAttribute(
					'aria-label',
					'Ampliar imagen del producto'
				);
			}
		} );
};

const handleQuantityStep = ( event ) => {
	const button = isElement( event.target )
		? event.target.closest( '.lm-quantity__button' )
		: null;
	if ( ! button || button.disabled ) {
		return;
	}

	const quantity = button.closest( '.lm-quantity-control' );
	const input = quantity?.querySelector( 'input.qty' );
	if ( ! ( input instanceof HTMLInputElement ) ) {
		return;
	}

	const { maximum, minimum, step, value } = getQuantityState( input );
	const direction = button.dataset.lmQuantityStep === 'increase' ? 1 : -1;
	const nextValue = Math.min(
		maximum,
		Math.max( minimum, Number( ( value + direction * step ).toFixed( 6 ) ) )
	);
	if ( nextValue === value ) {
		return;
	}

	input.value = String( nextValue );
	input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	input.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	syncQuantityControl( quantity );
};

const normalizePath = ( value ) => {
	const path = value.replace( /\/+$/, '' );
	return path || '/';
};

const setMobileMenuOffset = () => {
	const header = document.querySelector( '.lm-site-header' );
	if ( ! header ) {
		return;
	}

	document.documentElement.style.setProperty(
		'--lm-mobile-header-bottom',
		`${ Math.max( 0, header.getBoundingClientRect().bottom ) }px`
	);
};

const updateMobileMenuOffset = () => {
	window.cancelAnimationFrame( mobileMenuFrame );
	mobileMenuFrame = window.requestAnimationFrame( setMobileMenuOffset );
};

const getMobileMenuFocusables = () =>
	[
		...document.querySelectorAll(
			'.lm-site-header a[href], .lm-site-header button:not([disabled])'
		),
	].filter( ( element ) => element.getClientRects().length );

const closeMobileMenu = ( { restoreFocus = true } = {} ) => {
	if ( ! mobileMenuOpen ) {
		return;
	}

	mobileMenuOpen = false;
	document.documentElement.classList.remove( 'lm-mobile-menu-is-open' );
	document.documentElement.style.removeProperty(
		'--lm-mobile-scroll-lock-offset'
	);
	document.documentElement.style.removeProperty(
		'--lm-mobile-scrollbar-compensation'
	);
	window.scrollTo( 0, mobileMenuScrollY );
	setMobileMenuOffset();
	mobileMenuToggle.setAttribute( 'aria-expanded', 'false' );
	mobileMenuToggle.setAttribute( 'aria-label', 'Abrir el menú' );
	mobileMenu.setAttribute( 'aria-hidden', 'true' );
	if ( restoreFocus ) {
		mobileMenuToggle.focus( { preventScroll: true } );
	}
};

const openMobileMenu = () => {
	if ( mobileMenuOpen || window.innerWidth > MOBILE_MENU_BREAKPOINT ) {
		return;
	}

	setMobileMenuOffset();
	mobileMenuScrollY = window.scrollY;
	document.documentElement.style.setProperty(
		'--lm-mobile-scroll-lock-offset',
		`${ -mobileMenuScrollY }px`
	);
	document.documentElement.style.setProperty(
		'--lm-mobile-scrollbar-compensation',
		`${ window.innerWidth - document.documentElement.clientWidth }px`
	);
	mobileMenuOpen = true;
	document.documentElement.classList.add( 'lm-mobile-menu-is-open' );
	mobileMenuToggle.setAttribute( 'aria-expanded', 'true' );
	mobileMenuToggle.setAttribute( 'aria-label', 'Cerrar el menú' );
	mobileMenu.setAttribute( 'aria-hidden', 'false' );
	window.requestAnimationFrame( () =>
		mobileMenu.querySelector( 'a[href]' )?.focus()
	);
};

const toggleMobileMenu = () => {
	if ( mobileMenuOpen ) {
		closeMobileMenu();
	} else {
		openMobileMenu();
	}
};

const handleMobileMenuKeydown = ( event ) => {
	if ( ! mobileMenuOpen ) {
		return;
	}

	if ( event.key === 'Escape' ) {
		event.preventDefault();
		closeMobileMenu();
		return;
	}

	if ( event.key !== 'Tab' ) {
		return;
	}

	const focusables = getMobileMenuFocusables();
	const first = focusables[ 0 ];
	const last = focusables[ focusables.length - 1 ];
	const activeElement = first?.ownerDocument.activeElement;
	if ( event.shiftKey && activeElement === first ) {
		event.preventDefault();
		last.focus();
	} else if ( ! event.shiftKey && activeElement === last ) {
		event.preventDefault();
		first.focus();
	}
};

const markCurrentMobileDestination = () => {
	let currentPath = normalizePath( window.location.pathname );
	if ( currentPath.startsWith( '/producto/' ) ) {
		currentPath = '/tienda';
	}

	mobileMenu?.querySelectorAll( 'a[href]' ).forEach( ( link ) => {
		const linkPath = normalizePath( new URL( link.href ).pathname );
		if ( linkPath === currentPath ) {
			link.setAttribute( 'aria-current', 'page' );
		} else {
			link.removeAttribute( 'aria-current' );
		}
	} );
};

const initMobileMenu = () => {
	if ( mobileMenuInitialized ) {
		return;
	}

	mobileMenu = document.querySelector( '.lm-mobile-drawer' );
	mobileMenuToggle = document.querySelector( '.lm-mobile-menu-toggle' );
	mobileMenuBackdrop = document.querySelector( '.lm-mobile-menu-backdrop' );
	if ( ! mobileMenu || ! mobileMenuToggle || ! mobileMenuBackdrop ) {
		return;
	}

	markCurrentMobileDestination();
	updateMobileMenuOffset();
	mobileMenuToggle.addEventListener( 'click', toggleMobileMenu );
	mobileMenuBackdrop.addEventListener( 'click', () => closeMobileMenu() );
	mobileMenu.addEventListener( 'click', ( event ) => {
		if ( isElement( event.target ) && event.target.closest( 'a[href]' ) ) {
			closeMobileMenu( { restoreFocus: false } );
		}
	} );
	document.addEventListener( 'keydown', handleMobileMenuKeydown );
	window.addEventListener( 'scroll', updateMobileMenuOffset, {
		passive: true,
	} );
	window.addEventListener( 'resize', () => {
		updateMobileMenuOffset();
		if ( window.innerWidth > MOBILE_MENU_BREAKPOINT ) {
			closeMobileMenu( { restoreFocus: false } );
		}
	} );
	document
		.querySelector( '.lm-header-actions' )
		?.addEventListener(
			'click',
			() => closeMobileMenu( { restoreFocus: false } ),
			true
		);
	mobileMenuInitialized = true;
	document.documentElement.classList.add( 'lm-mobile-menu-ready' );
};

const getElementFromValue = ( value ) => {
	if ( isElement( value ) ) {
		return value;
	}

	if ( value?.jquery ) {
		return value[ 0 ] || null;
	}

	return null;
};

const getAddControl = ( target ) => {
	if ( ! isElement( target ) ) {
		return null;
	}

	const control = target.closest( ADD_CONTROL_SELECTOR );
	if ( ! control ) {
		return null;
	}

	const form = control.closest( 'form.cart' );
	const href = control.getAttribute( 'href' ) || '';
	const hasProductId = Boolean( control.dataset.productId );
	const isAddLink =
		href.includes( 'add-to-cart=' ) ||
		control.classList.contains( 'add_to_cart_button' );
	const isBlockButton = control.matches(
		'.wc-block-components-product-button__button'
	);

	if ( form || hasProductId || isAddLink || ( isBlockButton && ! href ) ) {
		return control;
	}

	return null;
};

const getProductName = ( control ) => {
	const product = control?.closest( '.wc-block-product' );
	const productTitle = product?.querySelector( '.wp-block-post-title' );
	const summaryTitle = control
		?.closest( '.lm-product-summary' )
		?.querySelector( 'h1' );
	return (
		( productTitle || summaryTitle )?.textContent.trim() || 'El producto'
	);
};

const setControlLabel = ( control, label ) => {
	if ( control instanceof HTMLInputElement ) {
		control.value = label;
		return;
	}

	const labelElement = control.querySelector( '[data-wp-text]' );
	if ( labelElement ) {
		labelElement.textContent = label;
		return;
	}

	control.textContent = label;
};

const saveControlState = ( control ) => {
	if ( originalControlState.has( control ) ) {
		return;
	}

	originalControlState.set( control, {
		ariaLabel: control.getAttribute( 'aria-label' ),
		html: control.innerHTML,
		value: control instanceof HTMLInputElement ? control.value : null,
	} );
};

const setControlState = ( control, state ) => {
	saveControlState( control );
	control.classList.remove( 'lm-is-pending', 'lm-is-success', 'lm-is-error' );
	control.classList.add( `lm-is-${ state }` );
	control.dataset.lmState = state;

	if ( state === 'pending' ) {
		control.setAttribute( 'aria-busy', 'true' );
		setControlLabel( control, 'Agregando…' );
	} else if ( state === 'error' ) {
		control.removeAttribute( 'aria-busy' );
		setControlLabel( control, 'No se pudo agregar' );
	} else if ( state === 'success' ) {
		// WooCommerce owns the reactive label, including the persistent cart quantity.
		control.removeAttribute( 'aria-busy' );
	}
};

const clearControlFeedback = ( control ) => {
	if ( ! control ) {
		return;
	}

	control.classList.remove( 'lm-is-pending', 'lm-is-success', 'lm-is-error' );
	delete control.dataset.lmState;
	control.removeAttribute( 'aria-busy' );
	originalControlState.delete( control );
};

const restoreControl = ( control ) => {
	const original = originalControlState.get( control );
	if ( ! original ) {
		return;
	}

	control.classList.remove( 'lm-is-pending', 'lm-is-success', 'lm-is-error' );
	delete control.dataset.lmState;
	control.removeAttribute( 'aria-busy' );
	if ( original.ariaLabel === null ) {
		control.removeAttribute( 'aria-label' );
	} else {
		control.setAttribute( 'aria-label', original.ariaLabel );
	}

	if ( control instanceof HTMLInputElement ) {
		control.value = original.value;
	} else {
		control.innerHTML = original.html;
	}
	originalControlState.delete( control );
};

const clearPendingTimer = ( control ) => {
	const timer = pendingTimers.get( control );
	if ( timer ) {
		window.clearTimeout( timer );
		pendingTimers.delete( control );
	}

	const labelTimer = pendingLabelTimers.get( control );
	if ( labelTimer ) {
		window.clearTimeout( labelTimer );
		pendingLabelTimers.delete( control );
	}
};

const announce = ( message ) => {
	if ( liveRegion ) {
		liveRegion.textContent = message;
	}
};

const hasVisibleError = () => {
	const error = document.querySelector( ERROR_SELECTOR );
	return Boolean( error?.getClientRects().length );
};

const finishControl = ( control, state ) => {
	if ( control ) {
		clearPendingTimer( control );
		pendingControls.delete( control );
		setControlState( control, state );
		window.setTimeout(
			() => {
				if ( state === 'success' ) {
					if ( control.dataset.lmState === 'success' ) {
						clearControlFeedback( control );
					}
					return;
				}

				restoreControl( control );
			},
			state === 'success' ? 1800 : 2200
		);
		return;
	}

	[ ...pendingControls ].forEach( ( pendingControl ) =>
		finishControl( pendingControl, state )
	);
};

const isDrawerOpen = ( root ) => {
	const trigger = root?.querySelector( MINI_CART_BUTTON_SELECTOR );
	return Boolean(
		root?.classList.contains( 'is-open' ) ||
			root?.classList.contains( 'lm-is-open' ) ||
			trigger?.getAttribute( 'aria-expanded' ) === 'true' ||
			root?.querySelector(
				'.wc-block-components-drawer__screen-overlay.is-open, .wc-block-components-drawer__screen-overlay[aria-hidden="false"], .wc-block-components-drawer__screen-overlay--with-slide-in'
			)
	);
};

const syncDrawerState = () => {
	if ( ! miniCartRoot ) {
		return;
	}

	const open = isDrawerOpen( miniCartRoot );
	miniCartRoot.classList.toggle( 'lm-is-open', open );
	document.documentElement.classList.toggle( 'lm-drawer-is-open', open );
};

const openMiniCart = () => {
	if ( ! miniCartRoot || isDrawerOpen( miniCartRoot ) ) {
		return;
	}

	const trigger = miniCartRoot.querySelector( MINI_CART_BUTTON_SELECTOR );
	if ( ! trigger ) {
		return;
	}

	window.setTimeout( () => {
		if ( ! isDrawerOpen( miniCartRoot ) ) {
			trigger.click();
		}
	}, 80 );
};

const getBadgeText = () =>
	miniCartRoot
		?.querySelector( '.wc-block-mini-cart__badge' )
		?.textContent.trim() || '';

const syncCartButtonLabels = () => {
	document
		.querySelectorAll( PRODUCT_CART_LABEL_SELECTOR )
		.forEach( ( control ) => {
			const labelElement = control.querySelector( '[data-wp-text]' );
			const currentLabel = labelElement?.textContent.trim() || '';
			const quantity =
				currentLabel.match( /^(\d+)\s+in\s+cart$/i )?.[ 1 ];

			if ( ! labelElement || ! quantity ) {
				return;
			}

			labelElement.textContent = `${ quantity } en carrito`;
		} );
};

const getDefaultCartButtonLabel = ( control ) => {
	const contextElement = control.closest( '[data-wp-context]' );
	if ( contextElement ) {
		try {
			const context = JSON.parse(
				contextElement.getAttribute( 'data-wp-context' ) || '{}'
			);
			if ( context.addToCartText ) {
				return context.addToCartText;
			}
		} catch {
			// Fall back to the theme label when the block context is unavailable.
		}
	}

	return 'Agregar al carrito';
};

const syncCartButtonQuantities = async (
	retryCount = 0,
	shouldRetry = false
) => {
	const controls = [
		...document.querySelectorAll( PRODUCT_CART_LABEL_SELECTOR ),
	].filter( ( control ) =>
		control.classList.contains( 'product_type_simple' )
	);

	if ( ! controls.length ) {
		return;
	}

	try {
		const response = await fetch(
			`${ window.location.origin }/wp-json/wc/store/v1/cart`,
			{ cache: 'no-store', credentials: 'same-origin' }
		);
		if ( ! response.ok ) {
			return;
		}

		const cart = await response.json();
		const quantities = new Map(
			( cart.items || [] ).map( ( item ) => [
				String( item.id ),
				Number( item.quantity ),
			] )
		);

		controls.forEach( ( control ) => {
			const labelElement = control.querySelector( '[data-wp-text]' );
			const productId =
				control.getAttribute( 'data-product_id' ) ||
				control.getAttribute( 'data-product-id' );

			if ( ! labelElement || ! productId ) {
				return;
			}

			const quantity = quantities.get( productId );
			if ( quantity > 0 ) {
				labelElement.textContent = `${ quantity } en carrito`;
				return;
			}

			if (
				/^\d+\s+en\s+carrito$/i.test( labelElement.textContent.trim() )
			) {
				labelElement.textContent = getDefaultCartButtonLabel( control );
			}
		} );

		if ( shouldRetry && retryCount < 3 ) {
			window.setTimeout(
				() => syncCartButtonQuantities( retryCount + 1, true ),
				600 * ( retryCount + 1 )
			);
		}
	} catch {
		// The native WooCommerce state remains the fallback if the Store API is unavailable.
	}
};

const observeBadge = () => {
	syncCartButtonLabels();
	const nextBadgeText = getBadgeText();
	if ( hasBadgeSnapshot && nextBadgeText !== lastBadgeText ) {
		syncCartButtonQuantities( 0, true );
	}
	if (
		hasBadgeSnapshot &&
		nextBadgeText !== lastBadgeText &&
		pendingControls.size
	) {
		const control = [ ...pendingControls ][ 0 ];
		finishControl( control, 'success' );
		announce( `${ getProductName( control ) } se agregó al carrito.` );
		openMiniCart();
	}

	hasBadgeSnapshot = true;
	lastBadgeText = nextBadgeText;
};

const connectMiniCart = () => {
	const root = document.querySelector( MINI_CART_SELECTOR );
	if ( ! root || root === miniCartRoot ) {
		return;
	}

	miniCartObserver?.disconnect();
	miniCartRoot = root;
	hasBadgeSnapshot = false;
	lastBadgeText = '';
	miniCartObserver = new MutationObserver( () => {
		syncDrawerState();
		observeBadge();
	} );
	miniCartObserver.observe( root, {
		attributes: true,
		characterData: true,
		childList: true,
		subtree: true,
	} );
	syncDrawerState();
	observeBadge();
};

const markPending = ( control ) => {
	if (
		! control ||
		pendingControls.has( control ) ||
		control.matches( ':disabled, [aria-disabled="true"]' )
	) {
		return;
	}

	pendingControls.add( control );
	saveControlState( control );
	control.setAttribute( 'aria-busy', 'true' );
	const labelTimer = window.setTimeout( () => {
		pendingLabelTimers.delete( control );
		if ( pendingControls.has( control ) ) {
			setControlState( control, 'pending' );
		}
	}, PENDING_LABEL_DELAY );
	pendingLabelTimers.set( control, labelTimer );
	const timer = window.setTimeout( () => {
		if ( hasVisibleError() ) {
			finishControl( control, 'error' );
			announce( 'No se pudo agregar el producto al carrito.' );
		} else {
			clearPendingTimer( control );
			pendingControls.delete( control );
			restoreControl( control );
		}
	}, 5000 );
	pendingTimers.set( control, timer );
};

const getSimpleAddData = ( form, control ) => {
	const formData = new FormData( form );
	const data = new URLSearchParams();

	formData.forEach( ( value, key ) => {
		if ( typeof value === 'string' ) {
			data.set( key, value );
		}
	} );

	const productId =
		control.dataset.productId ||
		formData.get( 'add-to-cart' ) ||
		control.getAttribute( 'value' );
	if ( productId ) {
		data.set( 'product_id', productId.toString() );
	}
	if ( ! data.has( 'quantity' ) ) {
		data.set( 'quantity', '1' );
	}

	return data;
};

const addSimpleProduct = async ( form, control ) => {
	try {
		const response = await fetch(
			`${ window.location.origin }/?wc-ajax=add_to_cart`,
			{
				body: getSimpleAddData( form, control ),
				headers: {
					'Content-Type':
						'application/x-www-form-urlencoded; charset=UTF-8',
				},
				method: 'POST',
			}
		);
		const result = await response.json();

		if ( result.error && result.product_url ) {
			window.location.href = result.product_url;
			return;
		}
		if ( ! response.ok || ! result ) {
			throw new Error( 'WooCommerce add-to-cart request failed.' );
		}

		if ( window.jQuery ) {
			window
				.jQuery( document.body )
				.trigger( 'added_to_cart', [
					result.fragments,
					result.cart_hash,
					window.jQuery( control ),
				] );
			return;
		}

		document.body.dispatchEvent(
			new CustomEvent( 'wc-blocks_added_to_cart', {
				bubbles: true,
				detail: { button: control, fragments: result.fragments },
			} )
		);
	} catch ( error ) {
		finishControl( control, 'error' );
		announce( 'No se pudo agregar el producto al carrito.' );
	}
};

const resolveEventControl = ( values ) => {
	for ( const value of values ) {
		const element = getElementFromValue( value );
		if ( element ) {
			return element.matches( ADD_CONTROL_SELECTOR )
				? element
				: element.closest( ADD_CONTROL_SELECTOR );
		}
	}

	return [ ...pendingControls ][ 0 ] || null;
};

const handleSuccessfulAdd = ( ...values ) => {
	const control = resolveEventControl( values );
	const productName = getProductName( control );
	finishControl( control, 'success' );
	syncCartButtonLabels();
	syncCartButtonQuantities();
	announce( `${ productName } se agregó al carrito.` );
	openMiniCart();
};

const handleFailedAdd = () => {
	if ( ! pendingControls.size ) {
		return;
	}

	finishControl( [ ...pendingControls ][ 0 ], 'error' );
	announce( 'No se pudo agregar el producto al carrito.' );
};

const handleInteraction = ( event ) => {
	const control = getAddControl( event.target );
	if ( ! control ) {
		return;
	}

	const form = control.closest( 'form.cart' );
	if (
		form?.classList.contains( 'variations_form' ) &&
		( form.classList.contains( 'variation-needs-update' ) ||
			form.querySelector(
				'.woocommerce-variation-add-to-cart-disabled'
			) )
	) {
		return;
	}

	markPending( control );
};

const handleSubmit = ( event ) => {
	const form = event.target;
	if ( ! isElement( form ) || ! form.matches( 'form.cart' ) ) {
		return;
	}

	const control = getAddControl(
		event.submitter || form.querySelector( '.single_add_to_cart_button' )
	);
	markPending( control );
};

const handleSimpleSubmit = ( event ) => {
	const form = event.target;
	if (
		! isElement( form ) ||
		! form.matches( 'form.cart' ) ||
		form.classList.contains( 'variations_form' ) ||
		typeof window.jQuery !== 'function' ||
		event.defaultPrevented
	) {
		return;
	}

	const control = getAddControl(
		event.submitter || form.querySelector( '.single_add_to_cart_button' )
	);
	if ( ! control || form.method.toLowerCase() !== 'post' ) {
		return;
	}

	event.preventDefault();
	markPending( control );
	addSimpleProduct( form, control );
};

const handleBodyMutation = () => {
	connectMiniCart();
	syncCartButtonLabels();
	syncProductGalleryTriggers();
	if ( pendingControls.size && hasVisibleError() ) {
		handleFailedAdd();
	}
};

const syncProductPurchasePresentation = (
	activeForm = null,
	variation = null,
	includeOffer = false
) => {
	window.requestAnimationFrame( () => {
		initVariationOptions();
		initProductQuantityControls();
		const forms = activeForm
			? [ activeForm ]
			: document.querySelectorAll( PRODUCT_VARIATION_FORM_SELECTOR );
		forms.forEach( ( form ) => {
			syncVariationOptions( form );
			if ( includeOffer && form === activeForm ) {
				syncProductOffer( form, variation );
			}
		} );
		syncProductGalleryTriggers();
	} );
};

const bindProductPurchaseControls = () => {
	initVariationOptions();
	initProductQuantityControls();
	syncProductGalleryTriggers();
	document
		.querySelectorAll( PRODUCT_VARIATION_FORM_SELECTOR )
		.forEach( syncProductOffer );

	document.addEventListener( 'click', handleQuantityStep );
	document.addEventListener( 'change', ( event ) => {
		if (
			isElement( event.target ) &&
			event.target.matches(
				`${ PRODUCT_VARIATION_FORM_SELECTOR } select[data-lm-variation-source]`
			)
		) {
			syncProductPurchasePresentation();
		}
	} );

	if ( window.jQuery ) {
		const forms = window
			.jQuery( PRODUCT_VARIATION_FORM_SELECTOR )
			.off( '.lmProductPurchase' );
		forms
			.on(
				'found_variation.lmProductPurchase',
				function ( _event, variation ) {
					syncProductPurchasePresentation( this, variation, true );
				}
			)
			.on(
				'hide_variation.lmProductPurchase reset_data.lmProductPurchase',
				function () {
					syncProductPurchasePresentation( this, null, true );
				}
			)
			.on(
				'woocommerce_update_variation_values.lmProductPurchase woocommerce_variation_has_changed.lmProductPurchase',
				function () {
					syncProductPurchasePresentation( this );
				}
			);
	}
};

const bindWooEvents = () => {
	const body = document.body;
	if ( window.jQuery ) {
		window
			.jQuery( body )
			.on( 'added_to_cart.lmInteractions', handleSuccessfulAdd );
		window
			.jQuery( body )
			.on( 'wc_fragments_refreshed.lmInteractions', connectMiniCart );
	}

	body.addEventListener( 'added_to_cart', ( event ) =>
		handleSuccessfulAdd(
			event,
			event.detail?.button,
			event.detail?.control
		)
	);
	body.addEventListener( 'wc-blocks_added_to_cart', ( event ) =>
		handleSuccessfulAdd(
			event,
			event.detail?.button,
			event.detail?.control
		)
	);
	body.addEventListener( 'wc-blocks_removed_from_cart', () => {
		syncCartButtonLabels();
		syncCartButtonQuantities( 0, true );
	} );
	body.addEventListener( 'wc-blocks_add_to_cart_failed', handleFailedAdd );
	body.addEventListener( 'click', handleInteraction, true );
	body.addEventListener( 'submit', handleSimpleSubmit, true );
	body.addEventListener( 'submit', handleSubmit, true );

	const bodyObserver = new MutationObserver( handleBodyMutation );
	bodyObserver.observe( body, { childList: true, subtree: true } );
};

const initInteractions = () => {
	document.documentElement.classList.add( 'lm-interactions-ready' );
	initMobileMenu();
	liveRegion = document.createElement( 'p' );
	liveRegion.className = 'lm-cart-status lm-sr-only';
	liveRegion.setAttribute( 'aria-live', 'polite' );
	liveRegion.setAttribute( 'aria-atomic', 'true' );
	document.body.append( liveRegion );

	syncCartButtonLabels();
	syncCartButtonQuantities();
	connectMiniCart();
	bindProductPurchaseControls();
	bindWooEvents();
};

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', initInteractions, {
		once: true,
	} );
} else {
	initInteractions();
}
