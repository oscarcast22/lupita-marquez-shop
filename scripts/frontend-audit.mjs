/* eslint-disable no-console */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.LM_BASE_URL || 'http://localhost:8088';
const outputDirectory = path.resolve(
	process.env.LM_AUDIT_OUTPUT || 'reports/frontend'
);
const chromePath = process.env.CHROME_PATH;
const widths = [ 1440, 1024, 768, 390 ];
const routes = [
	[ 'inicio', '/' ],
	[ 'tienda', '/tienda/' ],
	[ 'categoria', '/categoria-producto/altares/' ],
	[ 'carrito-vacio', '/carrito/' ],
	[ 'producto-simple', '/producto/altar-para-mascotas/' ],
	[ 'producto-variable', '/producto/altar-chico/' ],
	[ 'carrito-lleno', '/carrito/', 'fill-cart' ],
	[ 'checkout', '/finalizar-compra/' ],
	[ 'cuenta', '/mi-cuenta/' ],
	[ 'busqueda', '/?s=altar&post_type=product' ],
	[ 'error-404', '/esta-ruta-no-existe/' ],
];
const requiredContent = {
	'carrito-vacio': '.wp-block-woocommerce-empty-cart-block',
	'producto-simple': '.single_add_to_cart_button',
	'producto-variable': '.variations_form',
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
	[ 'IntersectionObserver', /\bIntersectionObserver\b/g ],
	[ 'Web Animations API', /\.animate\s*\(/g ],
	[
		'animation or transition property',
		/\b(?:animation|transition)(?:-[a-z-]+)?\s*:/g,
	],
	[ 'smooth scroll', /scroll-behavior\s*:\s*smooth/g ],
	[ 'motion token', /--lm-(?:motion|ease)[a-z-]*/g ],
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
				await page.waitForLoadState( 'networkidle' );
			}
		}

		const response = await page.goto( new URL( pathname, baseURL ).href, {
			waitUntil: 'networkidle',
			timeout: 45_000,
		} );
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
					'a, button, input, select, textarea, [role="button"]'
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
				legacyMotionHooks: document.querySelectorAll(
					'[data-lm-reveal], [data-lm-stagger], [data-lm-gallery]'
				).length,
				themeScriptLoaded: Boolean(
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
			...metrics,
		} );
		await page.close();
	}

	await context.close();
}

const noJavaScriptContext = await browser.newContext( {
	viewport: { width: 390, height: 900 },
	javaScriptEnabled: false,
} );
const noJavaScriptPage = await noJavaScriptContext.newPage();
await noJavaScriptPage.goto( new URL( '/', baseURL ).href, {
	waitUntil: 'networkidle',
	timeout: 45_000,
} );
report.withoutJavaScript = await noJavaScriptPage.evaluate( () => ( {
	mainVisible: Boolean(
		document.querySelector( 'main' )?.getBoundingClientRect().height
	),
	legacyMotionHooks: document.querySelectorAll(
		'[data-lm-reveal], [data-lm-stagger], [data-lm-gallery]'
	).length,
	themeScriptLoaded: Boolean(
		document.querySelector(
			'script[src*="/themes/lupita-marquez/build/index.js"]'
		)
	),
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

const failures = report.pages.filter(
	( page ) =>
		( page.status >= 400 && page.name !== 'error-404' ) ||
		page.overflow > 0 ||
		page.brokenImages.length ||
		page.pageErrors.length ||
		page.console.some( ( message ) => message.type === 'error' ) ||
		page.requiredContentMissing ||
		page.missingImageAlt.length ||
		page.unnamedControls.length ||
		page.criticalSmallTargets.length ||
		page.missingLanguage ||
		page.mainLandmarks !== 1 ||
		page.missingH1 ||
		page.headingLevelJumps.length ||
		page.legacyMotionHooks ||
		page.themeScriptLoaded ||
		page.shellEdgeSpread > 1 ||
		page.unexpectedLongPageFooterGap ||
		page.cls > 0.1
);
const enhancementFailures =
	sourceMotionViolations.length > 0 ||
	sourceContractViolations.length > 0 ||
	integrationSelectorViolations.length > 0 ||
	! report.withoutJavaScript.mainVisible ||
	report.withoutJavaScript.legacyMotionHooks > 0 ||
	report.withoutJavaScript.themeScriptLoaded;

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
