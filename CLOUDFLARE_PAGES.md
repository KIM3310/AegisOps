# Cloudflare Pages Deploy

- Root directory: `.`
- Build command: `npm ci && npm run build`
- Output directory: `dist`
- `wrangler.toml` is checked in for the Pages project name and output directory.

Notes:
- The Pages build is intentionally zero-cost and static-only.
- When `/api/*` is not present, the frontend falls back to deterministic local demo analysis, replay-suite scoring, and demo follow-up/export flows.
- Use the local Express API when you need Gemini BYOK, runtime key controls, or live backend routes.

AdSense/Review automation:
- `tools/release_ops.sh cloudflare`
- `tools/release_ops.sh apply-adsense <ca-pub-xxxxxxxxxxxxxxxx> <slot-id>`
- `tools/release_ops.sh check`
