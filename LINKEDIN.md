AegisOps — GCP-based Multimodal SEV1 Incident Copilot

In real SEV1 incidents, the hard part is often turning scattered evidence from logs, screenshots, and alerts into a report
someone else can review quickly. AegisOps compresses “collect → reason → decide → communicate” into a single workflow.

What it does
- Input: raw logs + monitoring screenshots
- Output: structured JSON incident report (severity, RCA hypotheses, timeline, prioritized actions, prevention)
- Reasoning trace: Observations → Hypotheses → Decision Path (short, evidence-based)
- Follow-up Q&A grounded on the generated report context
- Optional: on-call audio briefing (TTS)
- Optional: export artifacts to Google Workspace (Docs/Slides/Sheets/Calendar + Chat webhook)

Engineering decisions / troubleshooting I worked through
- Key hygiene: Gemini calls run behind a local API proxy so `GEMINI_API_KEY` never ships to the browser (no Vite env injection).
- Fallback mode: if `GEMINI_API_KEY` is missing, the API runs in demo mode so the full UI flow still works without credentials.
- Static Pages deployment: when `/api/*` is unavailable, the frontend falls back to local demo analysis and replay telemetry so the public demo still stays usable at zero cost.
- Output reliability: JSON extraction/repair + schema defaults so the UI stays stable even when model output is messy.
- Payload stability: enforced MAX_IMAGES and continued analysis even if some screenshots fail to read.
- Grounding safety: web grounding is OFF by default; when enabled, citations are surfaced and meant to be verified.

GitHub
https://github.com/KIM3310/AegisOps-AI-Incident-Doctor-for-SREs-Powered-by-Gemini-3-Pro-Google-Workspace-

Demo video
https://youtu.be/FOcjPcMheIg

Live demo (Cloudflare Pages)
https://aegisops-ai-incident-doctor.pages.dev

AI Studio demo
https://ai.studio/apps/drive/1nInCvCJjSXy0IQGiDeK9gbsjjhhPqtlg?fullscreenApplet=true
