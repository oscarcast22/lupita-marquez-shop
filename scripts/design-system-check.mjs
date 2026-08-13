/* eslint-disable no-console */
import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve( import.meta.dirname, '..' );
const themeRoot = path.join( projectRoot, 'wp-content/themes/lupita-marquez' );
const stylesRoot = path.join( themeRoot, 'src/styles' );
const themePath = path.join( themeRoot, 'theme.json' );
const svgPaths = [
	path.join( themeRoot, 'assets/images/logo-lupita-marquez.svg' ),
	path.join( themeRoot, 'assets/images/botanical-corner.svg' ),
	path.join( themeRoot, 'assets/images/foto-proximamente.svg' ),
];
const generatorPath = path.join(
	projectRoot,
	'scripts/prepare-catalog-images.mjs'
);
const requiredPalette = [
	'ivory',
	'white',
	'charcoal',
	'wood',
	'olive',
	'sand',
	'mist',
	'fuchsia',
	'muted',
];
const requiredFontSizes = [
	'micro',
	'caption',
	'small',
	'medium',
	'large',
	'lead',
	'menu',
	'card-title',
	'category-link-icon',
	'drawer-link',
	'section-title',
	'x-large',
	'product-title',
	'price',
	'display',
];
const requiredSpacing = [
	'gutter',
	'content-gap',
	'section-heading',
	'editorial-gap',
	'footer-gap',
	'drawer-padding',
];
const violations = [];

const readCssFiles = async ( directory ) => {
	const entries = await fs.readdir( directory, { withFileTypes: true } );
	const nested = await Promise.all(
		entries.map( async ( entry ) => {
			const entryPath = path.join( directory, entry.name );
			if ( entry.isDirectory() ) {
				return readCssFiles( entryPath );
			}
			return entry.name.endsWith( '.css' ) ? [ entryPath ] : [];
		} )
	);
	return nested.flat();
};

const relative = ( filePath ) => path.relative( projectRoot, filePath );
const report = ( filePath, line, message ) =>
	violations.push( `${ relative( filePath ) }:${ line } ${ message }` );
const lineNumber = ( text, offset ) =>
	text.slice( 0, offset ).split( '\n' ).length;

const theme = JSON.parse( await fs.readFile( themePath, 'utf8' ) );
const palette = theme.settings?.color?.palette ?? [];
const paletteSlugs = new Set( palette.map( ( color ) => color.slug ) );
const paletteValues = new Set(
	palette.map( ( color ) => color.color.toLowerCase() )
);
const fontSizeSlugs = new Set(
	( theme.settings?.typography?.fontSizes ?? [] ).map( ( size ) => size.slug )
);
const spacingSlugs = new Set(
	( theme.settings?.spacing?.spacingSizes ?? [] ).map( ( size ) => size.slug )
);

for ( const slug of requiredPalette ) {
	if ( ! paletteSlugs.has( slug ) ) {
		violations.push( `theme.json missing palette token “${ slug }”.` );
	}
}
for ( const slug of requiredFontSizes ) {
	if ( ! fontSizeSlugs.has( slug ) ) {
		violations.push( `theme.json missing font-size token “${ slug }”.` );
	}
}
for ( const slug of requiredSpacing ) {
	if ( ! spacingSlugs.has( slug ) ) {
		violations.push( `theme.json missing spacing token “${ slug }”.` );
	}
}

for ( const cssPath of await readCssFiles( stylesRoot ) ) {
	const css = await fs.readFile( cssPath, 'utf8' );
	for ( const match of css.matchAll(
		/(?:#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\()/gi
	) ) {
		report(
			cssPath,
			lineNumber( css, match.index ),
			'uses a literal color; use a theme palette variable.'
		);
	}
	for ( const match of css.matchAll( /font-size:\s*([^;}\n]+)/gi ) ) {
		const value = match[ 1 ].trim();
		if ( ! value.startsWith( 'var(--wp--preset--font-size--' ) ) {
			report(
				cssPath,
				lineNumber( css, match.index ),
				`uses “${ value }” outside the typography scale.`
			);
		}
	}
	for ( const match of css.matchAll( /font-family:\s*([^;}\n]+)/gi ) ) {
		if (
			! match[ 1 ].trim().startsWith( 'var(--wp--preset--font-family--' )
		) {
			report(
				cssPath,
				lineNumber( css, match.index ),
				'uses a literal font family; use a theme typography variable.'
			);
		}
	}
	for ( const match of css.matchAll( /\b[0-9]+(?:\.[0-9]+)?px\b/g ) ) {
		const line = css.slice(
			css.lastIndexOf( '\n', match.index ) + 1,
			css.indexOf( '\n', match.index )
		);
		const isAllowedPhysicalStroke =
			/@media|border|outline|text-decoration|background-(?:position|size)|\.lm-sr-only/.test(
				line
			);
		if ( ! isAllowedPhysicalStroke ) {
			report(
				cssPath,
				lineNumber( css, match.index ),
				`uses “${ match[ 0 ] }” outside an allowed physical stroke or breakpoint.`
			);
		}
	}
	for ( const match of css.matchAll( /--lm-(?:shell|reading|gutter)\b/g ) ) {
		report(
			cssPath,
			lineNumber( css, match.index ),
			'uses a retired layout token; use the matching theme.json preset.'
		);
	}
	if ( path.basename( cssPath ) !== 'woocommerce.css' ) {
		for ( const match of css.matchAll( /\b(?:wp-block|wc-block)-/g ) ) {
			report(
				cssPath,
				lineNumber( css, match.index ),
				'uses WordPress/WooCommerce internal markup outside woocommerce.css.'
			);
		}
	}
}

for ( const svgPath of svgPaths ) {
	const svg = await fs.readFile( svgPath, 'utf8' );
	for ( const match of svg.matchAll( /#[0-9a-f]{3,8}\b/gi ) ) {
		if ( ! paletteValues.has( match[ 0 ].toLowerCase() ) ) {
			report(
				svgPath,
				lineNumber( svg, match.index ),
				`uses “${ match[ 0 ] }”, which is not a theme palette value.`
			);
		}
	}
}

const generator = await fs.readFile( generatorPath, 'utf8' );
for ( const match of generator.matchAll( /#[0-9a-f]{3,8}\b/gi ) ) {
	report(
		generatorPath,
		lineNumber( generator, match.index ),
		'uses a literal color; read palette values from theme.json.'
	);
}

if ( violations.length ) {
	console.error(
		`Design-system check failed:\n\n${ violations
			.map( ( violation ) => `- ${ violation }` )
			.join( '\n' ) }`
	);
	process.exitCode = 1;
} else {
	console.log( 'Design-system check passed.' );
}
