COMPOSE := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

.PHONY: up down bootstrap build watch test audit-frontend logs shell reset

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

bootstrap:
	./scripts/bootstrap.sh

test:
	./scripts/test.sh

build:
	npm run build

watch:
	npm run start

audit-frontend:
	npm run audit:frontend

logs:
	$(COMPOSE) logs -f wordpress

shell:
	$(COMPOSE) exec wordpress bash

reset:
	$(COMPOSE) down --volumes
