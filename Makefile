.SHELLFLAGS := -eu -o pipefail -c

.PHONY: install dev typecheck test build ci demo-local

install:
	npm ci

dev:
	npm run dev

typecheck:
	npm run typecheck

test:
	npm test

build:
	npm run build

ci: install typecheck test build

demo-local:
	npm install && npm run dev

