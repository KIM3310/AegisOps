# AegisOps Discovery Guide

## Best-fit customer signals

- incident architectures rely on screenshots, chat snippets, and partial logs
- on-call teams already have telemetry but handoff quality is weak
- the technical reader wants a safe copilot adoption path instead of immediate autonomy

## Discovery questions

1. How long does it take to build a usable incident handoff after evidence is collected?
2. Which systems own the final incident artifact today: Slack, Jira, docs, slides, or ticket comments?
3. What must stay inspectable even if the model path is degraded?
4. Which inputs are most common during active incidents: logs, screenshots, alerts, chat threads?
5. What export target matters first?

## Demo path

1. show `/api/healthz`
2. show `/api/summary-pack`
3. run one multimodal incident
4. open `/api/schema/report`
5. show export-ready output

## Success criteria

- confidences the report structure
- operator can explain runtime mode and trust boundary
- replay proof supports quality claims
- export target receives a stable artifact

## Follow-up artifacts

- `docs/solution-architecture.md`
- `docs/executive-one-pager.md`
- `docs/INCIDENT_REPLAY_EVALS.md`
- `docs/summary-pack.svg`
