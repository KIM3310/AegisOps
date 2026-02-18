# Cloudflare Pages Deploy

- Root directory: `.`
- Build command: `npm ci && npm run build`
- Output directory: `dist`

AdSense/Review automation:
- `tools/release_ops.sh cloudflare`
- `tools/release_ops.sh apply-adsense <ca-pub-xxxxxxxxxxxxxxxx> <slot-id>`
- `tools/release_ops.sh check`
