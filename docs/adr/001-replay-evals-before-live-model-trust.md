# ADR-001: Replay Evals Before Live Model Trust

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-03-19 |
| Decision Maker | Doeon Kim |
| Category | Quality Assurance, LLM Evaluation |

## Context

AegisOps analyzes incident logs and monitoring screenshots using LLM providers (Gemini, OpenAI, Ollama) to produce structured incident reports. These reports drive operator decisions during active incidents -- severity classification, root-cause hypotheses, and prioritized action items flow directly into escalation paths and postmortem artifacts.

The core tension is: **how do we let an operator trust a live model's output during a SEV1 when the model itself is non-deterministic?**

Several approaches were considered:

1. **Trust the model directly** -- rely on prompt engineering and hope the output is good enough.
2. **Manual spot-checking** -- have operators validate reports by hand after each analysis.
3. **Replay-based eval suite** -- run fixed incident scenarios through the analysis pipeline and score outputs against a structured rubric before any live model claim is trusted.

## Decision

We chose **replay-based evals with rubric checks** as the quality floor for the system.

The implementation works as follows:

- Four fixed incident scenarios (`evals/incidentReplays.ts`) represent distinct failure classes: LLM latency spike, Redis OOM failover, payments retry storm, and search index lag.
- Each scenario includes raw logs, an expected severity, title keywords, required tags, root-cause terms, action item terms, reasoning section requirements, timeline event minimums, and a confidence score band.
- The scoring engine (`server/lib/replayEvals.ts`) runs each scenario through the demo analysis path and evaluates the output against 8 rubric categories, producing 32 total checks.
- Failed checks are aggregated into failure buckets by category so operators can identify systemic weaknesses (e.g., "root-cause coverage is weak across 3 scenarios") rather than chasing individual failures.
- Results are exposed at `GET /api/evals/replays` and through the CI pipeline as uploadable artifacts.

## Rationale

### Why not trust the model directly?

LLM outputs are stochastic. A model that correctly classifies a Redis OOM as SEV1 today may hallucinate a SEV3 tomorrow if the prompt or model version changes. During an active incident, operators cannot afford to manually verify every field. The eval suite provides a deterministic baseline that catches regressions before they reach production.

### Why not unit-test individual fields?

Unit tests verify implementation correctness, not output quality. A test that asserts `report.severity === "SEV1"` checks one field in isolation. The replay rubric checks that severity, title, tags, timeline, root causes, action items, reasoning, and confidence are all coherent for a given incident scenario. This catches the class of bugs where individual fields pass but the overall report is incoherent.

### Why demo mode instead of live model calls?

The eval suite runs against the demo analysis path (deterministic, no external API calls) so that:

- CI runs are fast, free, and reproducible.
- The eval suite works in offline and air-gapped environments.
- Results are not contaminated by model version drift or rate limiting.
- A natural extension is provider-specific eval runs (Gemini snapshot, Ollama snapshot) with result history stored as CI artifacts for regression tracking.

### Why failure buckets?

Individual check failures are hard to act on at scale. Failure buckets aggregate failures by category (e.g., `root_cause_coverage` failed in 2 of 4 scenarios) so operators and developers see patterns rather than a flat list of pass/fail results. This design is inspired by how SRE teams aggregate alerts into incident categories rather than responding to individual alerts.

## Consequences

### Positive

- Every CI run produces a replay proof artifact that operators can inspect without running the system.
- The replay suite serves as living documentation of what "good" looks like for each incident class.
- Adding a new incident scenario automatically increases rubric coverage without modifying the scoring engine.
- The eval surface (`/api/evals/replays`) is available in every deployment mode, so operators can evaluate quality without triggering live model calls.

### Negative

- Demo mode evals only validate the deterministic path, not live model quality. Provider-specific eval runs are a planned extension.
- Adding new rubric categories requires changes to both the scoring engine and the type definitions.
- The 4-scenario suite is small. As the system matures, the suite needs to grow to cover edge cases (e.g., incidents with no logs, image-only incidents, multi-system cascading failures).

## References

- `evals/incidentReplays.ts` -- scenario definitions and expected rubrics
- `server/lib/replayEvals.ts` -- scoring engine and bucket aggregation
- `__tests__/ReplayEvals.test.ts` -- unit test for the eval overview
- `docs/INCIDENT_REPLAY_EVALS.md` -- operator-facing eval documentation
- `scripts/run-incident-replays.ts` -- CLI runner for local eval runs
