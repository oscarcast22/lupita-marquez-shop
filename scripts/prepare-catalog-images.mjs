/* eslint-disable no-console */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve( import.meta.dirname, '..' );
const productsRoot = path.join( projectRoot, 'productos' );
const outputRoot = path.join( productsRoot, 'catalogo' );
const themePath = path.join(
	projectRoot,
	'wp-content/themes/lupita-marquez/theme.json'
);
const theme = JSON.parse( await fs.readFile( themePath, 'utf8' ) );
const palette = Object.fromEntries(
	theme.settings.color.palette.map( ( { slug, color } ) => [ slug, color ] )
);

const images = [
	// Altar chico: four painted views; the comparison image is intentionally omitted.
	[
		'Altar Chico/WhatsApp Image 2026-07-27 at 11.41.02 AM.jpeg',
		'altar-chico/pintado/01-frontal.webp',
	],
	[
		'Altar Chico/WhatsApp Image 2026-07-27 at 11.41.02 AM2.jpeg',
		'altar-chico/pintado/02-oblicua.webp',
	],
	[
		'Altar Chico/WhatsApp Image 2026-07-27 at 11.41.03 AM3.jpeg',
		'altar-chico/pintado/03-detalle.webp',
	],
	[
		'Altar Chico/WhatsApp Image 2026-07-27 at 11.41.03 AM4.jpeg',
		'altar-chico/pintado/04-lateral.webp',
	],
	[
		'altar chico natural/WhatsApp Image 2026-07-27 at 11.41.28 AM3.jpeg',
		'altar-chico/natural/01-frontal.webp',
	],

	// Altar mediano without arch.
	[
		'Altar mediano/WhatsApp Image 2026-07-27 at 11.42.11 AM2.jpeg',
		'altar-mediano/pintado/01-medidas.webp',
	],
	[
		'Altar mediano/WhatsApp Image 2026-07-27 at 11.42.11 AM3.jpeg',
		'altar-mediano/pintado/02-frontal.webp',
	],
	[
		'Altar mediano/WhatsApp Image 2026-07-27 at 11.42.12 AM34.jpeg',
		'altar-mediano/pintado/03-frontal.webp',
	],
	[
		'Altar mediano/4613465.jpeg',
		'altar-mediano-con-arco/pintado/01-frontal.webp',
	],

	// Altar grande without arch; the branded cover is intentionally omitted.
	[
		'Altar Grande/hlkfghlfkdghlkg.jpeg',
		'altar-grande/pintado/01-frontal.webp',
	],
	[
		'Altar Grande/rehgsthgdfsh.jpeg',
		'altar-grande/pintado/02-oblicua.webp',
	],
	[
		'Altar Grande/sDJKBKDJSLBÑFNDS.jpeg',
		'altar-grande/pintado/03-detalle.webp',
	],

	// Four unique giant views; the exact duplicate files are intentionally omitted.
	[
		'Altar Gigante/WhatsApp Image 2026-07-27 at 11.43.19 AM.jpeg',
		'altar-gigante/natural/01-frontal.webp',
	],
	[
		'Altar Gigante/WhatsApp Image 2026-07-27 at 11.43.20 AM4.jpeg',
		'altar-gigante/natural/02-oblicua.webp',
	],
	[
		'Altar Gigante/WhatsApp Image 2026-07-27 at 11.43.20 AM43654.jpeg',
		'altar-gigante/natural/03-escala-humana.webp',
	],
	[
		'Altar Gigante/WhatsApp Image 2026-07-27 at 11.43.20 AM45.jpeg',
		'altar-gigante/natural/04-medidas.webp',
	],

	// Painted niche. The AI background-cleanup candidate was rejected because it altered product details.
	[
		'Nicho/WhatsApp Image 2026-07-27 at 11.44.10 AM.jpeg',
		'nicho/pintado/01-sostenido.webp',
	],
	[
		'Nicho/WhatsApp Image 2026-07-27 at 11.45.11 AM243.jpeg',
		'nicho/pintado/02-frontal.webp',
	],

	// Simple products.
	[
		'Altar Mascota/WhatsApp Image 2026-07-27 at 11.45.29 AM.jpeg',
		'altar-para-mascotas/01-frontal.webp',
	],
	[
		'Altar Mascota/WhatsApp Image 2026-07-27 at 11.45.30 AM2354.jpeg',
		'altar-para-mascotas/02-oblicua.webp',
	],
	[
		'Altar Mascota/WhatsApp Image 2026-07-27 at 11.45.30 AM5465.jpeg',
		'altar-para-mascotas/03-detalle.webp',
	],
	[
		'Altar Mascota/WhatsApp Image 2026-07-27 at 11.45.30 AM57645.jpeg',
		'altar-para-mascotas/04-medidas.webp',
	],
	// The AI background-cleanup candidate was rejected because it rearranged flowers.
	[
		'Cruz con Alas/WhatsApp Image 2026-07-27 at 11.47.03 AM.jpeg',
		'cruz-con-alas/01-decorada.webp',
	],
	[
		'Cruz con Alas/WhatsApp Image 2026-07-27 at 11.47.03 AM34645.jpeg',
		'cruz-con-alas/02-natural.webp',
	],
	[
		'Ropero/WhatsApp Image 2026-07-27 at 11.40.21 AM.jpeg',
		'ropero-mini/01-frontal.webp',
	],
	[
		'Ropero/WhatsApp Image 2026-07-27 at 11.40.22 AM.jpeg',
		'ropero-mini/02-interior.webp',
	],
	[
		'Ropero/WhatsApp Image 2026-07-27 at 11.40.22 AM2.jpeg',
		'ropero-mini/03-lateral.webp',
	],
	[
		'Ropero/WhatsApp Image 2026-07-27 at 11.40.22 AM3.jpeg',
		'ropero-mini/04-detalle.webp',
	],
];

const browser = await chromium.launch( { headless: true } );
const page = await browser.newPage();

const writeWebp = async ( source, destination ) => {
	const sourceBuffer = await fs.readFile( path.join( productsRoot, source ) );
	const sourceURL = `data:image/jpeg;base64,${ sourceBuffer.toString(
		'base64'
	) }`;
	const dataURL = await page.evaluate(
		async ( url, colors ) => {
			const image = new window.Image();
			image.src = url;
			await image.decode();

			const canvas = document.createElement( 'canvas' );
			canvas.width = 800;
			canvas.height = 1000;
			const context = canvas.getContext( '2d' );
			context.fillStyle = colors.white;
			context.fillRect( 0, 0, canvas.width, canvas.height );

			const padding = 32;
			const scale = Math.min(
				( canvas.width - padding * 2 ) / image.naturalWidth,
				( canvas.height - padding * 2 ) / image.naturalHeight
			);
			const width = Math.round( image.naturalWidth * scale );
			const height = Math.round( image.naturalHeight * scale );
			context.drawImage(
				image,
				Math.round( ( canvas.width - width ) / 2 ),
				Math.round( ( canvas.height - height ) / 2 ),
				width,
				height
			);
			return canvas.toDataURL( 'image/webp', 0.85 );
		},
		sourceURL,
		palette
	);

	const output = path.join( outputRoot, destination );
	await fs.mkdir( path.dirname( output ), { recursive: true } );
	await fs.writeFile(
		output,
		Buffer.from( dataURL.split( ',' )[ 1 ], 'base64' )
	);
};

for ( const [ source, destination ] of images ) {
	await writeWebp( source, destination );
}

const placeholderDataURL = await page.evaluate( ( colors ) => {
	const canvas = document.createElement( 'canvas' );
	canvas.width = 800;
	canvas.height = 1000;
	const context = canvas.getContext( '2d' );
	context.fillStyle = colors.white;
	context.fillRect( 0, 0, canvas.width, canvas.height );
	context.strokeStyle = colors.sand;
	context.lineWidth = 3;
	context.strokeRect( 48, 48, 704, 904 );
	context.fillStyle = colors.muted;
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.font = '600 48px system-ui, sans-serif';
	context.fillText( 'Foto próximamente', 400, 500 );
	return canvas.toDataURL( 'image/webp', 0.85 );
}, palette );
await fs.mkdir( path.join( outputRoot, 'placeholder' ), { recursive: true } );
await fs.writeFile(
	path.join( outputRoot, 'placeholder/foto-proximamente.webp' ),
	Buffer.from( placeholderDataURL.split( ',' )[ 1 ], 'base64' )
);

const placeholderDestinations = [
	'altar-chico-con-arco/natural/foto-proximamente.webp',
	'altar-chico-con-arco/pintado/foto-proximamente.webp',
	'altar-mediano/natural/foto-proximamente.webp',
	'altar-mediano-con-arco/natural/foto-proximamente.webp',
	'altar-grande/natural/foto-proximamente.webp',
	'altar-grande-con-arco/natural/foto-proximamente.webp',
	'altar-grande-con-arco/pintado/foto-proximamente.webp',
	'altar-gigante/pintado/foto-proximamente.webp',
	'nicho/natural/foto-proximamente.webp',
	'alcancia-reto-ahorro/foto-proximamente.webp',
];
const placeholderBuffer = Buffer.from(
	placeholderDataURL.split( ',' )[ 1 ],
	'base64'
);
for ( const destination of placeholderDestinations ) {
	const output = path.join( outputRoot, destination );
	await fs.mkdir( path.dirname( output ), { recursive: true } );
	await fs.writeFile( output, placeholderBuffer );
}

await browser.close();
console.log(
	`Prepared ${
		images.length + placeholderDestinations.length + 1
	} catalog images in ${ outputRoot }.`
);
