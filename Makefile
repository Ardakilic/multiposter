COMPOSE = docker compose
RUN = $(COMPOSE) --profile dev run --rm dev

.PHONY: help install dev test lint typecheck build db-generate shell up down logs clean
.DEFAULT_GOAL := help

help: ## List targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## npm ci inside the dev container
	$(RUN) npm ci
dev: ## Dev server on http://localhost:3000
	$(COMPOSE) --profile dev run --rm --service-ports dev npm run dev
test: ## Tests with coverage (Postgres + S3Mock via compose network)
	$(RUN) npm test -- --coverage
lint: ## ESLint
	$(RUN) npm run lint
typecheck: ## tsc --noEmit
	$(RUN) npx tsc --noEmit
build: ## next build
	$(RUN) npm run build
db-generate: ## Generate a migration into drizzle/
	$(RUN) npx drizzle-kit generate
shell: ## Shell in the dev container
	$(RUN) sh
up: ## Build and start the production image (app, db, s3mock)
	$(COMPOSE) up --build -d
down: ## Stop the stack
	$(COMPOSE) down
logs: ## Follow app logs
	$(COMPOSE) logs -f app
clean: ## Stop everything and delete volumes (DB data, dev node_modules)
	$(COMPOSE) --profile dev down -v
