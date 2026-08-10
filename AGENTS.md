# Contrato del frontend

- El tema FSE es code-first. Modifica `wp-content/themes/lupita-marquez/src/`, plantillas, partes y `theme.json`; nunca edites `build/` a mano.
- `theme.json` es la fuente única de color, tipografía y escalas de espacio. `tokens.css` contiene sólo radios, sombras y dimensiones de componentes.
- Toda banda usa `.lm-section` y todo contenido centrado usa `.lm-shell` en un nodo interior separado. No agregues `alignfull`, padding inline, `has-global-padding` ni compensaciones de `alignwide`.
- Las clases `lm-*` son la API visual estable. Selectores internos `wp-block-*` o `wc-block-*` pertenecen exclusivamente a `src/styles/woocommerce.css`.
- No dependas de `wp-container-*`, selectores anidados profundos ni `!important` salvo una excepción documentada junto al selector.
- El movimiento propio está deshabilitado hasta aprobar el diseño final. No agregues animaciones, transiciones, smooth scroll, hooks de movimiento ni dependencias como GSAP antes de esa aprobación.
- Conserva estados inmediatos de hover y foco, objetivos táctiles y el DOM oficial de carrito/checkout. Cuando se reactive el movimiento, deberá ser progresivo y respetar `prefers-reduced-motion`.
- Antes de entregar, ejecuta `npm run test:frontend`, las pruebas PHP y, si la tienda local está disponible, `npm run audit:frontend`.
