# Review Guide - AegisOps -- Multimodal Incident Review System

Updated: 2026-05-30

Use this page as the short path through the repository. It keeps the review grounded in the code, docs, commands, and boundaries that are already present.

## Summary

| Field | Notes |
|---|---|
| Lane | B2B incident operations cockpit |
| Core idea | A replayable incident review cockpit that turns logs and screenshots into structured handoff evidence. |
| Primary reader | SOC leads, IT operations managers, MSP incident teams, and infrastructure owners with noisy handoffs. |
| Stack | TypeScript/JavaScript, Terraform, Cloudflare, Docker |

## Open First

1. Start with the README fast path and architecture section.
2. Open `docs/service-launch-playbook.md` only when reviewing the product or service angle.
3. Check the commands below before making claims about quality.
4. Skim the CI workflows and fixture data before deeper implementation review.
5. Read the boundaries section before presenting the project externally.

## Checks

| Purpose | Command |
|---|---|
| Full local gate | `npm run verify` |
| Test suite | `make test` |
| Typecheck | `npm run typecheck` |
| Production build | `npm run build` |

## CI

- .github/workflows/architecture-blueprint.yml
- .github/workflows/ci.yml
- .github/workflows/cloudflare-fleet-pages.yml
- .github/workflows/dependency-review.yml
- .github/workflows/pages-auto-deploy.yml
- .github/workflows/production-smoke.yml
- .github/workflows/repository-health.yml
- .github/workflows/repository-surface.yml
- .github/workflows/secret-scan.yml

## Evidence

- package scripts and web/runtime checks
- infrastructure-as-code review surface
- edge deployment configuration
- containerized delivery path
- Replay eval suite passes
- Review smoke script passes
- Demo mode works without provider keys

## Commercial Notes

| Possible offer | Working scope assumption |
|---|---|
| Incident-review tabletop package | $2k-$5k tabletop workshop |
| Managed replay/eval setup for customer incidents | $8k-$20k implementation pilot |
| Monthly incident-quality scorecard and operator handoff review | $1.5k-$6k/month managed review support |

## Boundaries

- No production tenant claims without integration
- Provider keys stay server-side only
- Customer logs require retention and redaction policy

## Useful Metrics

- Time-to-report reduction
- Handoff completeness score
- Replay eval pass rate
