# Big-Tech Elevation Plan

## Hiring Thesis

Turn `AegisOps` into a true `multimodal incident operating system` proof. The hiring story should be: this repo takes messy incident evidence, preserves reviewability, and produces operator-ready handoff artifacts with measurable RCA quality.

## 30 / 60 / 90

### 30 days
- Unify logs, screenshots, and session events into one incident evidence timeline with explicit source attribution.
- Add an RCA quality eval pack with rubric dimensions for severity accuracy, evidence grounding, actionability, and handoff quality.
- Add a postmortem handoff route that packages structured findings, timeline, and follow-up actions together.

### 60 days
- Add provider posture comparison between demo, Gemini, and Ollama modes with visible tradeoffs in speed, cost, and quality.
- Add operator role lanes for investigator, commander, and reviewer so handoff boundaries are explicit.
- Add incident replay exports that let a reviewer inspect one run without reproducing live provider access.

### 90 days
- Add cross-incident pattern views for recurring failure buckets and repeated weak signals.
- Add confidence-band scoring that separates grounded evidence from speculative explanation.
- Add one polished case study that walks from alert intake to export-safe postmortem bundle.

## Proof Surfaces To Add

- `GET /api/evidence-timeline`
- `GET /api/evals/rca-quality`
- `GET /api/postmortem-pack`
- `GET /api/runtime/provider-scorecard`

## Success Bar

- A reviewer can inspect where each conclusion came from.
- RCA quality is benchmarked instead of asserted.
- The repo reads like a serious incident workflow, not a screenshot-plus-LLM demo.
