# System Architecture - AegisOps

This document is the system-level architecture attachment for the repository. It keeps the technical stack, runtime boundary, data/control flow, deployment surface, and operating assumptions in one place.

## Architecture Summary

| Area | Design |
| --- | --- |
| Repository | `AegisOps` |
| Primary domain | security operations and controlled automation |
| Primary stack | Node/TypeScript runtime, Terraform infrastructure modules, Container build surface, GitHub Actions validation |
| Architecture axes | cloud architecture, AI engineering, reliability, security, operator experience |

Repository-local proof surface for security operations and controlled automation, backed by Node/TypeScript runtime, Terraform infrastructure modules, Container build surface.

## Runtime And Data Flow

```mermaid
flowchart LR
    User["User or architecture inspection"] --> Surface["Public demo, CLI, package, or README surface"]
    Surface --> Runtime["Runtime boundary: Node/TypeScript runtime, Terraform infrastructure modules, Container build surface, GitHub Actions validation"]
    Runtime --> Control["Control plane: configuration, policies, adapters, and jobs"]
    Control --> Data["Data and artifacts: fixtures, reports, logs, exports, or model outputs"]
    Runtime --> Observability["Observability and validation hooks"]
    Observability --> Handoff["Documented handoff and operating boundary"]
    Data --> Handoff
```

Primary domain: security operations and controlled automation.

## Stack Surface

| Layer | Current surface | Operating note |
| --- | --- | --- |
| Interface | Public demo, README, CLI, package, or static proof surface depending on repository shape | Keep the first screen or command path inspectable without private credentials. |
| Runtime | Node/TypeScript runtime, Terraform infrastructure modules, Container build surface, GitHub Actions validation | Keep runtime adapters bounded by environment configuration and documented fallbacks. |
| Control plane | Policies, configuration, job orchestration, tests, and release scripts | Keep operator-impacting changes traceable through docs and validation hooks. |
| Data and artifacts | Fixtures, generated reports, screenshots, exports, logs, or model outputs | Keep sample and generated artifacts clearly separated from private or customer data. |
| Operations | CI, local validation, architecture guard, and handoff notes | Keep the architecture docs current when runtime, data, or deployment boundaries change. |

## Cloud Or Local Deployment Boundary

Operating model: segmented ingest, least-privilege response services, audit trails, and emergency rollback boundaries

### Deployment patterns

- Infrastructure-as-code entrypoint with explicit variables, outputs, and provider boundaries
- Containerized runtime path suitable for repeatable local, staging, or managed service deployment
- Edge-first deployment model with server-side AI adapters and public-safe secrets handling
- Security control plane with audit logging, isolation boundaries, and response architecture gates

### Control boundaries

- identity boundary and least-privilege service access
- environment separation for local, staging, and managed runtime paths
- secret storage outside source and deterministic fallback for missing credentials
- observability hooks for logs, metrics, traces, and audit events
- rollback path for deployment, schema, and model changes

### Resilience controls

- bounded retries with explicit failure states
- health/readiness checks before operator-facing flows are trusted
- idempotent data or artifact writes where repeat execution is possible
- usage and quota guardrails for hosted services and model adapters

## AI And Automation Boundary

Operating model: policy-scored triage, evidence extraction, response drafting, and deterministic replay checks

### Engineering patterns

- Map raw events into typed findings, severity labels, response actions, and audit-ready evidence bundles
- Keep automated remediation behind explicit architecture and rollback boundaries
- Separate deterministic checks from model-generated output so the system remains testable without external credentials
- Capture prompts, inputs, outputs, and decision metadata as inspectable artifacts instead of hidden side effects
- Gate model-assisted actions with policy, confidence, and fallback states before they reach an operator path

### Evaluation and model-risk controls

- deterministic fixtures for CI-safe verification
- golden output or schema checks for generated artifacts
- trace capture for prompts, tool calls, inputs, and outputs
- quality gates that fail closed when evidence is missing

### Risks to keep explicit

- unsafe tool execution
- secret exposure
- alert fatigue
- unapproved automated response

## Attached Architecture References

- [Service architecture](service-architecture.md)
- [Cloud + AI architecture](cloud-ai-architecture.md)
- [Architecture manifest](architecture/blueprint.json)
- [Product operating model](product-operating-model.md)
- [Quality gate](quality-gate.md)

## Local Architecture Guard

```bash
python3 scripts/validate_architecture_blueprint.py
```

CI workflow: `.github/workflows/architecture-blueprint.yml`.

Update this document whenever runtime entrypoints, data stores, hosted services, model/provider boundaries, or operating assumptions change.
