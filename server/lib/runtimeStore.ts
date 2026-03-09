import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type RuntimeEventRecord = {
  elapsedMs: number;
  endpoint: string;
  method: string;
  path: string;
  requestId?: string;
  statusCode: number;
  timestamp: string;
};

function resolveStorePath(): string {
  const configured = String(process.env.AEGISOPS_RUNTIME_STORE_PATH || "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), ".runtime", "aegisops-runtime-events.jsonl");
}

export function appendRuntimeEvent(record: RuntimeEventRecord): void {
  const targetPath = resolveStorePath();
  mkdirSync(path.dirname(targetPath), { recursive: true });
  appendFileSync(targetPath, `${JSON.stringify(record)}\n`, "utf8");
}

export function buildRuntimeStoreSummary(limit = 25) {
  const targetPath = resolveStorePath();
  if (!existsSync(targetPath)) {
    return {
      enabled: true,
      path: targetPath,
      persistedCount: 0,
      lastEventAt: null as string | null,
      methodCounts: {} as Record<string, number>,
      statusClasses: {
        ok: 0,
        clientError: 0,
        serverError: 0,
      },
      recentEvents: [] as RuntimeEventRecord[],
    };
  }

  const lines = readFileSync(targetPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const recentEvents = lines
    .slice(-Math.max(1, limit))
    .map((line) => {
      try {
        return JSON.parse(line) as RuntimeEventRecord;
      } catch {
        return null;
      }
    })
    .filter((item): item is RuntimeEventRecord => item !== null);

  const methodCounts: Record<string, number> = {};
  const statusClasses = {
    ok: 0,
    clientError: 0,
    serverError: 0,
  };
  let lastEventAt: string | null = null;

  for (const event of recentEvents) {
    const method = String(event.method || "UNKNOWN").toUpperCase();
    methodCounts[method] = (methodCounts[method] ?? 0) + 1;
    if (event.statusCode >= 500) {
      statusClasses.serverError += 1;
    } else if (event.statusCode >= 400) {
      statusClasses.clientError += 1;
    } else {
      statusClasses.ok += 1;
    }
    if (lastEventAt === null || event.timestamp > lastEventAt) {
      lastEventAt = event.timestamp;
    }
  }

  return {
    enabled: true,
    path: targetPath,
    persistedCount: lines.length,
    lastEventAt,
    methodCounts,
    statusClasses,
    recentEvents,
  };
}
