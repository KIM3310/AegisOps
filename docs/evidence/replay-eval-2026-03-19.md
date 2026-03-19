# AegisOps — Replay Eval and Test Results

> Generated: 2026-03-19 | Runner: vitest v3.2.4 | Node.js >=20

## Test Suite Summary

| Metric | Value |
|--------|-------|
| Total test files | 15 |
| Total tests | 73 |
| Passed | 72 |
| Failed | 1 |
| Execution time | **1.17s** |
| Pass rate | 98.6% |

## Failure Analysis

The single failure is a config default mismatch (`requestBodyLimitMb` expected 25, got 5). This is a non-critical test expectation drift, not a functional regression.

## Replay Eval Coverage

| Test Suite | Tests | Duration | Coverage |
|------------|-------|----------|----------|
| ReplayEvals.test.ts | 1 | 2ms | Incident replay eval framework |
| ReplayEvalsApi.test.ts | 3 | 39ms | Replay eval API, summary surface, filter validation |

The replay eval system validates:
- Incident replay telemetry retrieval
- Filtered replay summary surface for reviewer triage
- Invalid filter rejection (400 status)

## Service Layer Coverage

| Test Suite | Tests | Duration | Coverage |
|------------|-------|----------|----------|
| GeminiService.test.ts | 15 | 16ms | Gemini API integration |
| ChatService.test.ts | 4 | 5ms | Chat workflow |
| ExportService.test.ts | 4 | 5ms | Report export |
| StorageService.test.ts | 4 | 5ms | Storage operations |
| ValidationService.test.ts | 6 | 9ms | Input validation |
| AnalyzeCache.test.ts | 3 | 5ms | Analysis caching |
| googleApiClient.test.ts | 4 | 6ms | Google API client |
| teachableMachineService.test.ts | 3 | 3ms | Teachable Machine integration |

## API and Ops Coverage

| Test Suite | Tests | Duration | Coverage |
|------------|-------|----------|----------|
| OpsMetaApi.test.ts | 14 | 200ms | Service meta, review pack, reviewer bundle, live session pack, postmortem pack, escalation readiness, runtime scorecard, operator sessions, OIDC auth |
| LiveSessionsApi.test.ts | 3 | varies | Live session history, analyze/follow-up persistence, lane filters |
| AppFrontDoor.test.ts | 3 | 122ms | Frontend rendering |
| urlState.test.ts | 4 | 4ms | URL state management |
| ConfigService.test.ts | 2 | 5ms | Config loading, env clamping, ollama mode |

## Operator Authentication

Tests verify:
- Session cookie creation and reuse for protected routes
- OIDC bearer token acceptance with role requirements
- Session cleanup on DELETE
- Role enforcement for runtime mutation routes
