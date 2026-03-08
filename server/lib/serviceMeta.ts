import type { ExportFormat } from "../../types";
import { buildIncidentReplayEvalOverview } from "./replayEvals";

export type ServiceMetaDeployment = "backend" | "static-demo";

type ServiceMetaOptions = {
  deployment: ServiceMetaDeployment;
  maxImages: number;
  maxLogChars: number;
  maxQuestionChars: number;
  maxTtsChars: number;
  analyzeModel: string;
  ttsModel: string;
};

const REPORT_EXPORT_FORMATS: ExportFormat[] = ["json", "markdown", "slack", "jira"];
const REVIEW_PACK_ID = "aegisops-review-pack-v1";

export function buildIncidentReportSchema(options: Pick<ServiceMetaOptions, "maxImages" | "maxLogChars" | "maxQuestionChars" | "maxTtsChars">) {
  return {
    ok: true,
    schemaId: "incident-report-v1",
    version: 1,
    description: "Structured incident report contract used by analysis, follow-up Q&A, export, and history surfaces.",
    requiredFields: ["title", "summary", "severity", "rootCauses", "timeline", "actionItems", "tags"],
    optionalFields: ["impact", "mitigationSteps", "lessonsLearned", "preventionRecommendations", "references", "reasoning", "confidenceScore"],
    exportFormats: REPORT_EXPORT_FORMATS,
    fieldGuide: [
      {
        key: "title",
        type: "string",
        guidance: "Short operator-reviewable incident title with system and failure mode.",
      },
      {
        key: "summary",
        type: "string",
        guidance: "Concise incident summary that explains impact and why this matters now.",
      },
      {
        key: "severity",
        type: "enum",
        allowed: ["SEV1", "SEV2", "SEV3", "UNKNOWN"],
        guidance: "Operational urgency classification for triage and handoff.",
      },
      {
        key: "rootCauses",
        type: "string[]",
        minItems: 1,
        guidance: "Primary RCA hypotheses extracted from the incident evidence.",
      },
      {
        key: "timeline",
        type: "TimelineEvent[]",
        minItems: 1,
        guidance: "Ordered timeline of observed events or inferred milestones.",
      },
      {
        key: "actionItems",
        type: "ActionItem[]",
        minItems: 1,
        guidance: "Execution-ready next actions with priority and optional owner.",
      },
      {
        key: "tags",
        type: "string[]",
        minItems: 1,
        guidance: "Indexing and retrieval tags for replay analysis, history, and exports.",
      },
      {
        key: "reasoning",
        type: "string",
        guidance: "Short reasoning trace using Observations / Hypotheses / Decision Path.",
      },
      {
        key: "references",
        type: "ReferenceSource[]",
        guidance: "External grounding or evidence links when available.",
      },
      {
        key: "confidenceScore",
        type: "number",
        guidance: "0-100 confidence band used in replay eval scoring and operator review.",
      },
    ],
    inputLimits: {
      maxImages: options.maxImages,
      maxLogChars: options.maxLogChars,
      maxQuestionChars: options.maxQuestionChars,
      maxTtsChars: options.maxTtsChars,
    },
    operatorRules: [
      "Prefer logs plus screenshots together when available.",
      "Treat grounding citations as hints and verify before operational action.",
      "Use the reasoning trace for review, not as an unquestioned source of truth.",
    ],
  };
}

export function buildAegisOpsServiceMeta(options: ServiceMetaOptions) {
  const replayOverview = buildIncidentReplayEvalOverview(options.maxLogChars);
  const reportSchema = buildIncidentReportSchema(options);

  return {
    ok: true,
    service: "aegisops-service-meta",
    version: 1,
    deployment: options.deployment,
    product: {
      name: "AegisOps",
      category: "multimodal incident copilot",
      headline: "Turn logs, screenshots, and alerts into a reviewable incident report.",
    },
    workflow: ["collect", "reason", "decide", "communicate"],
    runtimeModes: [
      {
        id: "static-demo",
        label: "Static demo",
        useWhen: "Reviewing the frontend and replay surface without a live backend.",
      },
      {
        id: "demo",
        label: "Demo backend",
        useWhen: "Testing the full product flow without a live Gemini key.",
      },
      {
        id: "gemini",
        label: "Gemini live",
        useWhen: "Running full multimodal analysis and TTS on the backed service.",
      },
      {
        id: "ollama",
        label: "Ollama local",
        useWhen: "Running offline local inference without cloud keys.",
      },
    ],
    replaySuite: {
      suiteId: replayOverview.suiteId,
      totalCases: replayOverview.summary.totalCases,
      totalChecks: replayOverview.summary.totalChecks,
      passRate: replayOverview.summary.passRate,
      severityAccuracy: replayOverview.summary.severityAccuracy,
    },
    reportContract: {
      schemaId: reportSchema.schemaId,
      requiredFields: reportSchema.requiredFields,
      exportFormats: reportSchema.exportFormats,
    },
    operatorChecklist: [
      "Confirm current deployment mode before trusting backend-dependent controls.",
      "Check replay pass rate before using the surface as a benchmark reference.",
      "Watch log truncation and image-count limits before analysis.",
      "Verify references when grounding is enabled.",
    ],
    models: {
      analyze: options.analyzeModel,
      tts: options.ttsModel,
    },
    links: {
      healthz: "/api/healthz",
      reviewPack: "/api/review-pack",
      replayEvals: "/api/evals/replays",
      reportSchema: "/api/schema/report",
      readme: "https://github.com/KIM3310/AegisOps",
      demo: "https://aegisops-ai-incident-doctor.pages.dev",
      video: "https://youtu.be/FOcjPcMheIg",
    },
  };
}

export function buildAegisOpsReviewPack(options: ServiceMetaOptions) {
  const serviceMeta = buildAegisOpsServiceMeta(options);
  const reportSchema = buildIncidentReportSchema(options);

  return {
    ok: true,
    service: "aegisops-review-pack",
    version: 1,
    deployment: options.deployment,
    reviewPackId: REVIEW_PACK_ID,
    headline:
      "SEV1 reviewers can verify runtime mode, replay quality, report contract, and export posture before trusting the copilot.",
    operatorJourney: [
      {
        stage: "Collect",
        summary: "Logs and screenshots enter one guarded input surface with explicit payload limits.",
        surface: "React/Vite UI + /api/analyze",
      },
      {
        stage: "Reason",
        summary: "Gemini, Ollama, or demo mode produces the same structured incident-report contract.",
        surface: "analysis runtime",
      },
      {
        stage: "Review",
        summary: "Replay telemetry, reasoning trace, and schema guidance stay inspectable before handoff.",
        surface: "/api/evals/replays + /api/schema/report",
      },
      {
        stage: "Communicate",
        summary: "Operators can export the reviewed report to JSON, markdown, Slack, Jira, or Workspace surfaces.",
        surface: "ReportCard + export tools",
      },
    ],
    trustBoundary: [
      "Gemini API keys stay server-side or in backend runtime memory; the browser never receives raw secrets.",
      "Static demo mode keeps the UI reviewable even when backend-only controls are unavailable.",
      "Grounding and external references are advisory only and require operator verification before action.",
    ],
    reviewSequence: [
      "Check deployment mode and replay pass rate before using the output as an incident benchmark.",
      "Inspect the report contract and payload limits to confirm the current evidence fits the service boundary.",
      "Review the generated report, timeline, and action items before exporting or communicating downstream.",
    ],
    proofBundle: {
      replayPassRate: serviceMeta.replaySuite.passRate,
      severityAccuracy: serviceMeta.replaySuite.severityAccuracy,
      totalChecks: serviceMeta.replaySuite.totalChecks,
      runtimeModes: serviceMeta.runtimeModes.map((mode) => mode.label),
      exportFormats: reportSchema.exportFormats,
      requiredFields: reportSchema.requiredFields,
    },
    links: serviceMeta.links,
  };
}
