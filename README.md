# AegisOps -- Multimodal Incident Review System

[![CI](https://github.com/KIM3310/AegisOps/actions/workflows/ci.yml/badge.svg)](https://github.com/KIM3310/AegisOps/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

**AegisOps** turns raw incident logs and monitoring screenshots into structured, decision-ready incident reports -- complete with severity classification, root-cause analysis, timeline reconstruction, and operator handoff artifacts. Every analysis claim is backed by a deterministic replay eval suite before the live model path is trusted.

## Live Demo

| Surface | Link |
|---|---|
| Cloudflare Pages | https://aegisops-ai-incident-doctor.pages.dev |
| Google AI Studio | [Open in AI Studio](https://ai.studio/apps/drive/1nInCvCJjSXy0IQGiDeK9gbsjjhhPqtlg?fullscreenApplet=true) |
| Demo video | [Watch on YouTube](https://youtu.be/FOcjPcMheIg) |

---

## Architecture

```mermaid
flowchart LR
    subgraph Intake ["1 - Intake"]
        Logs["Raw Logs"]
        Screenshots["Monitoring Screenshots"]
    end

    subgraph Analysis ["2 - Multimodal Analysis"]
        API["Express API\n(server-side key handling)"]
        Gemini["Gemini"]
        OpenAI["OpenAI"]
        Ollama["Ollama (local)"]
        Demo["Demo mode\n(no keys)"]
    end

    subgraph Output ["3 - Structured Output"]
        Report["Incident Report\n(JSON schema)"]
        Postmortem["Postmortem Pack\nSeverity + RCA + Timeline"]
        FollowUp["Follow-Up Q&A\n(grounded on report)"]
        TTS["Audio Briefing\n(TTS)"]
    end

    subgraph Eval ["4 - Replay Evals"]
        Suite["4 scenarios\n32 rubric checks"]
        Buckets["Failure Buckets\nby category"]
    end

    subgraph Handoff ["5 - Operator Handoff"]
        Export["JSON / Markdown\nSlack / Jira"]
        Workspace["Google Workspace\nDocs / Slides / Sheets\nCalendar / Chat"]
        Persist["GCS Artifacts\nBigQuery Analytics"]
    end

    Logs --> API
    Screenshots --> API
    API --> Gemini
    API --> OpenAI
    API --> Ollama
    API --> Demo
    Gemini --> Report
    OpenAI --> Report
    Ollama --> Report
    Demo --> Report
    Report --> Postmortem
    Report --> FollowUp
    Report --> TTS
    Report --> Suite
    Suite --> Buckets
    Report --> Export
    Report --> Workspace
    Report --> Persist
```

**Key design principle:** API keys never reach the browser. The React frontend calls `/api/analyze`, `/api/followup`, `/api/tts` -- the Express API reads provider keys server-side and returns validated, schema-conformant JSON.

---

## Quick Start

### Prerequisites

- **Node.js >= 20** and npm
- (Optional) A Gemini or OpenAI API key for live analysis
- (Optional) [Ollama](https://ollama.com) for fully offline local analysis

### Run locally

```bash
# 1. Clone and install
git clone https://github.com/KIM3310/AegisOps.git
cd AegisOps
npm install

# 2. Configure (optional -- runs in demo mode without keys)
cp .env.example .env
# Edit .env to add GEMINI_API_KEY or OPENAI_API_KEY

# 3. Start both API and UI
npm run dev
# UI:  http://127.0.0.1:3000
# API: http://127.0.0.1:8787
```

If no API key is set, the system runs in **demo mode** -- deterministic output, no external calls, and the full replay eval suite still runs.

### Verify the build

```bash
npm run verify   # typecheck + test + replay evals + review smoke + build
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 19, Vite 6, Lucide Icons | Incident input, report rendering, operator dashboard |
| Backend | Express, Node.js 20+ | API routing, key management, payload validation |
| LLM Providers | Gemini (default), OpenAI, Ollama | Multimodal incident analysis + follow-up Q&A |
| Validation | Zod 4 | Request/response schema enforcement |
| Logging | Pino | Structured JSON logging |
| Eval Framework | Custom replay harness | 4 scenarios, 32 rubric checks, failure bucket aggregation |
| Auth | Bearer token + OIDC (RS256 JWT) | Operator access control with role-based gating |
| Persistence | GCS + BigQuery (optional) | Report artifacts + analytics rows |
| Monitoring | Prometheus + Datadog (optional) | HTTP metrics, analysis latency, provider usage |
| Cloud Infra | Terraform (Cloud Run), Cloudflare Pages | IaC deployment, static hosting |
| Containers | Docker, Kubernetes (HPA, Ingress) | Production container orchestration |
| CI/CD | GitHub Actions | Typecheck, test, replay proof, build, artifact upload |
| Language | TypeScript 5.8 (strict mode) | End-to-end type safety |

---

## Core API

| Endpoint | Method | Description |
|---|---|---|
| `/api/analyze` | POST | Analyze logs + screenshots, return structured incident report |
| `/api/followup` | POST | Follow-up Q&A grounded on the generated report |
| `/api/tts` | POST | Text-to-speech audio briefing (Gemini TTS) |
| `/api/evals/replays` | GET | Replay eval suite results (4 scenarios / 32 checks) |
| `/api/live-sessions` | GET | Persisted incident session history |
| `/api/meta` | GET | Runtime modes, replay summary, operator checklist |
| `/api/healthz` | GET | Deployment mode, provider, limits |
| `/api/summary-pack` | GET | Reviewable trust surface with replay proof |
| `/api/schema/report` | GET | Incident report JSON schema contract |
| `/api/metrics` | GET | Prometheus-format metrics |

---

## Incident Replay Evals

The replay eval suite validates report quality against fixed scenarios with a structured rubric before the live model path is trusted.

```bash
npm run eval:replays
```

**Suite:** `evals/incidentReplays.ts` | **Scoring:** `server/lib/replayEvals.ts`

### Rubric categories

| Category | What it checks |
|---|---|
| `severity_match` | Severity classification matches the expected level |
| `title_keywords` | Title captures the dominant failure mode |
| `tag_coverage` | Operational tags cover the main systems involved |
| `timeline_coverage` | Timeline retains enough events for reconstruction |
| `root_cause_coverage` | Root causes name the failure mode, not just symptoms |
| `actionability` | Action items are concrete and operator-facing |
| `reasoning_trace` | Reasoning preserves Observations, Hypotheses, Decision Path |
| `confidence_range` | Confidence score stays within the rubric band |

### Current scenarios

| Scenario | Description |
|---|---|
| `llm-latency-spike` | SLO breach, queue saturation, memory pressure, autoscaling recovery |
| `redis-oom-failover` | Redis master OOM, quorum loss, cache miss storm during failover |
| `payments-retry-storm` | 5xx spike + retry fan-out and request queue growth |
| `search-warning-buildup` | Pre-outage warning with latency and queue buildup (no hard outage) |

See `docs/INCIDENT_REPLAY_EVALS.md` for full documentation.

---

## Deployment

### Local development

```bash
npm install && npm run dev
```

### Cloudflare Pages

```bash
npm run build && wrangler pages deploy dist/
```

### Docker / Cloud Run

```bash
docker build -t aegisops .
docker run -e GEMINI_API_KEY=<key> -e HOST=0.0.0.0 -p 8787:8787 aegisops
```

### Terraform (GCP Cloud Run)

```bash
cd infra/terraform
terraform init
terraform plan -var="project_id=<your-project>" -var="image=<your-image>"
terraform apply
```

### Kubernetes

Pre-built manifests in `infra/k8s/` include Deployment, Service, HPA, Ingress, and ConfigMap.

### Optional GCP persistence

Set `GOOGLE_APPLICATION_CREDENTIALS` + `GCP_PROJECT_ID` to persist incident artifacts to GCS and analytics rows to BigQuery.

---

## Project Structure

```
AegisOps/
  App.tsx                    # React app root
  types.ts                   # Shared TypeScript types
  constants.ts               # Sample presets, review lenses
  components/                # React UI components (26 files)
  hooks/                     # React hooks (app state, auth, storage)
  services/                  # Frontend service clients (Google APIs, Gemini, export)
  server/
    index.ts                 # Express API server (~700 lines, 15+ routes)
    lib/
      gemini.ts              # Gemini provider (analyze, follow-up, TTS)
      openai.ts              # OpenAI provider (analyze, follow-up)
      ollama.ts              # Ollama provider (analyze, follow-up)
      demo.ts                # Deterministic demo mode
      replayEvals.ts         # Replay eval scoring and bucket aggregation
      schemas.ts             # Zod request validation schemas
      operatorAccess.ts      # Bearer + OIDC operator auth
      gcp-persistence.ts     # GCS artifact upload, BigQuery analytics
      prometheus.ts          # Prometheus metrics
      datadog-adapter.ts     # Datadog integration
      aws-adapter.ts         # AWS S3/SQS/CloudWatch integration
      ...
  evals/
    incidentReplays.ts       # 4 replay scenarios with expected rubrics
  __tests__/                 # 29 test files (Vitest)
  scripts/                   # CLI tools (replay runner, smoke tests, load tests)
  infra/
    terraform/               # GCP Cloud Run IaC
    k8s/                     # Kubernetes manifests
  docs/                      # Architecture docs, evidence, SVGs
  samples/                   # Sample logs, screenshots, resource packs
  .github/workflows/         # CI pipeline (test, build, artifact upload)
```

---

<details>
<summary><strong>For AI Engineers / Data Engineers / Solutions Architects</strong></summary>

### Why this project matters for technical interviews

AegisOps demonstrates production-grade patterns across the full stack of an AI-powered operational system:

#### AI Engineering

- **Multimodal input normalization** -- logs (text) and monitoring screenshots (images) are validated, clamped, and fed to models as structured parts. Image payloads are base64-encoded with MIME type enforcement and size limits.
- **Structured output stabilization** -- LLM responses are parsed through JSON extraction, repair (`tryRepairAndParseJson`), and field-level clamping. The output contract is a strict TypeScript `IncidentReport` interface, not raw model text.
- **Multi-provider abstraction** -- Gemini, OpenAI, and Ollama share the same input/output interface. Provider selection is env-var gated with automatic fallback chains (e.g., Gemini primary -> Gemini Flash fallback).
- **Retry and timeout hardening** -- each provider implements exponential backoff with jitter, configurable attempt limits, per-request timeouts, and retriable error classification.
- **Evaluation-backed quality claims** -- the replay eval harness scores every report against 8 rubric categories with failure bucket aggregation. This is the evidence path shown before any live model claim.
- **Prompt engineering** -- system instructions enforce SRE domain language, structured reasoning traces (Observations / Hypotheses / Decision Path), and raw JSON output without markdown fences.

#### Data Engineering

- **Schema-first contracts** -- Zod schemas validate every request body. The incident report schema is exposed at `/api/schema/report` so downstream consumers can generate validators.
- **Persistence pipeline** -- analysis artifacts are persisted to GCS as versioned JSON objects. Analytics rows (severity, latency, provider, image count) are streamed to BigQuery for trend analysis.
- **Export-ready formats** -- reports export to JSON, Markdown, Slack blocks, and Jira format. Google Workspace integration produces Docs, Slides, Sheets, and Calendar entries from the same report object.
- **Observability pipeline** -- Prometheus counters/histograms expose HTTP request rates, analysis latency by provider, follow-up counts, and TTS usage. Datadog adapter mirrors the same metrics for enterprise monitoring.

#### Solutions Architecture

- **Trust boundary enforcement** -- provider API keys never reach the browser. The Express API acts as a security boundary between the operator UI and model runtime.
- **Operator access control** -- supports both static bearer tokens and OIDC JWT (RS256) with configurable role claim paths, audience validation, and JWKS discovery/caching.
- **IaC-ready deployment** -- Terraform module for Cloud Run with Secret Manager integration, service accounts, startup/liveness probes, and auto-scaling. Kubernetes manifests include HPA with CPU/memory targets.
- **Runtime mode hierarchy** -- demo mode (deterministic, no keys) -> local mode (Ollama) -> live mode (Gemini/OpenAI). Each mode preserves the evaluation path and review surfaces.
- **Review-first API surface** -- `/api/summary-pack`, `/api/evals/replays`, `/api/schema/report`, and `/api/meta` are available in every mode, so architectural reviewers can evaluate the system without triggering live model calls.

### Evidence paths for reviewers

| What to verify | How to verify |
|---|---|
| Report schema contract | `GET /api/schema/report` |
| Replay eval quality floor | `GET /api/evals/replays` or `npm run eval:replays` |
| Runtime posture | `GET /api/healthz` |
| Trust surface | `GET /api/summary-pack` |
| Provider comparison | `GET /api/provider-comparison` |
| Test coverage | `npm test` (29 test files, Vitest) |
| Full verification | `npm run verify` |

</details>

---

## Testing

```bash
npm test                    # Unit tests (Vitest, 29 test files)
npm run typecheck           # TypeScript strict mode check
npm run eval:replays        # Replay eval suite (4 scenarios / 32 checks)
npm run review:smoke        # Review surface smoke tests
npm run verify              # All of the above + build
```

---

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | No | `auto` (default), `gemini`, `openai`, `ollama`, `demo` |
| `GEMINI_API_KEY` | For live mode | Google Gemini API key |
| `OPENAI_API_KEY` | For OpenAI mode | OpenAI API key |
| `OLLAMA_BASE_URL` | For local mode | Ollama server URL (default: `http://127.0.0.1:11434`) |
| `GCP_PROJECT_ID` | For persistence | GCP project for GCS + BigQuery |
| `AEGISOPS_OPERATOR_TOKEN` | For auth | Static operator bearer token |
| `DD_API_KEY` | For monitoring | Datadog API key |

---

## License

MIT

---

Built by [Doeon Kim](https://github.com/KIM3310)
