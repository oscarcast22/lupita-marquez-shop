# Modelo de catálogo propuesto

El inventario se organiza por **modelo/tamaño** como producto y por **acabado** como variación. Esto evita mezclar piezas con pesos, embalajes y tiempos de fabricación distintos.

- Categorías: Altares; Memoriales y mascotas; Regalos personalizados.
- Acabados: Natural y Pintado cuando existen ambos.
- Estado de inventario: `stock` descuenta unidades; `made_to_order` permanece vendible y muestra días de elaboración.
- Envío separado: piezas medianas, grandes o frágiles generan bultos independientes para cotización.
- Personalización: nombre/texto e imagen de referencia; el archivo privado se elimina 90 días después de completar, cancelar o reembolsar el pedido.

`data/catalog.csv` contiene 12 familias normalizadas desde el material recibido. Precios, medidas, pesos, existencias y asignación de imágenes son valores demo visibles como tales hasta que la clienta los valide.
