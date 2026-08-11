# Checklist de lanzamiento

## Información pendiente de la clienta

- Aprobar nombres, precios independientes de Natural/Pintado, dimensiones, pesos, inventario inicial y tiempos de elaboración.
- Confirmar qué fotos corresponden a cada modelo y acabado, y entregar las marcadas “Foto próximamente”; el mapeo actual es una propuesta demo.
- Entregar domicilio real de recolección, teléfono y correo operativo.
- Definir monto/condiciones definitivas de envío gratuito y promociones.
- Entregar credenciales de producción de Mercado Pago y Envia.com.
- Validar razón social, régimen, tratamiento de IVA, aviso de privacidad, devoluciones y términos con sus asesores.
- Confirmar WhatsApp, correo, redes sociales y dominio.

## Validación técnica antes de Hostinger

- Repetir la matriz de compatibilidad de WordPress, WooCommerce y Mercado Pago en la fecha de publicación.
- Crear staging en el hosting administrado y probar PHP, cron/Action Scheduler, correos y HPOS.
- Configurar HTTPS, backups diarios, caché compatible con carrito y exclusiones de checkout/mi cuenta.
- Configurar Envia.com primero en sandbox; verificar cotización, guía PDF, cancelación y rastreo con Estafeta.
- Ejecutar un pedido completo de cada tipo: stock, bajo pedido y producto con envío separado.
- En los cuatro viewports, comprobar Altar chico (Pintado por defecto y cambio a Natural), Altar gigante (Natural por defecto y placeholder Pintado) y la separación entre Altar mediano con/sin arco.
- Comprobar que las variaciones sin foto no heredan otra galería y que precio, SKU y acabado elegidos llegan a carrito y checkout.
- Confirmar desde Productos > Variaciones que la clienta puede editar portada, galería, precio e inventario sin código.
- Probar Mercado Pago con tarjetas de prueba y después una transacción real de importe bajo.
- Verificar impuestos, total, devolución, cupón y envío gratuito.
- Retirar el aviso de demostración sólo después de aprobar contenido y datos.
- Ejecutar `make test` y revisar que no queden tareas fallidas en WooCommerce > Estado > Acciones programadas.

## Política mínima de plugins

Producción parte únicamente de WooCommerce, Mercado Pago y `lm-commerce`. No se requiere constructor visual, plugin de variaciones, plugin de checkout, plugin de snippets ni plugin de guías. Cualquier dependencia nueva debe justificar una función que no cubran WooCommerce, el tema o el plugin propio.
