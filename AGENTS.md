# Contrato del frontend

- El tema FSE es code-first. Modifica `wp-content/themes/lupita-marquez/src/`, plantillas, partes y `theme.json`; nunca edites `build/` a mano.
- `theme.json` es la fuente única de color, tipografía y escalas de espacio. `tokens.css` contiene sólo radios, sombras y dimensiones de componentes.
- Toda banda usa `.lm-section` y todo contenido centrado usa `.lm-shell` en un nodo interior separado. No agregues `alignfull`, padding inline, `has-global-padding` ni compensaciones de `alignwide`.
- Las clases `lm-*` son la API visual estable. Selectores internos `wp-block-*` o `wc-block-*` pertenecen exclusivamente a `src/styles/woocommerce.css`.
- No dependas de `wp-container-*`, selectores anidados profundos ni `!important` salvo una excepción documentada junto al selector.
- El movimiento está permitido cuando aporta feedback, continuidad o jerarquía visual. Debe ser intencional, progresivo, evitar desplazamientos de layout innecesarios y respetar `prefers-reduced-motion`; no agregues dependencias de animación si CSS o JavaScript nativo resuelven el caso con claridad.
- Conserva estados claros de hover y foco, objetivos táctiles y el DOM oficial de carrito/checkout.
- Antes de entregar, ejecuta `npm run test:frontend`, las pruebas PHP y, si la tienda local está disponible, `npm run audit:frontend`.

## Revisión visual

- Usa `scripts/frontend-audit.mjs` como cobertura automatizada y reproducible: inicia Chromium headless, recorre las rutas y viewports configurados, genera capturas y valida métricas objetivas como desbordes, errores, assets, accesibilidad, alineación y escala de UI.
- La auditoría automatizada no sustituye el criterio visual. Después de ejecutarla, abre y analiza directamente las capturas de las rutas afectadas, comparándolas con los mockups o referencias disponibles.
- Para cualquier cambio visible, revisa como mínimo el viewport desktop de 1280 px y el móvil de 390 px. Revisa además el breakpoint implicado cuando el cambio sea responsive.
- No des por aprobado el acabado visual sólo porque `npm run audit:frontend` termine sin errores: confirma también jerarquía, ritmo, balance óptico, consistencia iconográfica y fidelidad al diseño.
- Durante iteraciones puntuales puedes tomar capturas headless adicionales de una sola ruta o viewport; antes de entregar conserva la auditoría completa como comprobación de regresiones.
