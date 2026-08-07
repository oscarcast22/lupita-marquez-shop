# Lupita Márquez Ecommerce

Tienda WooCommerce desarrollada con un tema de bloques propio y un único plugin de negocio para catálogo, personalización y logística Estafeta mediante Envia.com.

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

Los precios, dimensiones, existencias y datos fiscales son demostrativos. El archivo `data/catalog.csv` es la fuente editable del catálogo y se puede reimportar sin duplicar productos.

## Arquitectura

- WordPress 7.0.2 / PHP 8.3 / MariaDB 10.11.
- WooCommerce 10.9.4 y Mercado Pago 8.9.1 fijados para la matriz inicial.
- Tema FSE `lupita-marquez`, sin tema padre ni constructor visual.
- Plugin `lm-commerce`: personalización, importación, tarifa Estafeta, guías y estados de pedido.
- Las credenciales nunca se versionan; se configuran en `.env`.

La tienda incluye checkout de una sola página, carrito/checkout de bloques, inventario mixto (existencias y fabricación bajo pedido), variaciones Natural/Pintado, imágenes privadas para personalización, cupón demo, envío gratuito condicional y tarifa Estafeta con respaldo. Al cambiar un pedido a **Listo para enviar**, el plugin solicita una guía a Envia.com de forma asíncrona e idempotente.

## Comandos

```bash
make up
make down
make test
make logs
```

`make reset` elimina los volúmenes locales y requiere volver a ejecutar `make bootstrap`.

El catálogo se administra normalmente desde WooCommerce. Para cambios masivos durante esta etapa, edita `data/catalog.csv` y vuelve a ejecutar `make bootstrap`.

## Producción

Antes de desplegar se deben reemplazar los datos demo, confirmar IVA, origen, embalajes, tarifa de respaldo, textos legales y credenciales. La matriz de WordPress/WooCommerce/Mercado Pago debe repetirse contra las versiones soportadas en la fecha de lanzamiento.

Consulta [docs/launch-checklist.md](docs/launch-checklist.md) para el traspaso a Hostinger.
