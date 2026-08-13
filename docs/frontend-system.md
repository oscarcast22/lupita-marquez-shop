# Sistema frontend Lupita Márquez

## Dirección

El lenguaje es editorial mexicano contemporáneo: marfil y carbón dominan, el fucsia señala acciones y ritmo, Fraunces aporta una voz expresiva y Manrope mantiene la compra legible. La fotografía ocupa planos 4:5; la asimetría y las líneas editoriales sustituyen tarjetas con sombra.

## Capas

- `theme.json`: paleta, familias, tamaños y escala de espacio.
- `src/styles/tokens.css`: dimensiones de componentes, radios y sombras.
- `base.css`: normalización accesible y primitivas `.lm-section`, `.lm-shell`, `.lm-reading`.
- `components.css` y `pages.css`: API visual propia `lm-*`.
- `woocommerce.css`: único adaptador permitido para markup interno de WordPress y WooCommerce.
- `responsive.css`: cambios estructurales por viewport.

El shell mide hasta 1280 px con gutter fluido de 16 a 40 px. La columna de lectura mide 720 px. Las secciones usan la escala de `theme.json`; las plantillas no declaran espaciado inline ni dependen de `alignfull`, `alignwide` o `wp-container-*`. Una banda y su shell siempre son nodos distintos.

## Interacción

El tema usa una capa pequeña de JavaScript progresivo para coordinar estados confirmados por WooCommerce: agregar al carrito, actualización del contador, apertura del mini-carrito y avisos de error. El DOM y las APIs oficiales de carrito y checkout permanecen intactos.

El movimiento aprobado es editorial y sutil: transiciones cortas de color, opacidad, transform y drawer. No se usan parallax, desplazamiento suave ni animaciones de entrada por scroll. GSAP no forma parte del proyecto. Toda interacción conserva una alternativa inmediata con `prefers-reduced-motion` y funciona sin el bundle propio cuando JavaScript está deshabilitado.

## Tokens y unidades

`theme.json` es la única fuente de colores, familias, tamaños de texto y espaciado. CSS sólo consume sus variables `--wp--preset--color-*`, `--wp--preset--font-family-*`, `--wp--preset--font-size-*` y `--wp--preset--spacing-*`; no se declaran colores, familias ni tamaños tipográficos literales en las hojas de estilo.

La escala tipográfica cubre micro, pie de foto, pequeño, cuerpo, introducción, navegación, título de tarjeta, enlace de menú móvil, títulos de sección, producto, precio y portada. Los tamaños editoriales son fluidos dentro de límites definidos por el tema. Las dimensiones de componentes, radios y sombras viven en `tokens.css` y se expresan en `rem`. `px` queda reservado para breakpoints y trazos físicos intencionales —bordes, contornos de foco, subrayados e iconos—.

Ejecuta `npm run check:design-system` para bloquear regresiones: valida los tokens requeridos, colores literales, tipografía fuera de escala, píxeles fuera de las excepciones, tokens de layout retirados y selectores internos fuera del adaptador WooCommerce.

## Edición y verificación

La clienta edita productos, inventario, promociones y contenido previsto desde administración. La estructura de plantillas permanece versionada. Usa `/guia-de-estilos/` para revisar tipografía, controles, avisos, tarjetas y estados. Compila y ejecuta la puerta de calidad con `npm run test:frontend`. La revisión visual se realiza manualmente en los viewports relevantes cuando corresponda.
