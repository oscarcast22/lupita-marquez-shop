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

El tema no carga JavaScript propio ni aplica animaciones, transiciones o desplazamiento suave mientras el diseño visual siga en definición. Los estados de hover, foco, selección y disponibilidad son inmediatos y no dependen del movimiento.

GSAP no forma parte del proyecto todavía. Cuando se apruebe el diseño final, el sistema de movimiento deberá definir hooks estables, funcionar como mejora progresiva y ofrecer una experiencia equivalente con `prefers-reduced-motion`.

## Edición y verificación

La clienta edita productos, inventario, promociones y contenido previsto desde administración. La estructura de plantillas permanece versionada. Usa `/guia-de-estilos/` para revisar tipografía, controles, avisos, tarjetas y estados. Compila con `npm run build` y valida cuatro anchos con `npm run audit:frontend`.
