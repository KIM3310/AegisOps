# Incident Replay Evals

AegisOps includes a small incident replay harness for checking report quality against fixed scenarios.

## Purpose

The replay suite makes two things easier to verify:

- the same inputs continue to produce the expected report shape
- regressions show up as named rubric failures instead of ad hoc manual checks

## What Gets Scored

Each replay case is scored against the following categories:

- `severity_match`
- `title_keywords`
- `tag_coverage`
- `timeline_coverage`
- `root_cause_coverage`
- `actionability`
- `reasoning_trace`
- `confidence_range`

## Files

- `evals/incidentReplays.ts`: scenarios and expected rubric
- `server/lib/replayEvals.ts`: scoring and bucket aggregation
- `scripts/run-incident-replays.ts`: local CLI summary
- `GET /api/evals/replays`: app-facing summary for dashboard visibility

## Run Locally

```bash
npm install
npm run eval:replays
```

Example summary:

```text
[replays] suite=incident-replay-v1 cases=4
[replays] pass_rate=100% checks=32/32 severity_accuracy=100%
```

## Current Scenarios

- `llm-latency-spike`: queue saturation, memory pressure, autoscaling recovery
- `redis-oom-failover`: Redis master OOM, quorum loss, cache miss storm
- `payments-retry-storm`: 5xx spike plus retry fan-out and request queue growth
- `search-warning-buildup`: pre-outage warning case with latency and queue buildup

## Limits

- The current suite evaluates demo-mode behavior, not stochastic live-model quality.
- It is still useful for validating report shape, operational language, and failure buckets.
- A natural next step is provider-aware eval runs for Gemini and Ollama snapshots with result history in CI artifacts.
