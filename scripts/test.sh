#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

npm run test:frontend

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
else
  compose=(docker-compose)
fi

find wp-content -name '*.php' -print0 | xargs -0 -n1 php -l
"${compose[@]}" run --rm wpcli core verify-checksums
"${compose[@]}" run --rm --entrypoint php wpcli -d memory_limit=512M /usr/local/bin/wp plugin verify-checksums woocommerce woocommerce-mercadopago
"${compose[@]}" run --rm --entrypoint php wpcli -d memory_limit=512M /usr/local/bin/wp lm doctor
