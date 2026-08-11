# Modelo de catálogo

El prototipo consolida 12 familias publicadas en las categorías `Altares` y `Otras piezas`.

- Variables: Altar chico, Altar chico con arco, Altar mediano, Altar mediano con arco, Altar grande, Altar grande con arco, Altar gigante y Nicho.
- Simples: Altar para mascotas, Cruz con alas, Ropero mini de revelación y Alcancía reto de ahorro.
- Cada variable usa el atributo local `Acabado`, con `Natural` y `Pintado`, y SKUs hijo deterministas `-NAT` y `-PIN`.
- El antiguo producto simple Altar chico natural se integra como `LM-ALT-CHI-NAT`; no existe un segundo producto Altar gigante natural.
- El inventario, peso, dimensiones y tiempo de elaboración se comparten inicialmente en el padre. WooCommerce permite independizarlos después en cada variación.
- `stock` descuenta unidades; `made_to_order` permanece vendible y muestra días de elaboración. Las piezas marcadas para envío separado generan bultos independientes.

`data/catalog.csv` guarda precios explícitos por acabado. Natural conserva el precio demo previo y Pintado contiene un valor inicial de +20% redondeado al peso; no existe una regla de recálculo y ambos quedan editables por separado en WooCommerce.

## Fotografías

Las rutas `natural_images`, `painted_images` e `images` apuntan a copias curadas bajo `productos/catalogo/`. Cada archivo es WebP de 800×1000 sobre lienzo blanco; los originales de `productos/` no se sobrescriben. Las vistas de medidas se conservan como material secundario.

Cuando no hay una fotografía atribuible al modelo y acabado, la variación recibe su propio adjunto “Foto próximamente”. En variaciones de una sola imagen, el mismo ID ocupa portada y campo de galería: WooCommerce lo deduplica al renderizar y la presencia del campo evita que herede imágenes del acabado padre. El padre conserva la galería del acabado predeterminado para evitar cambios de disposición al cargar.

WooCommerce 10.9.4 almacena portada y galería con su CRUD oficial (`image_id` y `gallery_image_ids`). La función `wc_feature_woocommerce_additional_variation_images_enabled` se activa durante el bootstrap. El tema conserva el bloque nativo `woocommerce/product-image-gallery`; no hay galería, shortcode ni JavaScript propio.

Precios, medidas, pesos, existencias, tiempos de elaboración, asignación de fotos y acabados disponibles siguen pendientes de validación de la clienta.
