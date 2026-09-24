# Cloud response workspace reference

This adapter adds authenticated response review to a Pages site. Browser analysis stays synthetic. The native Express server and file store remain separate and unchanged, except for a storage-neutral export notice shared by both adapters.

This is one shared synthetic workspace. It is not tenant isolation, institutional identity, live AI, automatic remediation, encrypted evidence, a tamper-proof audit log, or native HWP/HWPX generation. Local proof does not establish remote Free-plan readiness.

## Ownership

- `functions/api/[[path]].ts` is the only Pages route entry.
- `edge/responseWorkspace.ts` owns web parsing, configuration, sessions, Origin checks, and safe responses.
- `edge/responseAuthority.ts` owns complete D1 create, read, review, and export operations.
- `migrations/0001_response_workspace.sql` owns the aggregate and four fixed rate rows.
- The existing `shared/responseCase.ts`, catalog, and `server/lib/responseWorkflow.ts` retain the domain rules.
- `public/_routes.json` includes only `/api` and `/api/*`. Assets bypass Functions. The build checker inspects the actual bundle inputs and compiled routing metadata.

The Function bundle does not import the Express application, file store, native operator auth, or native session module. It uses `node:crypto` through `nodejs_compat`.

## API

Every dynamic response sets `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The adapter sets no permissive CORS header. Every case operation requires a valid cloud cookie, including reads and exports.

| Method and path | Result |
| --- | --- |
| `GET /api/healthz` | Synthetic analysis posture plus separate review capability. No case data or durable write. |
| `GET /api/auth/session` | Strict safe active/inactive view. |
| `POST /api/auth/session` | Token-only login. Existing `{authMode, credential, roles}` shape. Roles grant no authority. |
| `DELETE /api/auth/session` | Clears this browser's cookie. |
| `POST /api/response-workflows` | Strict submission; 201 and the saved `ResponseCase`. |
| `GET /api/response-workflows/:id` | The complete validated aggregate. |
| `POST /api/response-workflows/:id/review` | Strict expected revision and command; committed aggregate only after successful SQL CAS. |
| `GET /api/response-workflows/:id/export` | Persisted Markdown by default, or `format=json` / `format=hancom-json`. |

Export rejects duplicate and unknown query parameters. It renders a fresh authoritative read, not a caller-supplied replacement. Hancom JSON contains unvalidated text placeholders, not a native document.

Unknown API paths return JSON404. Wrong methods on known paths return JSON405 with `Allow`. Unsupported analysis, model, OIDC, OAuth, and integration API routes are not full-backend capabilities.

| Status | Meaning |
| --- | --- |
| 400 | Invalid JSON, strict schema, UUID, or export query. |
| 403 | Missing/invalid login or rejected exact-origin mutation. |
| 404 | Missing case or unsupported API path. |
| 409 | Stale/invalid transition, or create capacity reached. Capacity has no `Retry-After`. |
| 413 | More than 256 KiB raw request or 1 MiB aggregate. No silent trim. |
| 415 | Non-JSON or unsupported encoded mutation body. |
| 422 | Completion blocked by missing evidence or missing acknowledgements. |
| 429 | Shared finite rate budget exhausted. Includes `Retry-After` seconds. |
| 500 | Stored aggregate fails full validation. |
| 503 | Missing configuration, unavailable/failed storage, or regressing clock. |

Network loss, timeout, malformed successful replies, and ambiguous write errors are unconfirmed results. The client preserves the last confirmed view and never retries a mutation automatically. Reopening an older case cannot confirm a lost create whose new ID never arrived. Only known pre-write rejection can establish no case write.

## Session boundary

Configuration requires `RESPONSE_DB`, `AEGISOPS_OPERATOR_TOKEN`, and a separate stable `AEGISOPS_OPERATOR_SESSION_SECRET`. Both secrets must contain at least 32 UTF-8 bytes and no more than 1,024 characters. They must differ. The owner supplies cryptographically random values; a length check cannot prove entropy. There is no default or per-isolate secret.

All mutations require HTTPS and an exact `Origin` equal to the request URL origin. Missing, `null`, foreign, and `Sec-Fetch-Site: cross-site` origins fail. Forwarded headers grant no exception.

The cookie is `__Host-aegisops_review_session`, with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no Domain, and a 3,600-second lifetime. Its readable signed payload contains only version, shared-token kind, exact origin audience, issued/expiry times, and a random nonce. It contains no credential, token hash, role, subject, or case ID.

A domain-separated HMAC key derives from the stable signing secret and configured token. Either secret's rotation invalidates existing sessions. Verification checks canonical base64url, signature, strict claims, UUID nonce, one-hour lifetime, expiry, exact audience, and at most 60 seconds of issued-time skew. Cookie headers above 8 KiB, duplicate session cookies, and values above 2 KiB fail.

Logout clears this browser's cookie. A copied cookie can remain valid until expiry. There is no individual session revocation or personal approval identity.

## Storage and limits

D1 stores one JSON aggregate per case, with UUID and revision columns. SQL checks reject invalid JSON, UTF-8 payloads above 1 MiB, and NULL/mismatched payload identity or revision. The application also validates the entire aggregate, canonical digest, rebuilt synthetic catalog/evidence, replayed review history, and cloud-only shared-token actors on every read. Privileged database editors can rewrite data and hashes. Hashes are not tamper-proof storage.

Creation uses one parameterized `INSERT ... SELECT ... WHERE COUNT(*) < 100`. Review uses one parameterized `UPDATE ... WHERE id = ? AND revision = ?`. Success requires exactly one changed row. There is no JavaScript lock, read-count-then-insert, KV authority, public list/reset API, or automatic case deletion.

Writes reject server time earlier than creation or the prior review event. They do not clamp or repair timestamps. The test suite uses valid future-dated fixtures, not HTTP clock overrides.

Input retains the existing limits of 50,000 JavaScript string characters, 1,000 lines, and 16 declared images. The stream reader independently caps raw UTF-8 input at 262,144 bytes before JSON parsing. Evidence images are not retained. Unmatched evidence and declared images remain blocking gaps. Cases have at most two review events and revisions1 through3.

The 100-case cap permits at most 100 MiB of aggregate payload plus SQLite overhead. It is a permanent capacity condition until an explicit owner reset. Waiting does not free space.

## Global rate budgets

| Fixed row | Cap | Window |
| --- | --- | --- |
| `login-minute` | 20 attempts | UTC minute |
| `login-day` | 120 attempts | UTC day |
| `mutation-minute` | 30 attempts | UTC minute |
| `mutation-day` | 400 attempts | UTC day |

Daily admission precedes minute admission. Each is one atomic upsert. Failed credentials and admitted schema/domain/cap/write failures consume their attempts. There are no refunds. A future rate window is not reset by a regressing clock. An exhausted slot read distinguishes rollback from a timed denial.

The key set is fixed at four rows. Expired windows replace those same rows. No IP addresses or session identifiers enter the rate table. Any visitor can exhaust the global login budget and deny login to others. This small-demo compromise is not DDoS protection.

An admitted login uses at most two queries. Create uses three, review four, and read/export one. A denied budget may need one extra slot read. Case insert counting can read up to100 rows. Normal application writes are bounded by 1,440 changed rows per day before owner operations and migrations. Denied requests still consume Worker invocations and can consume D1 reads. These figures do not prove account entitlement, Cloudflare internal accounting, CPU fit, or availability under attack.

## Browser capabilities

Cloud health retains `deployment: static-demo` for synthetic analysis. A separate `responseWorkflow` capability advertises configured token/D1 review. `configured` checks binding presence and secret format, not database health.

Static and unconfigured review controls are disabled. Cloud mode hides runtime-key, OIDC, and roles controls. Native health without the additive field retains unverified compatibility until a real request succeeds. Session probe failure offers explicit retry. Login enables deliberate create/reopen actions only.

Analysis first attempts its same-origin API before browser fallback. Case submission sends its report and logs to the server. The application does not claim that all input stays in the browser. Only the last response-case ID is stored locally; ordinary incident report history remains separate.

## Release boundary

Wrangler4.132.0, Workers types5.20260916.1, and Playwright core1.63.0 are exact development pins selected from available package metadata. Node22.12 or newer is required. Preview and production D1 IDs in `wrangler.toml` identify distinct remote resources. Tokens and signing secrets are encrypted Pages bindings and are absent from source.

The 2026-09-24 release uses the owner-delegated acceptance decision recorded in [the release evidence](CLOUD_RESPONSE_RELEASE_2026-09-24.md): real remote lifecycle, retained maximum input, races, quotas and safe error behavior, with separate bindings and fail-closed configuration. Pages exposes sampled CPU quantiles, not the exact request-correlated CPU proof previously requested. Neither local nor remote wall time is reported as CPU time. This bounded synthetic check is not a guarantee of Free-plan capacity or availability under load. Integrity checks remain intact and no paid upgrade was used as a fallback.

See [the local proof and owner runbook](CLOUD_RESPONSE_RUNBOOK.md).
