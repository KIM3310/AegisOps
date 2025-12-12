
# 🛡️ AegisOps – AI-Powered SRE Incident Doctor

> **Turn chaos into clarity.** AegisOps is an AI-driven incident response assistant that integrates deeply with Google Workspace to automate Site Reliability Engineering (SRE) workflows.

![AegisOps Banner](https://via.placeholder.com/1200x400/09090b/8b5cf6?text=AegisOps:+Gemini+3+Pro+Powered+SRE+Assistant)

![License](https://img.shields.io/badge/License-MIT-green.svg) ![React](https://img.shields.io/badge/React-19-blue) ![Gemini](https://img.shields.io/badge/Gemini-3_Pro-purple) ![Status](https://img.shields.io/badge/Status-Production_Ready-success)

---

## 🚀 Overview

In the heat of a critical incident (SEV1), SREs are overwhelmed by raw logs, scattered dashboards, and the pressure to communicate. **AegisOps** acts as an autonomous "Incident Doctor."

By leveraging **Google Gemini 3 Pro**, it ingests logs and screenshots to perform multimodal reasoning, identifying root causes in seconds instead of hours. It then automates the entire administrative tail-end of incident management using Google Workspace.

---

## 🏗️ System Architecture: Dual-Model Strategy

AegisOps employs a specialized **Dual-Model Architecture** to optimize for both deep reasoning and user experience:

```mermaid
graph TD
    A[User Input: Logs & Screenshots] --> B{AegisOps Core}
    B -->|Reasoning Engine| C[Gemini 3 Pro]
    B -->|Audio Engine| D[Gemini 2.5 Flash]
    
    C -->|Output| E[JSON Incident Report]
    D -->|Output| F[SRE Audio Briefing (TTS)]
    
    E --> G[Google Workspace Integration]
```

### 1. The Brain: `gemini-3-pro-preview`
*   **Role:** Root Cause Analysis (RCA) & Report Generation.
*   **Why:** Complex incidents require reasoning across modalities (Time-series graphs + Text logs). Gemini 3 Pro's long context window and superior logical deduction capabilities allow it to correlate a spike in a Grafana chart with a specific error log timestamp.

### 2. The Voice: `gemini-2.5-flash-preview-tts`
*   **Role:** Text-to-Speech (TTS) Briefing.
*   **Why:** During an outage, SREs are often away from their keyboards (war rooms, phone calls). The Flash model provides low-latency, high-fidelity speech synthesis, converting the executive summary into an audio briefing.

---

## ✨ Key Features

### 🧠 Advanced AI Analysis
*   **Multimodal Intelligence:** Simply drag and drop log files (`.log`, `.txt`) and dashboard screenshots (`.png`, `.jpg`) together.
*   **Reasoning Engine:** Displays the AI's "Chain of Thought," explaining *why* it reached a conclusion (e.g., *"Detected memory spike at 14:05 coinciding with OOM kill log"*).
*   **Google Search Grounding:** Cross-references obscure error codes with live web data to suggest proven mitigation steps (RAG-lite).

### ☁️ Deep Google Workspace Integration
AegisOps transforms analysis into action using the **Google Workspace APIs**:
*   **Gmail:** Search and import alert emails directly from PagerDuty/Datadog.
*   **Google Drive:** Securely fetch log archives and screenshot assets.
*   **Google Docs:** Auto-draft a "Gold Standard" Post-Mortem document.
*   **Google Slides:** Generate an executive summary deck for leadership review.
*   **Google Sheets:** Sync incident metadata to a central dataset for MTTR tracking.
*   **Google Calendar:** Auto-schedule the Post-Mortem Review meeting.
*   **Google Chat:** Dispatch formatted summary cards to team channels via Webhook.

### 🔒 Privacy-First Design
*   **Client-Side Processing:** AegisOps runs entirely in the browser (Single Page Application).
*   **Zero-Persistence Server:** Your sensitive logs are sent directly to the Gemini API and are **never** stored on any intermediate backend server.
*   **Local Storage:** Incident history is stored securely in your browser's `LocalStorage`.

---

## 🔬 Technical Deep Dive

### 1. Prompt Engineering Strategy
We use a **Chain-of-Thought (CoT)** prompting strategy to force the model to hallucinate less and reason more.
*   **Persona:** "You are a Principal SRE at Google."
*   **Steps:** 1. Correlate -> 2. Deduce -> 3. Integrity Check.
*   **Safety:** The prompt explicitly instructs the AI to report "Investigation Needed" if the data is insufficient, preventing misleading root cause fabrication.

### 2. Robust JSON Extraction
Large Language Models often output "Chatty" JSON (wrapping it in markdown or adding conversational filler). AegisOps implements a custom **Iterative JSON Parser**:
*   **Regex Cleaning:** Removes ````json` fences and invisible control characters.
*   **Structure Repair:** Automatically fixes common LLM syntax errors like trailing commas or unquoted keys.
*   **Block Search:** Scans the text for balanced `{}` blocks until valid JSON is found.

### 3. Audio Processing
Browser audio policies are strict. AegisOps handles:
*   **Raw PCM Decoding:** Converts Gemini's raw audio bytes to `AudioBuffer`.
*   **Int16 Alignment:** Ensures byte alignment safety to prevent crashes during audio decoding.

---

## 🛠️ Tech Stack

*   **AI SDK:** `@google/genai` (v1.33.0)
*   **Frontend:** React 19, TypeScript, Tailwind CSS
*   **Icons:** Lucide React
*   **Auth:** Google Identity Services (OAuth 2.0 Token Model)
*   **State:** React Hooks (useReducer, Context not required due to flat architecture)

---

## 🚀 How to Run

### Prerequisites
*   Node.js (v18+) or a modern browser environment.
*   **Gemini API Key:** Get one at [Google AI Studio](https://aistudio.google.com/).

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/aegisops.git
    cd aegisops
    ```

2.  **Set Environment Variables:**
    Create a `.env` file (or set in your IDE):
    ```env
    API_KEY=your_gemini_api_key_here
    ```

3.  **Run the application:**
    Use your preferred bundler (Vite, Parcel, Webpack) or simply open `index.html` if using a build-less setup.
    ```bash
    npm install
    npm run dev
    ```

### ⚡ Demo Mode (Zero-Config)
AegisOps includes a robust **Demo Mode**. If you do not provide a Google Client ID for OAuth, the app automatically switches to simulation mode:
*   Simulates Google Login.
*   Provides mock data for Gmail and Drive imports.
*   Allows full exploration of the UI and AI features without a GCP setup.

---

## 👨‍💻 About the Developer

**Doeon Kim**
*AI-Native SRE & Full Stack Engineer*

Building resilient systems powered by Generative AI.
This project was built for the **Google Gemini Developer Competition**.

[GitHub](https://github.com/KIM3310) • [LinkedIn](https://www.linkedin.com/in/doeon-kim-4742a2388)
