# Local cloud response verification

Historical record. The owner-authorized 2026-09-24 release decision, TLS repair and real remote proof are recorded in [the release evidence](CLOUD_RESPONSE_RELEASE_2026-09-24.md). The open gates below describe the state on 2026-09-16, not the current release status.

Verified on 2026-09-16 against implementation commit `60f3070f7709a03de5207bd3e07a65237a940cf3`. This record covers local behavior only. It does not establish remote Free-plan CPU fit, Cloudflare quota entitlement, deployment, or production readiness.

## Results

| Check | Observed result |
| --- | --- |
| `npm run verify` | Typecheck passed. 46 test files and 534 tests passed. Replay checks32/32 passed. Native HTTP architecture smoke and production build passed. |
| `npm audit --json` | Zero vulnerabilities at every severity. No audit suppression or forced peer install. |
| `npm run cloud:build` | Pinned Wrangler compiled106 inputs. Actual bundle excludes the native server, store and auth modules. Asset routing includes only `/api` and `/api/*`. |
| `npm run cloud:proof -- <owned-output>` | 14 real local HTTPS/Workerd/D1 groups passed. |
| `npm run cloud:proof -- <owned-output> --browser` | 18 groups passed, including fresh isolated Chrome profiles for cloud, missing-configuration, static-only and native modes. |
| Native preservation | Server wiring, native router, file store, operator access/session, shared schema and synthetic catalog are unchanged. The shared renderer has only the neutral storage notice change. |
| Cleanup | Owned servers stopped. The synthetic `.dev.vars` file and browser profiles were removed. No listener remained on ports8788,8787,3000,4173. |

The backend proof includes authenticated create/read, both review outcomes, every persisted export, restart durability, exact evidence/source digests, independent HTTP CAS200/409 and cap201/409 races, last-quota-unit races, strict cookie/Origin failures, byte/domain/gap limits, complete-aggregate corruption, D1 write failure, and valid future-record clock rollback rejection.

The maximum multibyte fixture submitted exactly `262144` bytes. Its reviewed aggregate was `717119` bytes. All50,000 log characters and three inspection plans remained intact. Local elapsed time was recorded only as local wall time, not cloud CPU.

Chrome completed token login, synthetic analysis, review, three downloads and authoritative reopen. An actual D1 trigger failure kept the prior revision with an unconfirmed warning. A forwarded review committed before its intercepted reply was lost. The browser kept revision1 until deliberate refresh revealed revision2, with no automatic mutation retry. Static and missing-configuration modes disabled review but retained synthetic analysis. The native loopback path created local-demo reviews and reopened exported revision3.

## Failing-first and probe corrections

Failing-first logs were retained for the absent authority/HTTP adapter, capability and session UI, uncertain-write handling, the extra native intro login, and pending-health runtime-key controls. The later green checks cover each change.

Probe-only corrections were also retained. Node ICU used `AM`/`PM` where Workerd used `오전`/`오후` in one generated Korean timestamp. The comparison permits only that display spelling difference. The large corruption fixture needed SQL-side construction because D1 rejected a megabyte SQL literal. Browser automation needed to wait for session discovery and use the existing Start New route before reopening a case after a report-context reload. The static probe needed a Vite configuration without the native API proxy. Vite readiness matching needed ANSI stripping. None of these corrections weakened production validation.

The build retains its existing large-chunk warning at about508 kB for the browser entry. The warning was not suppressed.

## Owner release gates still open

- Replace the distinct local preview/production D1 placeholders with separate real database IDs.
- Manage real high-entropy secrets outside source and reports.
- Apply migrations and verify actual Pages critical-function fail-closed behavior.
- Repeat the remote synthetic lifecycle, races, auth, exports and failure checks.
- Measure actual Cloudflare CPU/quota outcomes at retained maximum input before production promotion.
- Complete independent full-diff review and the authorized publication/deployment process.

The reproducible commands and cleanup boundaries are in [the runbook](CLOUD_RESPONSE_RUNBOOK.md). The adapter limits and security tradeoffs are in [the reference](CLOUD_RESPONSE_WORKSPACE.md). Local logs, machine-readable results, screenshots, downloads and full patch identities are supplied separately in the implementation handoff.
