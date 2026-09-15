# Guía rápida para operar la tienda

Usa un usuario de WordPress con rol **Administrador** para cambiar credenciales. Un **Gestor de tienda** puede operar pedidos, inventario y estados, pero no debe modificar la configuración técnica.

## Cobros con Mercado Pago

1. Ve a **WooCommerce > Mercado Pago**.
2. Conecta primero las credenciales de prueba y realiza un pedido de sandbox.
3. Al aprobar el lanzamiento, conecta la cuenta de producción de la tienda y confirma que el modo de pruebas esté desactivado.

## Envíos con Estafeta / Envia.com

1. Sólo en el dominio de **producción**, instala y conecta **Envia Shipping and Fulfillment** con la cuenta definitiva de la clienta.
2. Ve a **WooCommerce > Ajustes > Envío > Zona México** y agrega el método **Envia Tarifas y Envío**.
3. Configura el origen, los embalajes y las opciones de Estafeta desde el plugin oficial y la cuenta de Envia.
4. Genera la guía manualmente después de revisar dirección, paquete y tarifa.
5. En Envia > **Notificaciones > Para tus clientes**, activa el email gratuito **Etiqueta creada** para que el cliente reciba su rastreo.

No configures el plugin oficial en staging: Envia lo opera únicamente en producción. `lm-commerce` no cotiza ni genera guías en el dominio final, para evitar solicitudes o cargos duplicados.

## Correos

1. Ve a **WP Mail SMTP > Settings**.
2. Selecciona el proveedor o SMTP de la cuenta de la tienda, guarda y envía un correo de prueba desde **Tools > Email Test**.
3. Antes de lanzar, confirma SPF, DKIM, remitente y recepción fuera del dominio.

El correo de confirmación del pedido sale de WooCommerce mediante WP Mail SMTP. El correo de guía sale directamente desde las notificaciones de Envia; son flujos independientes.

## Lanzamiento

Prueba Mercado Pago con cuentas y tarjetas de prueba antes de abrir la tienda. Cuando la cuenta definitiva de Envia esté conectada, la primera guía real valida el aviso “Etiqueta creada”. No uses una cuenta temporal de Envia para esa prueba: una cancelación devuelve el saldo a esa misma cuenta.
