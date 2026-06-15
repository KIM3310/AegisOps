# AegisOps Executive One-Pager

## Problem

During a SEV1, teams usually have enough telemetry. They do not have enough time to convert that telemetry into a report another operator can trust.

## What AegisOps changes

- compresses screenshot + log evidence into a inspectable incident report
- exposes a deterministic replay evidence path before technical readers trust the live model path
- keeps provider secrets off the browser
- separates reasoning, architecture, and export surfaces

## Technical reader value

- faster incident handoff
- cleaner escalation notes
- less manual report formatting during active incidents
- safer adoption path because architecture surfaces remain usable in demo or local mode

## Metrics that matter

- time from raw evidence to first structured report
- replay-eval pass rate
- export-ready incident count
- operator follow-up time after initial report creation

## Rollout plan

1. `Architecture-only`
   - use replay pack, schema, and static exports
2. `Operator assist`
   - use live analyze + follow-up
3. `Integrated incident handoff`
   - enable Slack/Jira/Workspace export paths

## Objections

- `Can we trust a live model during a major incident?`
  - Start with replay-backed architecture mode and explicit schema checks.
- `What if the provider is unavailable?`
  - Demo and local modes preserve the evaluation path.
- `How do we keep this from becoming another opaque copilot?`
  - Summary pack, schema, and replay summary are first-class surfaces.

## Best evidence path

- `/api/summary-pack`
- `/api/evals/replays`
- `/api/schema/report`
- `docs/summary-pack.svg`
- `docs/solution-architecture.md`
