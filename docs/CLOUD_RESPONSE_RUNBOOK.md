# Verify the response adapter and prepare an owner release

Use synthetic data only. Do not copy personal credentials or existing runtime records into this procedure. Local proof and remote proof are separate commands. Remote creation, settings, secrets, migration and deployment require an owner-authorized operator; the 2026-09-24 release was explicitly authorized.

## Run the local proof

1. Use a clean checkout with Node22.12 or newer. Keep existing `.env` and `.dev.vars` files out of that checkout. The proof checks filenames and refuses private local config without reading it.
2. Install the locked dependencies.

```sh
npm ci
```

3. Run the native regression suite and dependency audit.

```sh
npm run verify
npm audit
```

4. Compile and inspect the API-only Functions bundle.

```sh
npm run cloud:build
```

The checker requires `dist/_routes.json` to include only `/api` and `/api/*`. It checks the generated catch-all route and excludes the native server/auth/store from actual bundle inputs.

5. Run the real local HTTPS/Workerd/D1 proof.

```sh
npm run cloud:proof -- .wrangler/response-evidence
```

The script creates a fresh owned directory, synthetic local secrets, an isolated Wrangler home, and local D1 state. Every D1 command includes `--local`. It removes its `.dev.vars` file and stops its processes on exit. It never uses a remote database. It retains local synthetic fixtures, export documents, command logs, and a machine-readable `results.json`. `result` must be `PASS`.

6. To include Chrome interaction, point to an installed Chrome executable that the script may launch. Do not attach to an existing personal browser.

```sh
AEGISOPS_TEST_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npm run cloud:proof -- .wrangler/response-browser-evidence --browser
```

The browser uses new owned profiles and removes them on exit. It blocks external origins. The optional run also starts local Vite and the native demo API on ports4173,3000,8787. Keep these ports and Pages port8788 free. It verifies cloud, missing-configuration, static-only, and native behavior. Screenshots and downloads remain under the owned evidence directory.

The proof covers lifecycle, all exports, literal source/digest equality, restart durability, independent HTTP CAS/cap/quota races, body/domain bounds, maximum multibyte input, Origin/cookie attacks, rate-row cardinality, write failure, and rollback rejection. A separate local fault database holds impossible-by-production-schema corruption fixtures. The production migration is never weakened.

The Markdown comparison permits only the known Node ICU `AM`/`PM` versus Workerd `오전`/`오후` rendering of the generated Korean timestamp. All other export text, evidence, digest, history, and JSON fields must match the unchanged domain renderer.

## Start an interactive local demo

1. Complete `npm run build` and `npm run cloud:build`.
2. Create your own synthetic `.dev.vars`. Use different random values of at least32 bytes for `AEGISOPS_OPERATOR_TOKEN` and `AEGISOPS_OPERATOR_SESSION_SECRET`. Never commit this file or use a production credential.
3. Apply the local migration to a new owned state directory.

```sh
./node_modules/.bin/wrangler d1 migrations apply RESPONSE_DB --local --persist-to .wrangler/my-response-demo
```

4. Start Pages with HTTPS and that same local state directory.

```sh
npm run cloud:dev -- --persist-to .wrangler/my-response-demo
```

5. Open `https://127.0.0.1:8788` in a separate test browser profile. Accept only the expected local development certificate. Load the synthetic sample, log in with your synthetic token, analyze, and create a response case.
6. Stop Wrangler when finished. Remove only the synthetic configuration and local state that you created, if you no longer need them. Never remove existing data as part of this procedure.

## Prepare separate remote environments as the owner

1. Freeze and review the exact source commit, patch ID, bundle, asset hashes, and local results.
2. Verify the two different D1 IDs in `wrangler.toml` against the intended account. For a new installation, create separate databases and replace those IDs. Never point both environments at one database.
3. Apply the reviewed migration to the explicitly named preview database. Record environment, database ID, source commit, and migration result before proceeding.
4. Set independent high-entropy token and stable signing-secret bindings in each environment through the owner's secret management path. Do not put secrets in source, browser configuration, URLs, reports, or logs.
5. Configure Pages critical Functions to fail closed on runtime/quota failure. Verify an API failure cannot fall back to an apparently successful HTML asset.
6. Deploy only the reviewed preview with the pinned local Wrangler. Inspect route MIME/security headers, binding selection, source commit, and asset hashes at the deployed URL.
7. Repeat authenticated lifecycle, exact exports, restart/reopen, Origin/cookie tests, independent CAS/cap races, and safe failure checks on synthetic preview fixtures.
8. Record actual HTTP/runtime and quota outcomes for ordinary and maximum create/read/review/export requests. The owner-delegated release criterion is documented in [the release evidence](CLOUD_RESPONSE_RELEASE_2026-09-24.md). Do not label wall-clock duration as CPU time or claim exact request-level CPU measurements from Pages' sampled metrics. Successful bounded requests do not establish account-wide capacity under load.
9. If any bound exceeds Free resources, stop promotion. Propose a smaller cloud-only schema/UI limit. Do not drop integrity validation or enable billing.
10. Apply the reviewed production migration and promote only after preview evidence passes. Repeat a small production synthetic check and record deployment ID, URL, commit, UTC timestamp, statuses, revision, and export hashes. Do not retain cookies or credentials.

The repository's own CI uses Node22 and the pinned CLI. A successful build or a workflow that skipped missing Cloudflare credentials does not prove deployment. Verify the actual deployment ID, binding configuration and live response capability.

## Explicit remote preview proof

`npm run cloud:remote-proof -- <owned-output>` performs real network requests and writes synthetic preview fixtures. It is not run by ordinary CI or `cloud:proof`. Supply the account/API token, `AEGISOPS_PREVIEW_DATABASE_ID`, and the preview `AEGISOPS_OPERATOR_TOKEN` / `AEGISOPS_OPERATOR_SESSION_SECRET` through a private environment, never command-line arguments or committed files.

The command only targets `https://pr-50-proof.aegisops-ai-incident-doctor.pages.dev`. It checks the Pages preview binding, a different production binding, both fail-closed settings and the exact preview database name. It refuses an existing nonempty workspace before writing. Use a dedicated, unused preview environment; this suite modifies preview quota rows and installs a temporary write-failure trigger.

The suite covers remote authentication, exact exports, both review outcomes, CAS and capacity races, rate limits, actual D1 failure, and the retained 256KiB multibyte boundary. It records status codes, Cloudflare request IDs and explicitly labelled wall durations. It removes only case fixtures tagged with its unique run ID, drops its test trigger and clears test quota state on exit. Unexpected unrelated records are reported rather than deleted. Inspect `result` and `fixturesRemoved` in `results.json`; both must indicate success before promotion.

## Reset a full workspace only with fresh authorization

1. Name the exact environment and database ID in the reset request. State that all response cases in that database will be lost.
2. Obtain fresh owner authorization. Review whether an approved synthetic-data export or backup is needed. Do not claim an untested restore procedure.
3. Confirm that the selected ID is not the other environment. Record the current count and authorization reference.
4. Execute only the reviewed owner operation on that one database. There is no reset route or automatic expiry in the application. A reset must not silently delete records in the other environment.
5. Record the result, UTC timestamp, selected database ID, and post-operation count. Run an authenticated synthetic create/read check.

Do not execute a remote reset as part of local verification or deployment retry.

## Roll back code without making a data claim

1. Retain the previous reviewed Pages deployment as the code rollback target.
2. Verify that the old domain understands the currently stored catalog/schema before switching code.
3. Treat migration and case recovery as a separate authorized operation. A code rollback does not undo D1 migrations or restore case records.
4. Recheck exact exports, auth, and mutation rejection after rollback. Stop if the bundled synthetic catalog no longer validates stored content.
