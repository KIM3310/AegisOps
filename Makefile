.SHELLFLAGS := -eu -c

.PHONY: install dev typecheck test build verify ci demo-local deploy-pages

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

deploy-pages: build
	npx --yes wrangler@latest pages deploy dist --project-name aegisops-ai-incident-doctor
