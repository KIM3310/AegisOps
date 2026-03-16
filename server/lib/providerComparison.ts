import type { ServiceMetaDeployment } from "./serviceMeta";
import { buildIncidentReplayEvalOverview } from "./replayEvals";

type ActiveProvider = "demo" | "gemini" | "ollama";
type ProviderCardId = "static-demo" | "demo" | "gemini" | "ollama";
type ProviderCostBand = "none" | "local-compute" | "paid";
type ProviderLatencyBand =
  | "instant"
  | "interactive"
  | "network-dependent"
  | "host-dependent";

type ProviderComparisonOptions = {
  deployment: ServiceMetaDeployment;
  activeProvider: ActiveProvider;
  analyzeModel: string;
  ttsModel: string;
  maxLogChars: number;
};

type ProviderCard = {
  id: ProviderCardId;
  label: string;
  isCurrent: boolean;
  qualitySignal: string;
  latencyBand: ProviderLatencyBand;
  costBand: ProviderCostBand;
  capabilitySummary: string;
  bestFor: string[];
  tradeoffs: string[];
  comparison: {
    qualityDelta: string;
    latencyDelta: string;
    costDelta: string;
  };
};

export type ProviderComparisonResponse = {
  ok: true;
  service: "aegisops-provider-comparison";
  version: 1;
  generatedAt: string;
  compareAgainst: "static-demo";
  summary: {
    currentProvider: ProviderCardId;
    currentMode: "static-demo" | ActiveProvider;
    headline: string;
    replayBaselinePassRate: number;
    replaySeverityAccuracy: number;
  };
  providers: ProviderCard[];
  links: {
    providerComparison: string;
    replaySummary: string;
    runtimeScorecard: string;
    postmortemPack: string;
    meta: string;
    healthz: string;
  };
};

function buildHeadline(currentProvider: ProviderCardId, deployment: ServiceMetaDeployment) {
  if (deployment === "static-demo") {
    return "Start with replay proof in the static demo, then switch to Gemini or Ollama only when you need live-provider evidence.";
  }
  if (currentProvider === "gemini") {
    return "Gemini is active: use this view to explain why paid cloud inference is worth the added latency and cost for multimodal response quality.";
  }
  if (currentProvider === "ollama") {
    return "Ollama is active: use this view to show where local privacy wins and where Gemini still offers stronger live multimodal coverage.";
  }
  return "Demo mode is active: use this view to show the jump from deterministic replay proof to live Gemini or Ollama tradeoffs.";
}

export function buildAegisOpsProviderComparison(
  options: ProviderComparisonOptions
): ProviderComparisonResponse {
  const replayOverview = buildIncidentReplayEvalOverview(options.maxLogChars);
  const currentProvider: ProviderCardId =
    options.deployment === "static-demo" ? "static-demo" : options.activeProvider;

  const providers: ProviderCard[] = [
    {
      id: "static-demo",
      label: "Static demo",
      isCurrent: currentProvider === "static-demo",
      qualitySignal: "Deterministic replay-backed frontend proof without a running API.",
      latencyBand: "instant",
      costBand: "none",
      capabilitySummary: "Replay review, schema checks, and frontend walkthroughs.",
      bestFor: [
        "portfolio review links",
        "fast recruiter demos",
        "zero-secret product walkthroughs",
      ],
      tradeoffs: [
        "No live provider calls",
        "No runtime key management",
        "Use only as the baseline proof lane",
      ],
      comparison: {
        qualityDelta: "Baseline replay benchmark",
        latencyDelta: "Fastest path",
        costDelta: "No infra or token cost",
      },
    },
    {
      id: "demo",
      label: "Demo backend",
      isCurrent: currentProvider === "demo",
      qualitySignal:
        "Same deterministic replay floor plus backend-only runtime routes and operator auth flows.",
      latencyBand: "interactive",
      costBand: "none",
      capabilitySummary: "Full backend flow without paid provider usage.",
      bestFor: [
        "backend smoke tests",
        "operator auth rehearsal",
        "runtime scorecard demos",
      ],
      tradeoffs: [
        "Quality remains deterministic rather than live-model dependent",
        "TTS remains limited",
      ],
      comparison: {
        qualityDelta: "Same replay quality, richer runtime evidence",
        latencyDelta: "Slightly slower than static demo",
        costDelta: "Still zero provider spend",
      },
    },
    {
      id: "gemini",
      label: "Gemini live",
      isCurrent: currentProvider === "gemini",
      qualitySignal: `Cloud multimodal reasoning and TTS using ${options.analyzeModel} / ${options.ttsModel}.`,
      latencyBand: "network-dependent",
      costBand: "paid",
      capabilitySummary: "Strongest live multimodal/talkback story for commander workflows.",
      bestFor: [
        "voice briefings",
        "screenshot + log incident review",
        "executive-ready live demos",
      ],
      tradeoffs: [
        "Requires cloud key management",
        "Adds network latency and paid-token cost",
        "Needs explicit reviewer trust boundary messaging",
      ],
      comparison: {
        qualityDelta: "Adds live multimodal capability on top of replay proof",
        latencyDelta: "Slower than demo lanes due to network round-trips",
        costDelta: "Highest incremental spend",
      },
    },
    {
      id: "ollama",
      label: "Ollama local",
      isCurrent: currentProvider === "ollama",
      qualitySignal: "Local-only inference path that keeps incident data off public APIs.",
      latencyBand: "host-dependent",
      costBand: "local-compute",
      capabilitySummary: "Offline/local inference for privacy-sensitive or air-gapped rehearsal.",
      bestFor: [
        "air-gapped demos",
        "privacy-first review paths",
        "local experimentation without cloud keys",
      ],
      tradeoffs: [
        "Quality depends on local model/runtime setup",
        "TTS stays unavailable",
        "Latency depends on the host machine",
      ],
      comparison: {
        qualityDelta: "Local live inference with stricter privacy posture",
        latencyDelta: "Varies with local CPU/GPU headroom",
        costDelta: "Shifts spend from tokens to local compute",
      },
    },
  ];

  return {
    ok: true,
    service: "aegisops-provider-comparison",
    version: 1,
    generatedAt: new Date().toISOString(),
    compareAgainst: "static-demo",
    summary: {
      currentProvider,
      currentMode: options.deployment === "static-demo" ? "static-demo" : options.activeProvider,
      headline: buildHeadline(currentProvider, options.deployment),
      replayBaselinePassRate: replayOverview.summary.passRate,
      replaySeverityAccuracy: replayOverview.summary.severityAccuracy,
    },
    providers,
    links: {
      providerComparison: "/api/evals/providers",
      replaySummary: "/api/evals/replays/summary",
      runtimeScorecard: "/api/runtime/scorecard",
      postmortemPack: "/api/postmortem-pack",
      meta: "/api/meta",
      healthz: "/api/healthz",
    },
  };
}
