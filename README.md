# Lupita Márquez Ecommerce

Tienda WooCommerce desarrollada con un tema de bloques propio y un plugin de negocio para catálogo y operación comercial.

## Inicio rápido

Requisitos: Docker con Compose y permisos para acceder al daemon.

```bash
cp .env.example .env
make bootstrap
```

- Tienda: <http://localhost:8088>
- Administración: <http://localhost:8088/wp-admin>
- Correo local: <http://localhost:8025>
- Usuario demo: `admin`
- Contraseña demo: `admin-local-only`

Los precios, dimensiones, existencias, fotografías faltantes y datos fiscales son demostrativos. El archivo `data/catalog.csv` es la fuente repetible del prototipo y se puede reimportar sin duplicar productos.

## Arquitectura

- WordPress 7.0.2 / PHP 8.3 / MariaDB 10.11.
- WooCommerce 10.9.4 y Mercado Pago 8.9.1 fijados para la matriz inicial.
- Tema FSE `lupita-marquez`, sin tema padre ni constructor visual.
- Frontend code-first con fuentes modulares en `src/` y un único build público generado por `@wordpress/scripts`.
- Plugin `lm-commerce`: importación de catálogo, reglas de tienda y compatibilidad administrativa con Envia.
- Las credenciales nunca se versionan: Envia.com se administra desde la zona de envío, Mercado Pago desde su plugin oficial y el correo desde WP Mail SMTP.

La tienda incluye checkout de una sola página, carrito/checkout de bloques y 12 familias: ocho productos variables con acabados Natural/Pintado y cuatro simples. Las variaciones usan la galería nativa opt-in de WooCommerce 10.9.4, sin plugins ni scripts de galería propios. También incluye inventario mixto, cupón demo y envío gratuito condicional. En producción, las tarifas, guías, cancelaciones y avisos de rastreo los opera exclusivamente el plugin oficial **Envia Shipping and Fulfillment**; `lm-commerce` no duplica esas solicitudes.

## Comandos

```bash
make up
make down
make test
make logs
```

Para trabajar en el frontend:

```bash
npm install
npm run start           # compilación incremental
npm run build           # build de producción
npm run prepare:catalog-images # recrea copias WebP sin tocar los originales
npm run audit:frontend  # capturas y métricas en reports/frontend
```

El auditor acepta `LM_BASE_URL`, `LM_AUDIT_OUTPUT` y `CHROME_PATH`. Recorre la página antes de capturarla y reporta por viewport (1440, 1024, 768 y 390 px) bordes de bandas anchas, overflow, CLS, consola, imágenes rotas y objetivos táctiles. Carrito, checkout, inventario y pagos permanecen en los bloques y APIs oficiales de WooCommerce; el tema no reescribe su DOM.

`make reset` elimina los volúmenes locales y requiere volver a ejecutar `make bootstrap`.

En producción el catálogo se administra desde WooCommerce: la clienta puede cambiar precio, inventario, portada y galería dentro de cada variación sin tocar el CSV ni el tema. `data/catalog.csv` sólo es la fuente repetible del entorno demo; volver a ejecutar `make bootstrap` restaura esos valores.

Las fotografías originales permanecen intactas en `productos/`. Las copias catalogables viven en `productos/catalogo/` como WebP de 800×1000, y Docker monta `./productos` directamente en `/client-assets`; ya no depende de un directorio hermano.

## Producción

Antes de desplegar se deben reemplazar los datos demo, confirmar IVA, origen, embalajes, textos legales y credenciales. La matriz de WordPress/WooCommerce/Mercado Pago debe repetirse contra las versiones soportadas en la fecha de lanzamiento. Mercado Pago se vincula desde su plugin oficial; Envia.com se conecta sólo en producción mediante **Envia Shipping and Fulfillment**; y el correo de pedido se entrega desde WP Mail SMTP.

Consulta [docs/launch-checklist.md](docs/launch-checklist.md) para el traspaso a Hostinger.
