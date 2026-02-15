# AegisOps — GCP-based Multimodal SEV1 Incident Copilot (Personal Project)

In real SEV1s, the bottleneck usually isn’t the lack of telemetry. It’s that evidence is scattered: logs in terminals and alerts, dashboards captured as screenshots, and decisions living in ad-hoc chat messages.

I built **AegisOps** as a repeatable workflow that compresses:

`collect → reason → decide → communicate`

into a single, reviewable incident report.

## Demo / Links

- Demo video: https://youtu.be/FOcjPcMheIg
- Live demo (Google AI Studio): https://ai.studio/apps/drive/1nInCvCJjSXy0IQGiDeK9gbsjjhhPqtlg?fullscreenApplet=true

## What It Does

- **Input:** raw text logs + monitoring screenshots
- **Output:** a structured JSON incident report:
  - severity, RCA hypotheses, prioritized actions, timeline, prevention recommendations
  - a short **reasoning trace** (Observations / Hypotheses / Decision Path)
- **Follow-up Q&A** grounded on the generated report context
- **Optional:** on-call audio briefing (TTS)
- **Optional:** export artifacts to Google Workspace (Docs/Slides/Sheets/Calendar, plus Chat webhook)

## Architecture

The key design goal is **key hygiene**: the Gemini API key must never be shipped to the browser.

```mermaid
flowchart LR
  UI[React/Vite UI] -->|/api/*| API[Local API Proxy (Express)]
  API -->|Gemini| LLM[Gemini Models]
  UI -->|OAuth token| GWS[Google Workspace APIs]
```

- The frontend calls a local API (`/api/analyze`, `/api/followup`, `/api/tts`).
- The API reads `GEMINI_API_KEY` server-side and calls Gemini.
- Grounding (`googleSearch` tool) is **OFF by default** and must be explicitly enabled.

## Run Locally (One Command)

### Prerequisites

- Node.js 18+

### Quick Start

```bash
npm install && npm run dev
```

- UI: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:8787`

### Environment Variables

Copy `.env.example` to `.env` and fill what you need.

```env
# If missing, the API runs in deterministic demo mode (no external LLM calls).
GEMINI_API_KEY=

# Optional: enable real Google OAuth for Workspace integration (otherwise the UI uses demo auth).
VITE_GOOGLE_CLIENT_ID=
```

## Demo Mode (No Keys Required)

If `GEMINI_API_KEY` is not set, the API switches to **demo mode**:

- analysis returns a deterministic stub report (based on the provided logs)
- follow-up Q&A returns a deterministic helper response
- TTS is disabled

This keeps the project easy to review and runnable without external credentials.

## Notes / Limitations

- Workspace export features require OAuth scopes; in demo mode those calls are not executed.
- This is a portfolio project focused on repeatability, safety-by-default, and operational UX.

