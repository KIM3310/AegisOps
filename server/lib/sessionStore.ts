import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type LiveSessionLane =
  | "incident-command"
  | "commander-handoff"
  | "review"
  | "training";

export type LiveSessionEventKind = "analyze" | "followup" | "tts";

export type LiveSessionEventRecord = {
  eventKind: LiveSessionEventKind;
  imageCount?: number;
  lane: LiveSessionLane;
  logsChars?: number;
  provider: string;
  question?: string;
  reportSeverity?: string;
  reportSummary?: string;
  reportTitle?: string;
  requestId?: string;
  sessionId: string;
  timestamp: string;
  ttsChars?: number;
};

function resolveSessionStorePath(): string {
  const configured = String(process.env.AEGISOPS_SESSION_STORE_PATH || "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), ".runtime", "aegisops-live-sessions.jsonl");
}

export function normalizeLiveSessionId(value: string | undefined, fallback: string): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
  return normalized || fallback;
}

export function normalizeLiveSessionLane(value: string | undefined): LiveSessionLane {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  switch (normalized) {
    case "commander-handoff":
    case "review":
    case "training":
      return normalized;
    default:
      return "incident-command";
  }
}

export function appendLiveSessionEvent(record: LiveSessionEventRecord): void {
  const targetPath = resolveSessionStorePath();
  mkdirSync(path.dirname(targetPath), { recursive: true });
  appendFileSync(targetPath, `${JSON.stringify(record)}\n`, "utf8");
}

function readLiveSessionEvents(): LiveSessionEventRecord[] {
  const targetPath = resolveSessionStorePath();
  if (!existsSync(targetPath)) return [];
  return readFileSync(targetPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LiveSessionEventRecord;
      } catch {
        return null;
      }
    })
    .filter((item): item is LiveSessionEventRecord => item !== null);
}

type LiveSessionSummary = {
  eventCount: number;
  lanes: LiveSessionLane[];
  lastEventAt: string;
  latestSummary: string | null;
  latestTitle: string | null;
  providerMix: string[];
  sessionId: string;
};

function buildSessionSummaries(events: LiveSessionEventRecord[]): LiveSessionSummary[] {
  const grouped = new Map<string, LiveSessionEventRecord[]>();
  for (const event of events) {
    const bucket = grouped.get(event.sessionId) ?? [];
    bucket.push(event);
    grouped.set(event.sessionId, bucket);
  }

  return [...grouped.entries()]
    .map(([sessionId, sessionEvents]) => {
      const sorted = sessionEvents.slice().sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      const last = sorted.at(-1);
      return {
        sessionId,
        eventCount: sorted.length,
        lastEventAt: last?.timestamp ?? "",
        lanes: Array.from(new Set(sorted.map((item) => item.lane))),
        providerMix: Array.from(new Set(sorted.map((item) => item.provider))),
        latestTitle: [...sorted]
          .reverse()
          .find((item) => typeof item.reportTitle === "string" && item.reportTitle.trim().length > 0)?.reportTitle ?? null,
        latestSummary: [...sorted]
          .reverse()
          .find((item) => typeof item.reportSummary === "string" && item.reportSummary.trim().length > 0)?.reportSummary ?? null,
      };
    })
    .sort((left, right) => right.lastEventAt.localeCompare(left.lastEventAt));
}

export function buildLiveSessionList(options?: {
  lane?: LiveSessionLane;
  limit?: number;
}) {
  const laneFilter = options?.lane;
  const limit = Math.max(1, Math.min(Math.trunc(options?.limit ?? 10), 25));
  const events = readLiveSessionEvents();
  const summaries = buildSessionSummaries(events).filter((item) =>
    laneFilter ? item.lanes.includes(laneFilter) : true
  );

  return {
    ok: true,
    service: "aegisops-live-sessions",
    generatedAt: new Date().toISOString(),
    schema: "aegisops-live-session-list-v1",
    filters: {
      lane: laneFilter ?? null,
      limit,
    },
    summary: {
      totalSessions: summaries.length,
      totalEvents: events.length,
      lanes: Array.from(new Set(summaries.flatMap((item) => item.lanes))),
    },
    items: summaries.slice(0, limit),
  };
}

export function buildLiveSessionDetail(sessionId: string) {
  const events = readLiveSessionEvents()
    .filter((item) => item.sessionId === sessionId)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (events.length === 0) return null;

  const summary = buildSessionSummaries(events)[0];
  const reviewTimeline = events.map((item) => ({
    at: item.timestamp,
    eventKind: item.eventKind,
    lane: item.lane,
    provider: item.provider,
    requestId: item.requestId ?? null,
    reportTitle: item.reportTitle ?? null,
    reportSeverity: item.reportSeverity ?? null,
    question: item.question ?? null,
  }));

  return {
    ok: true,
    service: "aegisops-live-session-detail",
    generatedAt: new Date().toISOString(),
    schema: "aegisops-live-session-detail-v1",
    sessionId,
    summary,
    reviewTimeline,
    links: {
      liveSessionPack: "/api/live-session-pack",
      liveSessions: "/api/live-sessions",
      summaryPack: "/api/summary-pack",
      runtimeScorecard: "/api/runtime/scorecard",
      reportSchema: "/api/schema/report",
    },
  };
}

export function buildSeverityTrendAggregation() {
  const events = readLiveSessionEvents();
  const buckets = { SEV1: 0, SEV2: 0, SEV3: 0, UNKNOWN: 0 };
  for (const event of events) {
    const sev = (event.reportSeverity || "").toUpperCase().trim();
    if (sev === "SEV1" || sev === "SEV2" || sev === "SEV3") {
      buckets[sev]++;
    } else if (sev) {
      buckets.UNKNOWN++;
    }
  }
  return {
    ok: true,
    service: "aegisops-severity-trend",
    generatedAt: new Date().toISOString(),
    schema: "aegisops-severity-trend-v1",
    totalEventsScanned: events.length,
    severityCounts: buckets,
  };
}

export function buildLiveSessionStoreSummary(limit = 5) {
  const targetPath = resolveSessionStorePath();
  const events = readLiveSessionEvents();
  const items = buildSessionSummaries(events).slice(0, Math.max(1, limit));
  return {
    enabled: true,
    path: targetPath,
    sessionCount: items.length,
    totalEvents: events.length,
    recentSessions: items,
  };
}
