/* global Element, HTMLElement, HTMLInputElement, MutationObserver */

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
const PRODUCT_FEEDBACK_SELECTOR = '[data-lm-product-feedback]';
const STORE_FEEDBACK_SELECTOR = '[data-lm-store-feedback]';
const PRODUCT_NATIVE_ERROR_SELECTOR =
	'.woocommerce-error, .wc-block-components-notice-banner.is-error, .wc-block-components-notice-banner[role="alert"]';
const PRODUCT_NATIVE_NOTICE_SELECTOR =
	'.woocommerce-message, .woocommerce-info, .woocommerce-error, .wc-block-components-notice-banner';
const ERROR_SELECTOR = [
	'.woocommerce-error',
	'.wc-block-components-notice-banner.is-error',
	'.wc-block-components-notice-banner[role="alert"]',
].join( ', ' );

const pendingControls = new Set();
const submittedControls = new Set();
const originalControlState = new WeakMap();
const pendingTimers = new WeakMap();
const pendingLabelTimers = new WeakMap();
const productGalleryTransitions = new WeakMap();
const productReviewTransitions = new WeakMap();
let liveRegion;
let productFeedback;
let productFeedbackCleanupTimer;
let storeFeedback;
let storeFeedbackTimer;
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
const PRODUCT_GALLERY_TRANSITION_SETTLE = 320;
const PRODUCT_REVIEW_TRANSITION_SETTLE = 360;
const ADD_REQUEST_TIMEOUT = 15000;
const STORE_FEEDBACK_TIMEOUT = 9000;
const PRODUCT_VARIATION_FORM_SELECTOR =
	'.lm-product-purchase form.variations_form';
const PRODUCT_QUANTITY_SELECTOR = '.lm-product-purchase form.cart .quantity';
const PRODUCT_OFFER_PRICE_SELECTOR =
	'.lm-product-offer .wp-block-woocommerce-product-price';
const CONTACT_FORM_SELECTOR = '[data-lm-contact-form]';
const CONTACT_STATUS_SELECTOR = '[data-lm-contact-status]';
const ACCOUNT_AUTH_SELECTOR = '[data-lm-account-auth]';
const PASSWORD_VISIBILITY_SELECTOR = '.password-input .show-password-input';

const isElement = ( value ) => value instanceof Element;

const syncPasswordVisibilityControl = ( control ) => {
	if ( ! isElement( control ) ) {
		return;
	}

	const input = control
		.closest( '.password-input' )
		?.querySelector( 'input' );
	if ( ! ( input instanceof HTMLInputElement ) ) {
		return;
	}

	const isVisible = input.type === 'text';
	control.classList.toggle( 'lm-password-toggle--visible', isVisible );
	control.setAttribute(
		'aria-label',
		isVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'
	);
	control.setAttribute( 'aria-pressed', String( isVisible ) );
	if ( input.id ) {
		control.setAttribute( 'aria-controls', input.id );
	}
	control.removeAttribute( 'aria-describedby' );
};

const syncPasswordVisibilityControls = () => {
	document
		.querySelectorAll( PASSWORD_VISIBILITY_SELECTOR )
		.forEach( syncPasswordVisibilityControl );
};

const handlePasswordVisibilityControl = ( event ) => {
	const control = isElement( event.target )
		? event.target.closest( PASSWORD_VISIBILITY_SELECTOR )
		: null;
	if ( ! control ) {
		return;
	}

	/* WooCommerce toggles the field at the control target; sync after that native action. */
	window.requestAnimationFrame( () =>
		syncPasswordVisibilityControl( control )
	);
};

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

const createQuantityLabel = () => {
	const label = document.createElement( 'span' );
	label.className = 'lm-quantity__label';
	label.setAttribute( 'aria-hidden', 'true' );
	label.textContent = 'Cantidad';
	return label;
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
				const decreaseButton = createQuantityButton(
					'decrease',
					'Reducir cantidad',
					'−'
				);
				const increaseButton = createQuantityButton(
					'increase',
					'Aumentar cantidad',
					'+'
				);
				const actions = document.createElement( 'span' );

				quantity.classList.add( 'lm-quantity-control' );
				actions.className = 'lm-quantity__actions';
				quantity.insertBefore( createQuantityLabel(), input );
				quantity.insertBefore( actions, input );
				actions.append( decreaseButton, input, increaseButton );
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
			trigger.setAttribute( 'aria-label', 'Ampliar imagen del producto' );
		} );
};

const finishProductGalleryTransition = ( gallery ) => {
	const state = productGalleryTransitions.get( gallery );
	if ( ! state ) {
		return;
	}

	window.cancelAnimationFrame( state.frame );
	window.clearTimeout( state.timer );
	state.mutationObserver.disconnect();
	state.resizeObserver?.disconnect();
	gallery.classList.remove( 'lm-is-resizing' );
	gallery.style.removeProperty( 'height' );
	productGalleryTransitions.delete( gallery );
};

const measureProductGalleryTransition = ( gallery ) => {
	const state = productGalleryTransitions.get( gallery );
	if ( ! state ) {
		return;
	}

	window.cancelAnimationFrame( state.frame );
	state.frame = window.requestAnimationFrame( () => {
		const content = gallery.firstElementChild;
		const targetHeight = content?.getBoundingClientRect().height || 0;
		if ( targetHeight <= 0 ) {
			return;
		}

		if ( state.observedContent !== content && window.ResizeObserver ) {
			state.resizeObserver?.disconnect();
			state.resizeObserver = new window.ResizeObserver( () =>
				measureProductGalleryTransition( gallery )
			);
			state.resizeObserver.observe( content );
			state.observedContent = content;
		}

		gallery.style.height = `${ targetHeight }px`;
		window.clearTimeout( state.timer );
		state.timer = window.setTimeout(
			() => finishProductGalleryTransition( gallery ),
			PRODUCT_GALLERY_TRANSITION_SETTLE
		);
	} );
};

const startProductGalleryTransition = ( form ) => {
	if (
		! form ||
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
	) {
		return;
	}

	const gallery = form
		.closest( '.lm-product-layout' )
		?.querySelector( '.lm-product-gallery' );
	if ( ! gallery ) {
		return;
	}

	const currentHeight = gallery.getBoundingClientRect().height;
	finishProductGalleryTransition( gallery );
	gallery.style.height = `${ currentHeight }px`;
	gallery.classList.add( 'lm-is-resizing' );
	const state = {
		frame: 0,
		mutationObserver: new MutationObserver( ( mutations ) => {
			if (
				mutations.some( ( mutation ) => mutation.target !== gallery )
			) {
				measureProductGalleryTransition( gallery );
			}
		} ),
		observedContent: null,
		resizeObserver: null,
		timer: 0,
	};
	productGalleryTransitions.set( gallery, state );
	state.mutationObserver.observe( gallery, {
		attributes: true,
		childList: true,
		subtree: true,
	} );
	measureProductGalleryTransition( gallery );
};

const finishProductReviewTransition = ( button, state, isOpen ) => {
	if ( state.frame ) {
		window.cancelAnimationFrame( state.frame );
	}
	if ( state.timer ) {
		window.clearTimeout( state.timer );
	}

	state.frame = 0;
	state.timer = 0;
	state.isOpen = isOpen;
	state.wrapper.classList.remove( 'lm-is-animating' );
	state.wrapper.style.removeProperty( 'height' );
	state.wrapper.style.removeProperty( 'opacity' );
	state.wrapper.hidden = ! isOpen;
	button.setAttribute( 'aria-expanded', String( isOpen ) );
	button.textContent = isOpen
		? 'Cerrar formulario'
		: 'Escribir una valoración';
};

const setProductReviewFormOpen = ( button, state, isOpen, animate = true ) => {
	const { wrapper } = state;
	const reduceMotion = window.matchMedia(
		'(prefers-reduced-motion: reduce)'
	).matches;

	if ( wrapper.contains( wrapper.ownerDocument.activeElement ) && ! isOpen ) {
		button.focus();
	}

	if ( state.frame ) {
		window.cancelAnimationFrame( state.frame );
	}
	if ( state.timer ) {
		window.clearTimeout( state.timer );
	}
	state.isOpen = isOpen;

	button.setAttribute( 'aria-expanded', String( isOpen ) );
	button.textContent = isOpen
		? 'Cerrar formulario'
		: 'Escribir una valoración';

	if ( reduceMotion || ! animate ) {
		finishProductReviewTransition( button, state, isOpen );
		return;
	}

	wrapper.hidden = false;
	wrapper.classList.add( 'lm-is-animating' );
	const startHeight = isOpen ? 0 : wrapper.getBoundingClientRect().height;
	wrapper.style.height = `${ startHeight }px`;
	wrapper.style.opacity = isOpen ? '0' : '1';
	wrapper.getBoundingClientRect();

	state.frame = window.requestAnimationFrame( () => {
		wrapper.style.height = `${ isOpen ? wrapper.scrollHeight : 0 }px`;
		wrapper.style.opacity = isOpen ? '1' : '0';
		state.timer = window.setTimeout(
			() => finishProductReviewTransition( button, state, isOpen ),
			PRODUCT_REVIEW_TRANSITION_SETTLE
		);
	} );
};

const initProductReviews = () => {
	const button = document.querySelector( '[data-lm-review-form-toggle]' );
	const wrapper = document.querySelector(
		'.lm-product-reviews-content [id="review_form_wrapper"]'
	);
	if ( ! button || ! wrapper ) {
		return;
	}

	const currentState = productReviewTransitions.get( button );
	if ( currentState?.wrapper === wrapper ) {
		return;
	}
	if ( currentState ) {
		button.removeEventListener( 'click', currentState.handleClick );
		button.removeEventListener(
			'keydown',
			currentState.handleButtonKeydown
		);
		currentState.wrapper.removeEventListener(
			'keydown',
			currentState.handleWrapperKeydown
		);
	}

	const openFromHash = [
		'#review_form',
		'#review_form_wrapper',
		'#respond',
	].includes( window.location.hash );
	const state = {
		frame: 0,
		handleButtonKeydown: null,
		handleClick: null,
		handleWrapperKeydown: null,
		isOpen: openFromHash,
		timer: 0,
		wrapper,
	};
	productReviewTransitions.set( button, state );
	button.hidden = false;
	finishProductReviewTransition( button, state, openFromHash );

	state.handleClick = () => {
		setProductReviewFormOpen( button, state, ! state.isOpen );
	};
	state.handleButtonKeydown = ( event ) => {
		if ( event.key === 'Escape' && state.isOpen ) {
			event.preventDefault();
			setProductReviewFormOpen( button, state, false );
		}
	};
	state.handleWrapperKeydown = ( event ) => {
		if ( event.key === 'Escape' && state.isOpen ) {
			event.preventDefault();
			setProductReviewFormOpen( button, state, false );
		}
	};
	button.addEventListener( 'click', state.handleClick );
	button.addEventListener( 'keydown', state.handleButtonKeydown );
	wrapper.addEventListener( 'keydown', state.handleWrapperKeydown );
};

const initAccountAuth = () => {
	const root = document.querySelector( ACCOUNT_AUTH_SELECTOR );
	if ( ! isElement( root ) || root.dataset.lmAccountAuthReady === 'true' ) {
		return;
	}

	const panels = [ ...root.querySelectorAll( '[data-lm-account-panel]' ) ];
	const switchers = [
		...root.querySelectorAll( '[data-lm-account-view-target]' ),
	];
	const availableViews = new Set(
		panels.map( ( panel ) => panel.dataset.lmAccountPanel )
	);

	const showView = ( view ) => {
		if ( ! availableViews.has( view ) ) {
			return;
		}

		panels.forEach( ( panel ) => {
			panel.hidden = panel.dataset.lmAccountPanel !== view;
		} );
		root.dataset.lmActiveView = view;

		const heading = root.querySelector(
			`[data-lm-account-panel="${ view }"] [data-lm-account-panel-title]`
		);
		if ( heading instanceof HTMLElement ) {
			heading.focus();
		}
	};

	switchers.forEach( ( switcher ) => {
		switcher.addEventListener( 'click', ( event ) => {
			if (
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			) {
				return;
			}

			event.preventDefault();
			showView( switcher.dataset.lmAccountViewTarget );
		} );
	} );

	root.dataset.lmAccountAuthReady = 'true';
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

	clearProductFeedback();
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
		disabled: control.matches( 'button, input' )
			? Boolean( control.disabled )
			: null,
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
		control.removeAttribute( 'aria-busy' );
		if ( control.closest( 'form.cart' ) ) {
			setControlLabel( control, 'Agregado ✓' );
		}
	}
};

const clearControlFeedback = ( control ) => {
	if ( ! control ) {
		return;
	}

	control.classList.remove( 'lm-is-pending', 'lm-is-success', 'lm-is-error' );
	delete control.dataset.lmState;
	control.removeAttribute( 'aria-busy' );
	submittedControls.delete( control );
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
	if ( original.disabled !== null ) {
		control.disabled = original.disabled;
	}

	if ( control instanceof HTMLInputElement ) {
		control.value = original.value;
	} else {
		control.innerHTML = original.html;
	}
	submittedControls.delete( control );
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

const ensureStoreFeedback = () => {
	if ( storeFeedback?.isConnected ) {
		return storeFeedback;
	}

	storeFeedback = document.querySelector( STORE_FEEDBACK_SELECTOR );
	if ( storeFeedback ) {
		return storeFeedback;
	}

	storeFeedback = document.createElement( 'div' );
	storeFeedback.className = 'lm-store-feedback';
	storeFeedback.dataset.lmStoreFeedback = '';
	storeFeedback.setAttribute( 'aria-live', 'polite' );
	storeFeedback.setAttribute( 'aria-atomic', 'true' );
	document.body.append( storeFeedback );
	return storeFeedback;
};

const clearStoreFeedback = () => {
	if ( ! storeFeedback ) {
		return;
	}

	window.clearTimeout( storeFeedbackTimer );
	storeFeedback.classList.remove( 'is-visible' );
	storeFeedbackTimer = window.setTimeout( () => {
		if ( ! storeFeedback?.classList.contains( 'is-visible' ) ) {
			storeFeedback?.replaceChildren();
		}
	}, 240 );
};

const showStoreFeedback = ( messages = [], productName = '' ) => {
	const feedback = ensureStoreFeedback();
	const cleanMessages = [
		...new Set(
			( Array.isArray( messages ) ? messages : [] ).filter( Boolean )
		),
	];
	if ( ! cleanMessages.length ) {
		cleanMessages.push(
			productName
				? `No pudimos agregar “${ productName }”. Revisa la cantidad e inténtalo nuevamente.`
				: 'No pudimos agregar el producto. Inténtalo nuevamente.'
		);
	}

	window.clearTimeout( storeFeedbackTimer );
	const notice = document.createElement( 'div' );
	notice.className = 'lm-store-feedback__notice';
	notice.setAttribute( 'role', 'alert' );
	notice.setAttribute( 'aria-atomic', 'true' );

	const marker = document.createElement( 'span' );
	marker.className = 'lm-store-feedback__marker';
	marker.setAttribute( 'aria-hidden', 'true' );
	marker.textContent = '!';

	const content = document.createElement( 'div' );
	content.className = 'lm-store-feedback__content';
	cleanMessages.forEach( ( message ) => {
		const paragraph = document.createElement( 'p' );
		paragraph.textContent = message;
		content.append( paragraph );
	} );

	const dismiss = document.createElement( 'button' );
	dismiss.className = 'lm-store-feedback__dismiss';
	dismiss.dataset.lmDismissStoreFeedback = '';
	dismiss.setAttribute( 'aria-label', 'Cerrar mensaje' );
	dismiss.type = 'button';
	dismiss.textContent = '×';

	notice.append( marker, content, dismiss );
	feedback.replaceChildren( notice );
	window.requestAnimationFrame( () =>
		feedback.classList.add( 'is-visible' )
	);
	storeFeedbackTimer = window.setTimeout(
		() => clearStoreFeedback(),
		STORE_FEEDBACK_TIMEOUT
	);
};

const syncWooLabels = () => {
	document
		.querySelectorAll(
			'.lm-site-header .wc-block-components-drawer__close'
		)
		.forEach( ( closeButton ) =>
			closeButton.setAttribute( 'aria-label', 'Cerrar carrito' )
		);
	document
		.querySelectorAll(
			'.wc-block-checkout .wc-block-components-checkbox__label'
		)
		.forEach( ( label ) => {
			if (
				label.textContent.trim() !==
				'Create an account with Lupita Márquez'
			) {
				return;
			}
			label.textContent = 'Crear una cuenta con Lupita Márquez';
		} );
};

const getNoticeText = ( notice ) => {
	const copy = notice.cloneNode( true );
	copy.querySelectorAll( 'a, button, svg' ).forEach( ( item ) =>
		item.remove()
	);
	return copy.textContent.replace( /\s+/g, ' ' ).trim();
};

const clearProductFeedback = ( shouldRestoreFocus = false ) => {
	if ( ! productFeedback ) {
		return;
	}

	productFeedback.classList.remove( 'is-visible' );
	window.clearTimeout( productFeedbackCleanupTimer );
	productFeedbackCleanupTimer = window.setTimeout( () => {
		if ( ! productFeedback?.classList.contains( 'is-visible' ) ) {
			productFeedback?.replaceChildren();
		}
	}, 240 );

	if ( shouldRestoreFocus ) {
		const purchase = productFeedback.closest( '.lm-product-purchase' );
		const addButton = purchase?.querySelector(
			'.single_add_to_cart_button'
		);
		const focusTarget =
			addButton && ! addButton.disabled
				? addButton
				: purchase?.querySelector( 'input.qty' );
		focusTarget?.focus();
	}
};

const showProductError = ( messages, cartUrl = null ) => {
	if ( ! productFeedback ) {
		return;
	}

	const cleanMessages = [ ...new Set( messages.filter( Boolean ) ) ];
	if ( ! cleanMessages.length ) {
		cleanMessages.push(
			'No pudimos agregar el producto. Revisa la cantidad e inténtalo nuevamente.'
		);
	}

	window.clearTimeout( productFeedbackCleanupTimer );
	const notice = document.createElement( 'div' );
	notice.className = 'lm-product-feedback__notice';
	notice.setAttribute( 'aria-atomic', 'true' );
	notice.setAttribute( 'role', 'alert' );

	const marker = document.createElement( 'span' );
	marker.className = 'lm-product-feedback__marker';
	marker.setAttribute( 'aria-hidden', 'true' );
	marker.textContent = '!';

	const content = document.createElement( 'div' );
	content.className = 'lm-product-feedback__content';
	cleanMessages.forEach( ( message ) => {
		const paragraph = document.createElement( 'p' );
		paragraph.textContent = message;
		content.append( paragraph );
	} );

	if ( cartUrl ) {
		const cartLink = document.createElement( 'a' );
		cartLink.className = 'lm-product-feedback__cart-link';
		cartLink.href = cartUrl;
		cartLink.textContent = 'Ver carrito';
		content.append( cartLink );
	}

	const dismiss = document.createElement( 'button' );
	dismiss.className = 'lm-product-feedback__dismiss';
	dismiss.dataset.lmDismissProductFeedback = '';
	dismiss.setAttribute( 'aria-label', 'Cerrar mensaje' );
	dismiss.type = 'button';
	dismiss.textContent = '×';

	notice.append( marker, content, dismiss );
	productFeedback.replaceChildren( notice );
	window.requestAnimationFrame( () =>
		productFeedback?.classList.add( 'is-visible' )
	);
};

const normalizeNativeProductFeedback = () => {
	if ( ! productFeedback ) {
		return;
	}

	const notices = [
		...productFeedback.querySelectorAll( PRODUCT_NATIVE_NOTICE_SELECTOR ),
	].filter(
		( notice ) => ! notice.closest( '.lm-product-feedback__notice' )
	);
	if ( ! notices.length ) {
		return;
	}

	const errors = notices.filter( ( notice ) =>
		notice.matches( PRODUCT_NATIVE_ERROR_SELECTOR )
	);
	if ( errors.length ) {
		const cartLink = errors
			.flatMap( ( notice ) => [ ...notice.querySelectorAll( 'a' ) ] )
			.find( ( link ) => link.href );
		showProductError( errors.map( getNoticeText ), cartLink?.href || null );
		return;
	}

	const hasInformation = notices.some( ( notice ) =>
		notice.matches( '.woocommerce-info, .is-info' )
	);
	if ( ! hasInformation ) {
		clearProductFeedback();
	}
};

const collectNativeStoreErrors = () => {
	const notices = [
		...document.querySelectorAll( PRODUCT_NATIVE_NOTICE_SELECTOR ),
	].filter(
		( notice ) =>
			! notice.closest( '.lm-product-feedback__notice' ) &&
			! notice.closest( '.lm-store-feedback__notice' )
	);
	const errors = notices.filter( ( notice ) =>
		notice.matches( PRODUCT_NATIVE_ERROR_SELECTOR )
	);
	const messages = errors.map( getNoticeText );
	errors.forEach( ( notice ) => notice.remove() );
	return messages;
};

const handleProductFeedbackDismiss = ( event ) => {
	if ( ! isElement( event.target ) ) {
		return;
	}

	const productDismiss = event.target.closest(
		'[data-lm-dismiss-product-feedback]'
	);
	if ( productDismiss ) {
		clearProductFeedback( true );
		return;
	}

	if ( event.target.closest( '[data-lm-dismiss-store-feedback]' ) ) {
		clearStoreFeedback();
	}
};

const consumeProductErrors = async () => {
	const configuration = window.lmProductNotices;
	if ( ! configuration?.endpoint || ! configuration?.nonce ) {
		return { cartUrl: null, messages: [] };
	}

	const body = new URLSearchParams( { security: configuration.nonce } );
	const response = await fetch( configuration.endpoint, {
		body,
		credentials: 'same-origin',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
		},
		method: 'POST',
	} );
	const result = await response.json();
	if ( ! response.ok || ! result?.success ) {
		throw new Error( 'WooCommerce notice request failed.' );
	}

	return {
		cartUrl: result.data?.cartUrl || null,
		messages: Array.isArray( result.data?.messages )
			? result.data.messages
			: [],
	};
};

const hasVisibleError = () => {
	const error = [ ...document.querySelectorAll( ERROR_SELECTOR ) ].find(
		( item ) => ! item.closest( '.lm-product-feedback__notice' )
	);
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
						if ( control.closest( 'form.cart' ) ) {
							restoreControl( control );
						} else {
							// WooCommerce owns reactive catalog labels, including cart quantities.
							clearControlFeedback( control );
						}
					}
					return;
				}

				restoreControl( control );
			},
			state === 'success' ? 1000 : 2200
		);
		return;
	}

	[ ...pendingControls ].forEach( ( pendingControl ) =>
		finishControl( pendingControl, state )
	);
};

const isDrawerOpen = ( root ) => {
	const trigger = root?.querySelector( MINI_CART_BUTTON_SELECTOR );
	// WooCommerce mounts the mini-cart drawer in a portal attached to the
	// document body, outside the mini-cart block root. Check both locations so
	// contextual feedback can close an already-open drawer reliably.
	const overlay =
		root?.querySelector( '.wc-block-components-drawer__screen-overlay' ) ||
		document
			.querySelector( '.wc-block-mini-cart__drawer' )
			?.closest( '.wc-block-components-drawer__screen-overlay' );
	const overlayStyle = overlay ? window.getComputedStyle( overlay ) : null;
	return Boolean(
		root?.classList.contains( 'is-open' ) ||
			trigger?.getAttribute( 'aria-expanded' ) === 'true' ||
			( overlay &&
				! overlay.classList.contains(
					'wc-block-components-drawer__screen-overlay--is-hidden'
				) &&
				overlayStyle?.opacity !== '0' &&
				overlayStyle?.pointerEvents !== 'none' )
	);
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

const closeMiniCart = () => {
	if ( ! miniCartRoot || ! isDrawerOpen( miniCartRoot ) ) {
		return;
	}
	(
		miniCartRoot.querySelector( '.wc-block-components-drawer__close' ) ||
		document.querySelector(
			'.wc-block-mini-cart__drawer .wc-block-components-drawer__close'
		)
	)?.click();
};

const getBadgeText = () =>
	miniCartRoot
		?.querySelector( '.wc-block-mini-cart__badge' )
		?.textContent.trim() || '';

const getSinglePendingControl = () =>
	pendingControls.size === 1 ? [ ...pendingControls ][ 0 ] : null;

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
	const previousBadgeCount = Number( lastBadgeText || 0 );
	const nextBadgeCount = Number( nextBadgeText || 0 );
	const badgeIncreased = nextBadgeCount > previousBadgeCount;
	if ( hasBadgeSnapshot && nextBadgeText !== lastBadgeText ) {
		syncCartButtonQuantities( 0, true );
	}
	if ( hasBadgeSnapshot && badgeIncreased && getSinglePendingControl() ) {
		const control = getSinglePendingControl();
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
		observeBadge();
	} );
	miniCartObserver.observe( root, {
		attributes: true,
		characterData: true,
		childList: true,
		subtree: true,
	} );
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
		if ( ! pendingControls.has( control ) ) {
			return;
		}

		finishControl( control, 'error' );
		if ( control.closest( '.lm-product-purchase' ) ) {
			showProductError( [] );
		} else {
			closeMiniCart();
			showStoreFeedback( [], getProductName( control ) );
		}
		announce( 'No se pudo agregar el producto al carrito.' );
	}, ADD_REQUEST_TIMEOUT );
	pendingTimers.set( control, timer );
};

const getProductAddData = ( form, control ) => {
	const formData = new FormData( form );
	const data = new URLSearchParams();

	formData.forEach( ( value, key ) => {
		if ( typeof value === 'string' ) {
			data.set( key, value );
		}
	} );
	// Prevent WC_Form_Handler from adding the item before WC_AJAX handles it.
	data.delete( 'add-to-cart' );

	const isVariable = form.classList.contains( 'variations_form' );
	const variationId = Number( formData.get( 'variation_id' ) );
	if (
		isVariable &&
		( ! Number.isInteger( variationId ) || variationId < 1 )
	) {
		return null;
	}

	const productId = isVariable
		? variationId
		: control.dataset.productId ||
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

const handleProductAddError = async ( control ) => {
	let feedback = { cartUrl: null, messages: [] };
	try {
		feedback = await consumeProductErrors();
	} catch {
		// A concise local fallback is preferable to redirecting or losing context.
	}

	finishControl( control, 'error' );
	showProductError( feedback.messages, feedback.cartUrl );
	announce(
		feedback.messages[ 0 ] || 'No se pudo agregar el producto al carrito.'
	);
};

const addProduct = async ( form, control, data ) => {
	try {
		const abortController = new AbortController();
		const timeout = window.setTimeout(
			() => abortController.abort(),
			ADD_REQUEST_TIMEOUT
		);
		try {
			const response = await fetch(
				`${ window.location.origin }/?wc-ajax=add_to_cart`,
				{
					body: data,
					headers: {
						'Content-Type':
							'application/x-www-form-urlencoded; charset=UTF-8',
					},
					method: 'POST',
					signal: abortController.signal,
				}
			);
			const result = await response.json();

			if ( result.error ) {
				await handleProductAddError( control );
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
		} finally {
			window.clearTimeout( timeout );
		}
	} catch {
		await handleProductAddError( control );
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

	return getSinglePendingControl();
};

const getEventMessages = ( values ) =>
	values.flatMap( ( value ) => {
		const detail = value?.detail;
		return [ detail?.message, detail?.error?.message ].filter(
			( message ) => typeof message === 'string' && message.trim()
		);
	} );

const handleSuccessfulAdd = ( ...values ) => {
	const control = resolveEventControl( values );
	const productName = getProductName( control );
	finishControl( control, 'success' );
	clearProductFeedback();
	clearStoreFeedback();
	syncCartButtonLabels();
	syncCartButtonQuantities();
	announce( `${ productName } se agregó al carrito.` );
	openMiniCart();
};

const handleFailedAdd = ( ...values ) => {
	const control = resolveEventControl( values );
	if ( ! control ) {
		return;
	}

	const messages = getEventMessages( values );
	finishControl( control, 'error' );
	if ( control.closest( '.lm-product-purchase' ) ) {
		showProductError( messages );
	} else {
		const productName = getProductName( control );
		closeMiniCart();
		showStoreFeedback( messages, productName );
		window.setTimeout( () => {
			const nativeMessages = collectNativeStoreErrors();
			if ( nativeMessages.length ) {
				showStoreFeedback(
					[ ...messages, ...nativeMessages ],
					productName
				);
			}
		}, 0 );
	}
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

const handleProductSubmit = ( event ) => {
	const form = event.target;
	if (
		! isElement( form ) ||
		! form.matches( 'form.cart' ) ||
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
	const data = getProductAddData( form, control );
	if ( ! data ) {
		return;
	}

	event.preventDefault();
	if ( submittedControls.has( control ) ) {
		return;
	}
	clearProductFeedback();
	markPending( control );
	submittedControls.add( control );
	if ( control.matches( 'button, input' ) ) {
		control.disabled = true;
	}
	addProduct( form, control, data );
};

const handleBodyMutation = () => {
	const visibleError = hasVisibleError();
	connectMiniCart();
	syncCartButtonLabels();
	syncWooLabels();
	syncPasswordVisibilityControls();
	syncProductGalleryTriggers();
	initProductReviews();
	normalizeNativeProductFeedback();
	if ( pendingControls.size && visibleError ) {
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
	normalizeNativeProductFeedback();
	document
		.querySelectorAll( PRODUCT_VARIATION_FORM_SELECTOR )
		.forEach( syncProductOffer );

	document.addEventListener( 'click', handleQuantityStep );
	document.addEventListener( 'click', handleProductFeedbackDismiss );
	document.addEventListener(
		'change',
		( event ) => {
			if (
				isElement( event.target ) &&
				event.target.matches(
					`${ PRODUCT_VARIATION_FORM_SELECTOR } select[data-lm-variation-source], ${ PRODUCT_QUANTITY_SELECTOR } input.qty`
				)
			) {
				clearProductFeedback();
			}
			if (
				isElement( event.target ) &&
				event.target.matches(
					`${ PRODUCT_VARIATION_FORM_SELECTOR } select[data-lm-variation-source]`
				)
			) {
				startProductGalleryTransition(
					event.target.closest( PRODUCT_VARIATION_FORM_SELECTOR )
				);
				syncProductPurchasePresentation();
			}
		},
		true
	);

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

const setContactStatus = ( form, message, state = '' ) => {
	const status = form.querySelector( CONTACT_STATUS_SELECTOR );
	if ( ! isElement( status ) ) {
		return;
	}
	status.classList.remove( 'is-pending', 'is-success', 'is-error' );
	if ( state ) {
		status.classList.add( `is-${ state }` );
	}
	status.textContent = message;
};

const handleContactSubmit = async ( event ) => {
	const form = event.target;
	if (
		! isElement( form ) ||
		! form.matches( CONTACT_FORM_SELECTOR ) ||
		event.defaultPrevented ||
		typeof window.fetch !== 'function'
	) {
		return;
	}

	event.preventDefault();
	const button = form.querySelector( '[data-lm-contact-submit]' );
	const data = new FormData( form );
	data.set( 'lm_async', '1' );
	form.classList.add( 'is-pending' );
	form.setAttribute( 'aria-busy', 'true' );
	if ( isElement( button ) ) {
		button.disabled = true;
	}
	setContactStatus( form, 'Enviando tu mensaje…', 'pending' );

	try {
		const response = await window.fetch( form.getAttribute( 'action' ), {
			body: data,
			credentials: 'same-origin',
			headers: { Accept: 'application/json' },
			method: 'POST',
		} );
		const payload = await response.json();
		const message =
			payload?.data?.message ||
			( response.ok
				? 'Recibimos tu mensaje.'
				: 'No fue posible enviar tu mensaje.' );
		if ( ! response.ok || ! payload?.success ) {
			throw new Error( message );
		}
		form.reset();
		setContactStatus( form, message, 'success' );
		announce( message );
	} catch ( error ) {
		const message =
			error instanceof Error
				? error.message
				: 'No fue posible enviar tu mensaje. Inténtalo nuevamente.';
		setContactStatus( form, message, 'error' );
		form.querySelector( CONTACT_STATUS_SELECTOR )?.focus();
		announce( message );
	} finally {
		form.classList.remove( 'is-pending' );
		form.removeAttribute( 'aria-busy' );
		if ( isElement( button ) ) {
			button.disabled = false;
		}
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
	body.addEventListener( 'wc-blocks_add_to_cart_failed', ( event ) =>
		handleFailedAdd( event, event.detail?.button, event.detail?.control )
	);
	body.addEventListener( 'click', handleInteraction, true );
	document.addEventListener( 'click', handlePasswordVisibilityControl );
	body.addEventListener( 'submit', handleContactSubmit, true );
	body.addEventListener( 'submit', handleProductSubmit, true );
	body.addEventListener( 'submit', handleSubmit, true );

	const bodyObserver = new MutationObserver( handleBodyMutation );
	bodyObserver.observe( body, { childList: true, subtree: true } );
};

const initInteractions = () => {
	document.documentElement.classList.add( 'lm-interactions-ready' );
	initMobileMenu();
	productFeedback = document.querySelector( PRODUCT_FEEDBACK_SELECTOR );
	liveRegion = document.createElement( 'p' );
	liveRegion.className = 'lm-cart-status lm-sr-only';
	liveRegion.setAttribute( 'aria-live', 'polite' );
	liveRegion.setAttribute( 'aria-atomic', 'true' );
	document.body.append( liveRegion );

	syncCartButtonLabels();
	syncCartButtonQuantities();
	syncWooLabels();
	syncPasswordVisibilityControls();
	connectMiniCart();
	initProductReviews();
	initAccountAuth();
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
