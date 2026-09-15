# Runbook de Hostinger

Este documento prepara la cuenta de Hostinger para probar y publicar la tienda. Las credenciales nunca se guardan en Git ni se pegan en tickets o chats.

## Acceso seguro

1. En hPanel, habilita SSH y registra una clave pública de despliegue. No uses la contraseña FTP/SSH en automatizaciones.
2. Para automatización de hPanel, crea un token de API con vencimiento y permisos mínimos. Guárdalo sólo en el almacén de secretos del entorno que ejecute la CLI; nunca en `.env`, `wp-config.php` versionado o Git.
3. Instala la CLI oficial de Hostinger únicamente en el equipo de despliegue y autentícala mediante inicio de sesión en navegador o el token protegido. Verifica el sitio y recursos disponibles antes de cualquier escritura.

## Staging

1. Instala WordPress en el dominio final, mantenlo en modo mantenimiento y toma un backup completo.
2. En hPanel, crea `staging.<dominio>` desde WordPress > Staging. Activa HTTPS, evita indexación y restringe el acceso normal. El webhook exacto configurado por Mercado Pago debe quedar accesible y conservar su validación de firma.
3. Sube el tema, `lm-commerce` y los assets desde una versión del repositorio que haya pasado las pruebas. Carga en WooCommerce los datos finales, no el catálogo demo.
4. Define únicamente el entorno de WordPress en `wp-config.php`:

```php
define( 'WP_ENVIRONMENT_TYPE', 'staging' );
```

En staging, vincula Mercado Pago sólo con credenciales de prueba y configura WP Mail SMTP para validar el correo de pedido. No instales ni conectes el plugin oficial de Envia.com allí. Ninguna credencial se añade al repositorio ni a `wp-config.php`.

## Paso a producción

1. Aprobar la lista de `docs/launch-checklist.md`, hacer un backup nuevo y conservar mantenimiento en el dominio final.
2. Publicar el staging sólo si el sitio final aún no tiene pedidos. Conectar Mercado Pago con la cuenta de producción, confirmar HTTPS y vaciar caché.
3. Sólo en producción, instalar y conectar **Envia Shipping and Fulfillment** con la cuenta definitiva de la clienta, agregar **Envia Tarifas y Envío** a la zona México y activar su email **Etiqueta creada**.
4. Hacer la compra de prueba de Mercado Pago y la primera guía real desde la cuenta definitiva antes de abrir el sitio. A partir de la primera venta, desplegar cambios de código y datos de forma selectiva; no clonar ni publicar una base de datos completa desde staging.
