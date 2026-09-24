# Response workspace release evidence — 2026-09-24

The owner explicitly delegated the remaining release decision and authorized code changes, deployment and merging PR #50. The existing Pages architecture is retained. Acceptance requires real remote authentication, lifecycle, exact exports, bounded inputs, concurrent-write protection, quotas and safe failures. Exact request-correlated CPU measurement is not claimed: [Pages metrics](https://developers.cloudflare.com/pages/functions/metrics/) aggregate sampled quantiles. Recorded wall duration is not CPU duration. No billing plan was changed.

## Remote preview evidence

Preview deployment: `bb270615-3f92-45ac-a208-a5efaee10745` at <https://bb270615.aegisops-ai-incident-doctor.pages.dev>, alias <https://pr-50-proof.aegisops-ai-incident-doctor.pages.dev>. The deployed runtime is the reviewed response adapter with the TLS repair at `65b37052549724073444ea018ffdb83831dd1909`; the configuration additionally binds the new isolated preview database. Subsequent changes add this proof command and documentation, not a different production authority.

At `2026-09-24T04:39:06.550Z`, **10 remote proof groups and 69 HTTP requests passed**. Preview fixtures were removed afterward.

| Evidence | Result |
| --- | --- |
| Configuration | Distinct preview/production D1 IDs, both migrated; encrypted independent token and signing-secret bindings; `fail_open=false` in both environments. |
| Authentication | HTTPS token login; Secure/HttpOnly/SameSite=Strict one-hour cookie; missing/foreign Origin, cross-site requests, wrong token, OIDC, expired/tampered/foreign-audience cookies rejected. |
| Lifecycle | Create, begin, complete and request-changes; authoritative reread; exact Markdown, JSON and Hancom JSON exports. |
| Integrity/concurrency | Retained source/digest validation matches the native domain. Two same-revision reviews yield 200/409 and one event. |
| Maximum input | Exact 262144-byte multibyte request; all 50,000 log characters retained; reviewed aggregate 717,125 bytes; read/review/all exports succeed. Oversized declared/streamed bodies and invalid domain bounds are rejected without persistence. |
| Safe failure | A real preview D1 trigger rejects a write; the API returns JSON503, hides storage internals and preserves the last confirmed revision. |
| Quotas/capacity | Last-unit login200/429 and mutation201/429 races; daily limits; 99-to100 capacity201/409 race. Full storage has no misleading Retry-After. |
| Cleanup | Logout clears the cookie. Run-owned fixtures and trigger removed; preview returns to zero cases. Production records are not touched by this suite. |
| Browser | The deployed page advertises shared D1 review and token login. Synthetic analysis succeeds; unauthenticated review remains disabled. Authenticated browser/lost-reply behavior is additionally covered by the local HTTPS proof. |

Local build inspection SHA-256 identities (Wrangler recompiles the Function during upload, so the inspection Function hash is not claimed as the uploaded runtime hash):

- Locally inspected API Function bundle: `bf85ae2397a880443802f935ee315ca988cbc45a691d4b7e3f1c8a82affcd88c`.
- Browser entry: `52be5908c7db49e0bad0d80447ffce53293cb5ea8ff2f95dd6465cb3247cda4b`.
- API-only route manifest: `513f89787b83f3e2df460f9a9bcfe265c2356fdb9c2a123eaa6a6218506a06f7`.

The TLS repair passed 538 tests in 47 files, 32 replay checks and 19 local HTTPS/Workerd/D1/browser proof groups. Prior local evidence is preserved in [the historical verification record](CLOUD_RESPONSE_VERIFICATION.md); its original open gates are superseded by this release decision and remote evidence.

This remains one authenticated shared synthetic workspace. These results do not certify personal identity, tenant isolation, institutional integration, native HWP generation, account-wide Free-plan capacity or availability under hostile load. The [runbook](CLOUD_RESPONSE_RUNBOOK.md) retains explicit operations and cleanup boundaries.
