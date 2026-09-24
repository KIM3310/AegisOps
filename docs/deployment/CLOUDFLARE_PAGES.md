# Cloudflare Pages Deploy

- Root directory: `.`
- Build command: `npm ci && npm run verify && npm run cloud:build`
- Output directory: `dist`
- `wrangler.toml` is checked in for the Pages project name and output directory.

Notes:
- Pages serves browser-based synthetic analysis and the response-only `/api/*` Function. Authenticated response reviews persist in D1; live AI and native Express routes are not deployed.
- Production and preview use separate D1 databases and encrypted operator/session secrets. Both environments are configured to fail closed.
- When `/api/*` is absent, the frontend retains deterministic local analysis and disables shared review storage.
- Use the local Express API when you need Gemini BYOK, runtime key controls, or live backend routes.

See the [response runbook](../CLOUD_RESPONSE_RUNBOOK.md) and [remote release evidence](../CLOUD_RESPONSE_RELEASE_2026-09-24.md).

- `tools/release_ops.sh cloudflare`
- `tools/release_ops.sh check`
