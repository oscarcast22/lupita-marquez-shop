# Modelo de catálogo

El inventario refleja las nueve carpetas de producto entregadas por la clienta. Cada carpeta corresponde a un **producto simple** y sus fotografías forman una sola galería; no se generan variantes de acabado.

- Categorías: Altares; Otras piezas.
- Altares reúne los altares por tamaño, el altar para mascotas y el nicho personalizado.
- Otras piezas reúne Cruz con alas y Ropero mini de revelación.
- `finish` es un dato informativo opcional, nunca un selector. Sólo Altar chico natural declara el acabado Natural porque así se identifica en el material fuente.
- Estado de inventario: `stock` descuenta unidades; `made_to_order` permanece vendible y muestra días de elaboración.
- Envío separado: piezas medianas, grandes o frágiles generan bultos independientes para cotización.

`data/catalog.csv` es la fuente editable y exacta de esos nueve productos. Precios, medidas, pesos y existencias continúan como datos demo visibles hasta que la clienta los valide.
