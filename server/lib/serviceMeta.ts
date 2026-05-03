import type { ExportFormat } from "../../types";
import { buildAegisOpsResourcePack } from "./resourcePack";
import { buildIncidentReplayEvalOverview, buildIncidentReplayEvalSummary } from "./replayEvals";

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
const SUMMARY_PACK_ID = "aegisops-summary-pack-v1";
const LIVE_SESSION_PACK_ID = "aegisops-live-session-pack-v1";
const POSTMORTEM_PACK_ID = "aegisops-postmortem-pack-v1";

function buildAegisOpsProofAssets() {
  return [
    {
      label: "Summary pack diagram",
      path: "docs/summary-pack.svg",
      kind: "diagram",
    },
    {
      label: "Architecture snapshot",
      path: "docs/architecture.png",
      kind: "diagram",
    },
    {
      label: "System design pack",
      path: "docs/system-design-pack.svg",
      kind: "diagram",
    },
    {
      label: "Replay eval rubric",
      path: "docs/INCIDENT_REPLAY_EVALS.md",
      kind: "doc",
    },
    {
      label: "Sample logs",
      path: "samples/logs",
      kind: "sample",
    },
    {
      label: "Sample screenshots",
      path: "samples/screenshots",
      kind: "sample",
    },
    {
      label: "Resource pack",
      path: "/api/resource-pack",
      kind: "route",
    },
  ];
}

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
  const replaySummary = buildIncidentReplayEvalSummary(options.maxLogChars);
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
      {
        id: "openai-live-preview",
        label: "OpenAI live preview",
        useWhen:
          "Running the bounded public evaluation lane with fixed incident bundles and live escalation summaries.",
      },
    ],
    replaySuite: {
      suiteId: replayOverview.suiteId,
      totalCases: replayOverview.summary.totalCases,
      totalChecks: replayOverview.summary.totalChecks,
      passRate: replayOverview.summary.passRate,
      severityAccuracy: replayOverview.summary.severityAccuracy,
      summaryContract: replaySummary.summaryId,
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
      liveSessions: "/api/live-sessions",
      liveSessionPack: "/api/live-session-pack",
      postmortemPack: "/api/postmortem-pack",
      escalationReadiness: "/api/escalation-readiness",
      systemDesignPack: "/api/system-design-pack",
      liveEscalationPreview: "/api/live-escalation-preview",
      cloudProof: "/api/cloud-proof",
      summaryPack: "/api/summary-pack",
      exportBundle: "/api/export-bundle",
      exportBundleVerify: "/api/export-bundle/verify",
      runtimeScorecard: "/api/runtime/scorecard",
      resourcePack: "/api/resource-pack",
      replayEvals: "/api/evals/replays",
      replaySummary: "/api/evals/replays/summary",
      providerComparison: "/api/evals/providers",
      reportSchema: "/api/schema/report",
      readme: "https://github.com/KIM3310/AegisOps",
      demo: "https://aegisops-ai-incident-doctor.pages.dev",
      video: "https://youtu.be/FOcjPcMheIg",
    },
  };
}

export function buildAegisOpsLiveSessionPack(options: ServiceMetaOptions) {
  const serviceMeta = buildAegisOpsServiceMeta(options);
  const replaySummary = buildIncidentReplayEvalSummary(options.maxLogChars);
  const resourcePack = buildAegisOpsResourcePack();

  return {
    ok: true,
    service: "aegisops-live-session-pack",
    version: 1,
    deployment: options.deployment,
    liveSessionPackId: LIVE_SESSION_PACK_ID,
    headline:
      "Real-time incident bridge for voice, screenshots, logs, and handoff-ready operator notes.",
    sessionRoles: [
      {
        role: "incident-commander",
        responsibility: "Drive the live bridge, confirm impact, and keep the final narrative concise.",
      },
      {
        role: "operator-scribe",
        responsibility: "Attach screenshots, log snippets, and structured notes without losing evidence traceability.",
      },
      {
        role: "operator",
        responsibility: "Inspect replay proof, schema boundary, and export posture before handoff.",
      },
    ],
    modalities: [
      {
        id: "voice-briefing",
        surface: "Gemini TTS + live backend",
        note: "Use for commander briefings and on-call updates once runtime posture is confirmed.",
      },
      {
        id: "screenshots",
        surface: "multimodal image input",
        note: "Attach dashboards or alerts directly to the live incident session.",
      },
      {
        id: "log-stream",
        surface: "/api/analyze",
        note: "Keep raw logs within input limits and pair them with screenshots for stronger grounding.",
      },
      {
        id: "handoff-note",
        surface: "/api/schema/report",
        note: "Preserve the same incident-report contract from live capture through export.",
      },
    ],
    liveFlow: [
      "Start with /api/healthz and /api/runtime/scorecard to confirm the backend can support a live bridge.",
      "Capture operator voice, screenshots, and logs in one incident session without dropping the structured report contract.",
      "Use /api/live-sessions to reopen prior command loops and keep handoff-ready context visible across multiple requests.",
      "Use replay proof and schema guidance before turning the live summary into downstream actions or exports.",
      "Close the session with a handoff-ready incident report that stays reviewable after the call ends.",
    ],
    reliabilityPosture: {
      replaySummaryId: replaySummary.summaryId,
      replayPassRate: replaySummary.totals.passRate,
      replaySeverityAccuracy: replaySummary.totals.severityAccuracy,
      runtimeModes: serviceMeta.runtimeModes.map((mode) => mode.label),
      recommendedReviewRoutes: [
        "/api/healthz",
        "/api/runtime/scorecard",
        "/api/resource-pack",
        "/api/system-design-pack",
        "/api/live-sessions",
        "/api/live-session-pack",
        "/api/postmortem-pack",
        "/api/system-design-pack",
        "/api/summary-pack",
        "/api/schema/report",
      ],
    },
    proofAssets: [
      ...buildAegisOpsProofAssets(),
      {
        label: "Live session history",
        path: "/api/live-sessions",
        kind: "route",
      },
      {
        label: "Live session pack",
        path: "/api/live-session-pack",
        kind: "route",
      },
    ],
    links: serviceMeta.links,
  };
}

export function buildAegisOpsSummaryPack(options: ServiceMetaOptions) {
  const serviceMeta = buildAegisOpsServiceMeta(options);
  const replaySummary = buildIncidentReplayEvalSummary(options.maxLogChars);
  const reportSchema = buildIncidentReportSchema(options);
  const resourcePack = buildAegisOpsResourcePack();

  return {
    ok: true,
    service: "aegisops-summary-pack",
    version: 1,
    deployment: options.deployment,
    summaryPackId: SUMMARY_PACK_ID,
    headline:
      "SEV1 operators can verify runtime mode, replay quality, report contract, and export posture before trusting the copilot.",
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
    twoMinuteReview: [
      {
        step: "1. Runtime posture",
        surface: "/api/healthz -> /api/meta",
        proof: "Confirm deployment mode, runtime options, and replay telemetry before reading any report.",
      },
      {
        step: "2. Replay quality",
        surface: "/api/summary-pack -> /api/postmortem-pack -> /api/evals/replays",
        proof: "Use pass rate, severity accuracy, and rubric count to judge incident-quality readiness.",
      },
      {
        step: "3. System design surface",
        surface: "/api/system-design-pack",
        proof: "Inspect topology, hot endpoints, and drill posture before describing runtime readiness.",
      },
      {
        step: "4. Built-in evidence pack",
        surface: "/api/resource-pack",
        proof: "Inspect checked-in incident bundles, annotations, and review checks without live provider access.",
      },
      {
        step: "5. Contract boundary",
        surface: "/api/schema/report",
        proof: "Check required fields, export formats, and payload limits before trusting handoff output.",
      },
      {
        step: "6. Asset proof",
        surface: "docs/summary-pack.svg -> docs/system-design-pack.svg -> docs/architecture.png",
        proof: "Verify evaluation flow and key hygiene without tracing the full codebase first.",
      },
    ],
    evidenceBundle: {
      replayPassRate: serviceMeta.replaySuite.passRate,
      severityAccuracy: serviceMeta.replaySuite.severityAccuracy,
      totalChecks: serviceMeta.replaySuite.totalChecks,
      liveSessionPackId: LIVE_SESSION_PACK_ID,
      postmortemPackId: POSTMORTEM_PACK_ID,
      systemDesignPackId: "aegisops-system-design-pack-v1",
      replaySummaryId: replaySummary.summaryId,
      runtimeModes: serviceMeta.runtimeModes.map((mode) => mode.label),
      exportFormats: reportSchema.exportFormats,
      requiredFields: reportSchema.requiredFields,
      resourcePack: resourcePack.summary,
    },
    proofAssets: buildAegisOpsProofAssets(),
    links: serviceMeta.links,
  };
}
