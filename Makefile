.SHELLFLAGS := -eu -o pipefail -c

.PHONY: install dev typecheck test build verify ci demo-local

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

verify:
	npm run verify

ci: install verify

demo-local:
	npm install && npm run dev
