# Checklist de lanzamiento

## Entornos y despliegue

- Instalar WordPress en el dominio final con mantenimiento activado, crear un backup y generar `staging.<dominio>` desde hPanel. Proteger staging del acceso público e indexación, dejando accesible únicamente el endpoint de webhook de Mercado Pago.
- No usar **Publish** de staging después de recibir pedidos reales: Hostinger sustituye archivos y base de datos de producción. Para el primer lanzamiento, publicar únicamente mientras el dominio final siga en mantenimiento y sin pedidos.
- Configurar `WP_ENVIRONMENT_TYPE=staging` o `production` y credenciales administrativas únicas; nunca conservar el usuario ni contraseña demo.
- Desplegar una versión verificable del repositorio: ejecutar `npm run test:frontend` y `make test`, generar el build desde `src/` y no editar `build/` manualmente.
- Configurar cron real en Hostinger para ejecutar la cola de WooCommerce/Action Scheduler, backups diarios y caché con exclusiones de carrito, checkout y mi cuenta.

## Información pendiente de la clienta

- Aprobar nombres, precios independientes de Natural/Pintado, dimensiones, pesos, inventario inicial y tiempos de elaboración.
- Confirmar qué fotos corresponden a cada modelo y acabado, y entregar las marcadas “Foto próximamente”; el mapeo actual es una propuesta demo.
- Entregar domicilio real de recolección, teléfono y correo operativo.
- Entregar medidas y peso de cada producto **con su embalaje final**, además de confirmar cuáles viajan por separado.
- Definir monto/condiciones definitivas de envío gratuito y promociones.
- Entregar credenciales de producción de Mercado Pago y Envia.com.
- Validar razón social, régimen, tratamiento de IVA, aviso de privacidad, devoluciones y términos con sus asesores.
- Confirmar WhatsApp, correo, redes sociales y dominio. Crear el buzón autenticado del dominio para pedidos y el proceso/correo para solicitudes de factura.

## Validación técnica antes de Hostinger

- Repetir la matriz de compatibilidad de WordPress, WooCommerce y Mercado Pago en la fecha de publicación.
- Crear staging en el hosting administrado y probar PHP, cron/Action Scheduler, correos y HPOS.
- Configurar HTTPS, backups diarios, caché compatible con carrito y exclusiones de checkout/mi cuenta.
- Configurar WP Mail SMTP desde el administrador; validar SPF, DKIM, remitente y entrega a buzones externos.
- No instalar ni conectar Envia oficial en staging. En producción, instalar **Envia Shipping and Fulfillment**, conectar la cuenta definitiva, configurar origen/embalajes y añadir **Envia Tarifas y Envío** a la zona México.
- Limitar las opciones de envío a Estafeta y generar guías manualmente después de revisar pedido, dirección y tarifa.
- En Envia > Notificaciones > Para tus clientes, activar el email gratuito **Etiqueta creada** y revisar su historial tras la primera guía real.
- Ejecutar un pedido completo de cada tipo: stock, bajo pedido y producto con envío separado.
- En los cuatro viewports, comprobar Altar chico (Pintado por defecto y cambio a Natural), Altar gigante (Natural por defecto y placeholder Pintado) y la separación entre Altar mediano con/sin arco.
- Comprobar que las variaciones sin foto no heredan otra galería y que precio, SKU y acabado elegidos llegan a carrito y checkout.
- Confirmar desde Productos > Variaciones que la clienta puede editar portada, galería, precio e inventario sin código.
- Probar Mercado Pago con cuentas y tarjetas de prueba; confirmar pedido aprobado, webhook, estado Procesando y correo de confirmación recibido.
- Verificar impuestos, total, devolución, cupón y envío gratuito desde $2,000 MXN; por debajo debe mostrarse sólo la cotización real de Estafeta.
- La primera guía se genera sólo desde la cuenta definitiva de la clienta. Si se cancela antes de ser escaneada, el saldo vuelve a esa misma cuenta; no usar una cuenta temporal para esta prueba.
- Retirar el aviso de demostración sólo después de aprobar contenido y datos.
- Ejecutar `make test` y revisar que no queden tareas fallidas en WooCommerce > Estado > Acciones programadas.

## Política mínima de plugins

Producción parte de WooCommerce, Mercado Pago, WP Mail SMTP, **Envia Shipping and Fulfillment** y `lm-commerce`. No se requiere constructor visual, plugin de variaciones, plugin de checkout ni plugin de snippets. Cualquier dependencia nueva debe justificar una función que no cubran WooCommerce, el tema o el plugin propio.
