export PATH := $(HOME)/.cargo/bin:$(PATH)
CARGO := $(or $(wildcard $(HOME)/.cargo/bin/cargo),cargo)
export DATABASE_URL ?= postgres://relay:relay_local_only@127.0.0.1:55478/relay
.PHONY: setup dev api check db desktop desktop-build plow-check context-check tools-check
setup:
	npm ci --prefix web
	npm exec --prefix web -- playwright install chromium
	$(MAKE) db
	node scripts/prepare-e2e-db.mjs

db:
	docker compose up -d --wait db

dev:
	node scripts/dev.mjs

api:
	$(CARGO) run -p relay-api

check:
	$(MAKE) plow-check
	$(MAKE) context-check
	$(MAKE) tools-check
	$(CARGO) fmt --all --check
	$(CARGO) clippy -p relay-api --all-targets -- -D warnings
	$(CARGO) test -p relay-api
	$(CARGO) build -p relay-api
	npm run build --prefix web
	node scripts/prepare-e2e-db.mjs
	npm run test:e2e --prefix web
	npm run test:guest --prefix web
	npm run test:runner --prefix web
	npm run test:compatibility --prefix web

desktop:
	npm run tauri --prefix web -- dev

desktop-build:
	npm run tauri --prefix web -- build --debug

plow-check:
	python3 -m unittest discover -s integrations/plow -p 'test_*.py' -v

context-check:
	python3 -m unittest discover -s integrations/context-harness -p 'test_*.py' -v

tools-check:
	python3 -m unittest discover -s integrations/relay-tools -p 'test_*.py' -v
