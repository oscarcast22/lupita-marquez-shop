#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

set -a
source .env
set +a

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
else
  compose=(docker-compose)
fi

"${compose[@]}" up -d db wordpress mailpit

until "${compose[@]}" run --rm wpcli core version >/dev/null 2>&1; do
  sleep 2
done

if ! "${compose[@]}" run --rm wpcli core is-installed >/dev/null 2>&1; then
  "${compose[@]}" run --rm wpcli core install \
    --url="http://localhost:${WP_PORT:-8080}" \
    --title="Lupita Márquez" \
    --admin_user="${WP_ADMIN_USER:-admin}" \
    --admin_password="${WP_ADMIN_PASSWORD:-admin-local-only}" \
    --admin_email="${WP_ADMIN_EMAIL:-admin@example.test}" \
    --skip-email
fi

"${compose[@]}" run --rm wpcli language core install es_MX --activate
"${compose[@]}" run --rm wpcli plugin install woocommerce --version=10.9.4 --activate
"${compose[@]}" run --rm wpcli plugin install woocommerce-mercadopago --version=8.9.1 --activate
"${compose[@]}" run --rm wpcli language plugin install woocommerce es_MX || true
"${compose[@]}" run --rm wpcli language plugin install woocommerce-mercadopago es_MX || true
"${compose[@]}" run --rm wpcli plugin activate lm-commerce
"${compose[@]}" run --rm wpcli theme activate lupita-marquez
"${compose[@]}" run --rm wpcli rewrite structure '/%postname%/' --hard
"${compose[@]}" run --rm wpcli lm demo seed --catalog=/var/www/html/wp-content/lm-data/catalog.csv
"${compose[@]}" run --rm wpcli media regenerate --yes
"${compose[@]}" run --rm wpcli rewrite flush --hard
"${compose[@]}" run --rm wpcli cache flush

printf 'Tienda: http://localhost:%s\n' "${WP_PORT:-8080}"
printf 'Admin:  http://localhost:%s/wp-admin\n' "${WP_PORT:-8080}"
printf 'Correo: http://localhost:8025\n'
