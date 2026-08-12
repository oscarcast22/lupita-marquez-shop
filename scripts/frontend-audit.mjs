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
	[ 'busqueda', '/?s=altar&post_type=product' ],
	[ 'error-404', '/esta-ruta-no-existe/' ],
];
const requiredContent = {
	'carrito-vacio': '.wp-block-woocommerce-empty-cart-block',
	'producto-variable': '.single_add_to_cart_button',
	'producto-bajo-pedido': '.single_add_to_cart_button',
	'carrito-lleno': '.wc-block-cart-item__product',
	checkout: '.wc-block-components-checkout-place-order-button',
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
		let mobileNavigationAudit = null;
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
			await finishSelect.waitFor( { state: 'visible', timeout: 15_000 } );
			const defaultFinish = await finishSelect.inputValue();

			const selectAndRead = async ( label, expectedPrice ) => {
				await finishSelect.selectOption( { label } );
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
				await page.waitForTimeout( 100 );
				return page.evaluate( () => ( {
					variationId: Number(
						document.querySelector( 'input[name="variation_id"]' )
							?.value
					),
					gallery: [
						...new Set(
							[
								...document.querySelectorAll(
									'.woocommerce-product-gallery img, .wp-block-woocommerce-product-gallery img, .wp-block-woocommerce-product-image-gallery img, .lm-product-gallery img'
								),
							]
								.map(
									( image ) => image.currentSrc || image.src
								)
								.filter( ( source ) =>
									source.includes( '/uploads/' )
								)
						),
					],
					priceText:
						document
							.querySelector( '.woocommerce-variation-price' )
							?.textContent.trim() || '',
				} ) );
			};

			const natural = await selectAndRead( 'Natural', '599' );
			const painted = await selectAndRead( 'Pintado', '719' );
			await page.locator( '.single_add_to_cart_button' ).click();
			await page.waitForLoadState( 'networkidle' );
			const cart = await page.evaluate( async () =>
				fetch( '/wp-json/wc/store/v1/cart' ).then( ( result ) =>
					result.json()
				)
			);
			const cartItem = cart.items?.find(
				( item ) => item.sku === 'LM-ALT-CHI-PIN'
			);
			variationAudit = {
				defaultFinish,
				natural,
				painted,
				cartSku: cartItem?.sku || '',
				cartPrice: cartItem?.prices?.price || '',
				cartFinish:
					cartItem?.variation?.find(
						( attribute ) => attribute.attribute === 'Acabado'
					)?.value || '',
			};
			variationAudit.passed = Boolean(
				defaultFinish.toLowerCase() === 'pintado' &&
					natural.variationId &&
					painted.variationId &&
					natural.variationId !== painted.variationId &&
					natural.gallery.length &&
					painted.gallery.length &&
					natural.priceText.includes( '599' ) &&
					painted.priceText.includes( '719' ) &&
					JSON.stringify( natural.gallery ) !==
						JSON.stringify( painted.gallery ) &&
					variationAudit.cartSku === 'LM-ALT-CHI-PIN' &&
					variationAudit.cartPrice === '71900' &&
					variationAudit.cartFinish === 'Pintado'
			);
		}
		if ( name === 'carrito-lleno' || name === 'checkout' ) {
			await page
				.locator( '.wc-block-components-skeleton' )
				.first()
				.waitFor( { state: 'hidden', timeout: 15_000 } )
				.catch( () => {} );
			const hydratedSelector = requiredContent[ name ];
			await page
				.locator( hydratedSelector )
				.first()
				.waitFor( { state: 'visible', timeout: 15_000 } )
				.catch( () => {} );
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

			return {
				title: document.title,
				cls: +( window.__lmCLS || 0 ).toFixed( 4 ),
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
					heroAssetCorrect: heroImage
						? heroImageSource.includes(
								window.innerWidth <= 782
									? 'hero-mobile.jpg'
									: 'hero-desktop.jpg'
						  )
						: false,
				},
				uiScale: {
					body: fontSize( 'body' ),
					navigationChevronGap: rounded( navigationChevronGap ),
					navigation: fontSize(
						'.lm-site-header .wp-block-navigation-item__content'
					),
					heroTitle: fontSize( '.lm-hero h1' ),
					featuredTitle: fontSize( '.lm-featured-heading h2' ),
					pageTitle: fontSize( '.lm-page-header h1' ),
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
							drawer.scrollTop = Math.min( 40, overflow );
							return (
								overflow > 1 &&
								window.getComputedStyle( drawer ).overflowY ===
									'auto' &&
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
				await featuredCard.hover();
				await page.waitForTimeout( 300 );
				const cardHover = await readMotion( featuredCard );
				await page.screenshot( {
					path: path.join(
						outputDirectory,
						'inicio-product-hover-1280.png'
					),
				} );

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
						cardHover.boxShadow !== 'none',
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
			requiredContentMissing,
			interactionAudit,
			mobileNavigationAudit,
			stickyHeaderAudit,
			variationAudit,
			...metrics,
		} );
		await page.close();
	}

	await context.close();
}

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
await noJavaScriptContext.close();

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
		page.brokenImages.length ||
		page.pageErrors.length ||
		page.console.some( ( message ) => message.type === 'error' ) ||
		page.requiredContentMissing ||
		( page.name === 'inicio' &&
			( page.homeLayout.featuredProductCount !== 6 ||
				page.homeLayout.featuredButtonSpread > 1 ||
				! page.homeLayout.heroAssetCorrect ||
				page.interactionAudit?.accountTextLinkCount !== 0 ||
				! page.interactionAudit?.accountIconVisible ||
				page.interactionAudit?.headerSearchCount !== 0 ||
				( page.width <= 960 && ! page.mobileNavigationAudit?.passed ) ||
				( page.width === 1280 &&
					( ! page.interactionAudit?.desktop?.cardStable ||
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
	! report.reducedMotion.headerStayedVisible ||
	! report.reducedMotion.motionDisabled ||
	! report.reducedMotion.mobileMenuTransitionDisabled ||
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
