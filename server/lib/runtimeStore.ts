import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

type RuntimeStoreBackend = "jsonl" | "sqlite";
type SqliteRow = Record<string, unknown>;
type SqliteStatement = {
  all(...params: unknown[]): SqliteRow[];
  get(...params: unknown[]): SqliteRow;
  run(...params: unknown[]): void;
};
type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
};
type DatabaseSyncCtor = new (targetPath: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
let cachedDatabaseSyncCtor: DatabaseSyncCtor | null | undefined;
const sqliteStores = new Map<string, SqliteDatabase>();

function getDatabaseSyncCtor(): DatabaseSyncCtor | null {
  if (cachedDatabaseSyncCtor !== undefined) {
    return cachedDatabaseSyncCtor;
  }
  try {
    cachedDatabaseSyncCtor = require("node:sqlite")
      .DatabaseSync as DatabaseSyncCtor;
  } catch {
    cachedDatabaseSyncCtor = null;
  }
  return cachedDatabaseSyncCtor;
}

function resolveStorePath(): string {
  const configured = String(process.env.AEGISOPS_RUNTIME_STORE_PATH || "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), ".runtime", "aegisops-runtime-events.db");
}

function resolveStoreBackend(targetPath: string): RuntimeStoreBackend {
  const configured = String(process.env.AEGISOPS_RUNTIME_STORE_BACKEND || "")
    .trim()
    .toLowerCase();
  if (configured === "jsonl" || configured === "sqlite") {
    return configured === "sqlite" && getDatabaseSyncCtor() === null
      ? "jsonl"
      : configured;
  }
  const preferredBackend = targetPath.endsWith(".jsonl") ? "jsonl" : "sqlite";
  return preferredBackend === "sqlite" && getDatabaseSyncCtor() === null
    ? "jsonl"
    : preferredBackend;
}

function ensureSqliteStore(targetPath: string): SqliteDatabase {
  const cached = sqliteStores.get(targetPath);
  if (cached) {
    return cached;
  }
  const DatabaseSync = getDatabaseSyncCtor();
  if (DatabaseSync === null) {
    throw new Error("node:sqlite is unavailable in this runtime");
  }
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const database = new DatabaseSync(targetPath);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA synchronous = NORMAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS runtime_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      elapsed_ms INTEGER NOT NULL,
      request_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_events_timestamp ON runtime_events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_runtime_events_endpoint ON runtime_events(endpoint);
  `);
  sqliteStores.set(targetPath, database);
  return database;
}

function buildJsonlSummary(targetPath: string, limit: number) {
  if (!existsSync(targetPath)) {
    return {
      backend: "jsonl" as const,
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
    backend: "jsonl" as const,
    enabled: true,
    path: targetPath,
    persistedCount: lines.length,
    lastEventAt,
    methodCounts,
    statusClasses,
    recentEvents,
  };
}

function buildSqliteSummary(targetPath: string, limit: number) {
  const database = ensureSqliteStore(targetPath);
  const countRow = database
    .prepare("SELECT COUNT(*) as count, MAX(timestamp) as last_event_at FROM runtime_events")
    .get() as { count?: number; last_event_at?: string | null };
  const methodRows = database
    .prepare(
      "SELECT method, COUNT(*) as count FROM runtime_events GROUP BY method ORDER BY method ASC"
    )
    .all() as Array<{ count?: number; method?: string }>;
  const statusRow = database
    .prepare(
      `SELECT
        SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) as ok,
        SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END) as client_error,
        SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) as server_error
      FROM runtime_events`
    )
    .get() as {
      client_error?: number;
      ok?: number;
      server_error?: number;
    };
  const recentEvents = database
    .prepare(
      `SELECT
        elapsed_ms as elapsedMs,
        endpoint,
        method,
        path,
        request_id as requestId,
        status_code as statusCode,
        timestamp
      FROM runtime_events
      ORDER BY id DESC
      LIMIT ?`
    )
    .all(Math.max(1, limit)) as RuntimeEventRecord[];

  const methodCounts = Object.fromEntries(
    methodRows.map((row) => [String(row.method || "UNKNOWN").toUpperCase(), Number(row.count || 0)])
  );

  return {
    backend: "sqlite" as const,
    enabled: true,
    path: targetPath,
    persistedCount: Number(countRow.count || 0),
    lastEventAt: countRow.last_event_at || null,
    methodCounts,
    statusClasses: {
      ok: Number(statusRow.ok || 0),
      clientError: Number(statusRow.client_error || 0),
      serverError: Number(statusRow.server_error || 0),
    },
    recentEvents: recentEvents.reverse(),
  };
}

export function appendRuntimeEvent(record: RuntimeEventRecord): void {
  const targetPath = resolveStorePath();
  const backend = resolveStoreBackend(targetPath);
  if (backend === "jsonl") {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    appendFileSync(targetPath, `${JSON.stringify(record)}\n`, "utf8");
    return;
  }

  const database = ensureSqliteStore(targetPath);
  database
    .prepare(
      `INSERT INTO runtime_events (
        timestamp,
        method,
        path,
        endpoint,
        status_code,
        elapsed_ms,
        request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.timestamp,
      record.method,
      record.path,
      record.endpoint,
      record.statusCode,
      record.elapsedMs,
      record.requestId ?? null
    );
}

export function buildRuntimeStoreSummary(limit = 25) {
  const targetPath = resolveStorePath();
  const backend = resolveStoreBackend(targetPath);
  return backend === "jsonl"
    ? buildJsonlSummary(targetPath, limit)
    : buildSqliteSummary(targetPath, limit);
}
