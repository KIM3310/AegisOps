/**
 * GCP Integration Adapter for AegisOps
 *
 * Provides Cloud Storage for report persistence and
 * BigQuery for incident analytics.
 *
 * All functionality is gated by the GOOGLE_APPLICATION_CREDENTIALS env var.
 * When the env var is absent, every public function is a safe no-op.
 */

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GcpConfig {
  projectId: string;
  credentialsPath: string;
  storageBucket: string;
  bigqueryDataset: string;
  serviceAccountEmail: string;
  privateKey: string;
}

export interface GcsUploadResult {
  bucket: string;
  name: string;
  generation: string;
  uploadedAt: string;
  contentLength: number;
  selfLink: string;
}

export interface BigQueryInsertResult {
  tableId: string;
  insertedRows: number;
  insertedAt: string;
}

export interface BigQueryQueryResult {
  totalRows: number;
  rows: Record<string, unknown>[];
  queriedAt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ServiceAccountKey {
  type?: string;
  project_id?: string;
  private_key?: string;
  client_email?: string;
  token_uri?: string;
}

function loadServiceAccountKey(path: string): ServiceAccountKey | null {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as ServiceAccountKey;
  } catch (error) {
    logger.error(
      { event: "gcp-adapter-credentials-load-failed", path, error: error instanceof Error ? error.message : String(error) },
      "Failed to load GCP service account key"
    );
    return null;
  }
}

function loadGcpConfig(): GcpConfig | null {
  const credentialsPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "").trim();
  if (!credentialsPath) return null;

  const key = loadServiceAccountKey(credentialsPath);
  if (!key || !key.private_key || !key.client_email) {
    logger.warn(
      { event: "gcp-adapter-invalid-credentials" },
      "GOOGLE_APPLICATION_CREDENTIALS points to an invalid or incomplete key file"
    );
    return null;
  }

  return {
    projectId: (process.env.GCP_PROJECT_ID ?? key.project_id ?? "").trim(),
    credentialsPath,
    storageBucket: (process.env.GCP_STORAGE_BUCKET ?? "aegisops-reports").trim(),
    bigqueryDataset: (process.env.GCP_BIGQUERY_DATASET ?? "aegisops_analytics").trim(),
    serviceAccountEmail: key.client_email,
    privateKey: key.private_key,
  };
}

let cachedConfig: GcpConfig | null | undefined;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function getConfig(): GcpConfig | null {
  if (cachedConfig === undefined) {
    cachedConfig = loadGcpConfig();
  }
  return cachedConfig;
}

/**
 * Generate a self-signed JWT and exchange it for a GCP access token.
 * Implements the OAuth 2.0 service-account flow without the googleapis SDK.
 */
function createJwt(cfg: GcpConfig, scopes: string[]): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: cfg.serviceAccountEmail,
      scope: scopes.join(" "),
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  ).toString("base64url");

  const signable = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signable);
  const signature = signer.sign(cfg.privateKey, "base64url");

  return `${signable}.${signature}`;
}

async function getAccessToken(cfg: GcpConfig): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const jwt = createJwt(cfg, [
    "https://www.googleapis.com/auth/devstorage.read_write",
    "https://www.googleapis.com/auth/bigquery",
  ]);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!response.ok) {
    const errBody = await response.text();
    logger.error({ event: "gcp-token-exchange-failed", status: response.status, errBody }, "GCP token exchange failed");
    throw new Error(`GCP token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  const token = data.access_token ?? "";
  const expiresIn = data.expires_in ?? 3600;

  cachedAccessToken = {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return token;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true when GCP integration is configured and available. */
export function isGcpEnabled(): boolean {
  return getConfig() !== null;
}

/** Return a sanitised view of the current GCP config (no secrets). */
export function getGcpStatus(): {
  enabled: boolean;
  projectId: string | null;
  storageBucket: string | null;
  bigqueryDataset: string | null;
} {
  const cfg = getConfig();
  if (!cfg) {
    return {
      enabled: false,
      projectId: null,
      storageBucket: null,
      bigqueryDataset: null,
    };
  }
  return {
    enabled: true,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket,
    bigqueryDataset: cfg.bigqueryDataset,
  };
}

/**
 * Upload an object to Google Cloud Storage.
 *
 * @param objectName  - Object name / path within the bucket
 * @param body        - String or Buffer payload
 * @param contentType - MIME type (default `application/json`)
 */
export async function gcsUploadObject(
  objectName: string,
  body: string | Buffer,
  contentType = "application/json"
): Promise<GcsUploadResult | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  const token = await getAccessToken(cfg);
  const encodedName = encodeURIComponent(objectName);
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${cfg.storageBucket}/o?uploadType=media&name=${encodedName}`;
  const bodyBuffer = typeof body === "string" ? Buffer.from(body, "utf-8") : body;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
        "Content-Length": String(bodyBuffer.length),
      },
      body: bodyBuffer,
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.error(
        { event: "gcp-gcs-upload-failed", status: response.status, objectName, errBody },
        "GCS upload failed"
      );
      throw new Error(`GCS upload failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      name?: string;
      generation?: string;
      selfLink?: string;
    };

    logger.info(
      { event: "gcp-gcs-upload-success", bucket: cfg.storageBucket, objectName },
      "GCS upload complete"
    );

    return {
      bucket: cfg.storageBucket,
      name: data.name ?? objectName,
      generation: data.generation ?? "",
      uploadedAt: new Date().toISOString(),
      contentLength: bodyBuffer.length,
      selfLink: data.selfLink ?? "",
    };
  } catch (error) {
    logger.error(
      { event: "gcp-gcs-upload-error", objectName, error: error instanceof Error ? error.message : String(error) },
      "GCS upload error"
    );
    throw error;
  }
}

/**
 * Upload an incident report to Cloud Storage with a standardised path.
 */
export async function uploadIncidentReport(
  reportId: string,
  report: Record<string, unknown>
): Promise<GcsUploadResult | null> {
  const date = new Date().toISOString().slice(0, 10);
  const objectName = `reports/${date}/${reportId}.json`;
  const body = JSON.stringify(report, null, 2);
  return gcsUploadObject(objectName, body);
}

/**
 * Stream rows into a BigQuery table using the tabledata.insertAll API.
 *
 * @param tableId - The BigQuery table ID (within the configured dataset)
 * @param rows    - Array of row objects to insert
 */
export async function bigqueryInsertRows(
  tableId: string,
  rows: Record<string, unknown>[]
): Promise<BigQueryInsertResult | null> {
  const cfg = getConfig();
  if (!cfg) return null;
  if (rows.length === 0) return { tableId, insertedRows: 0, insertedAt: new Date().toISOString() };

  const token = await getAccessToken(cfg);
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${cfg.projectId}/datasets/${cfg.bigqueryDataset}/tables/${tableId}/insertAll`;

  const payload = JSON.stringify({
    rows: rows.map((row, idx) => ({
      insertId: `aegisops-${Date.now()}-${idx}`,
      json: row,
    })),
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.error(
        { event: "gcp-bigquery-insert-failed", status: response.status, tableId, errBody },
        "BigQuery insertAll failed"
      );
      throw new Error(`BigQuery insertAll failed: ${response.status}`);
    }

    const data = (await response.json()) as { insertErrors?: unknown[] };
    if (data.insertErrors && Array.isArray(data.insertErrors) && data.insertErrors.length > 0) {
      logger.warn(
        { event: "gcp-bigquery-partial-errors", tableId, errorCount: data.insertErrors.length },
        "BigQuery insertAll had partial errors"
      );
    }

    logger.info(
      { event: "gcp-bigquery-insert-success", tableId, rowCount: rows.length },
      "BigQuery rows inserted"
    );

    return {
      tableId,
      insertedRows: rows.length,
      insertedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(
      { event: "gcp-bigquery-insert-error", tableId, error: error instanceof Error ? error.message : String(error) },
      "BigQuery insert error"
    );
    throw error;
  }
}

/**
 * Run a BigQuery SQL query and return the result rows.
 *
 * @param query - SQL query string
 */
export async function bigqueryQuery(query: string): Promise<BigQueryQueryResult | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  const token = await getAccessToken(cfg);
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${cfg.projectId}/queries`;

  const payload = JSON.stringify({
    query,
    useLegacySql: false,
    defaultDataset: {
      projectId: cfg.projectId,
      datasetId: cfg.bigqueryDataset,
    },
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.error(
        { event: "gcp-bigquery-query-failed", status: response.status, errBody },
        "BigQuery query failed"
      );
      throw new Error(`BigQuery query failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      totalRows?: string;
      rows?: Array<{ f?: Array<{ v?: unknown }> }>;
      schema?: { fields?: Array<{ name?: string }> };
    };

    const fieldNames = (data.schema?.fields ?? []).map((f) => f.name ?? "");
    const resultRows: Record<string, unknown>[] = (data.rows ?? []).map((row) => {
      const obj: Record<string, unknown> = {};
      (row.f ?? []).forEach((cell, idx) => {
        const fieldName = fieldNames[idx] ?? `col_${idx}`;
        obj[fieldName] = cell.v;
      });
      return obj;
    });

    return {
      totalRows: resultRows.length,
      rows: resultRows,
      queriedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(
      { event: "gcp-bigquery-query-error", error: error instanceof Error ? error.message : String(error) },
      "BigQuery query error"
    );
    throw error;
  }
}

/**
 * Record an incident analysis event to BigQuery for analytics.
 */
export async function recordIncidentAnalytics(event: {
  reportId: string;
  severity: string;
  provider: string;
  analysisLatencyMs: number;
  imageCount: number;
  logChars: number;
  timestamp?: string;
}): Promise<BigQueryInsertResult | null> {
  return bigqueryInsertRows("incident_events", [
    {
      report_id: event.reportId,
      severity: event.severity,
      provider: event.provider,
      analysis_latency_ms: event.analysisLatencyMs,
      image_count: event.imageCount,
      log_chars: event.logChars,
      event_timestamp: event.timestamp ?? new Date().toISOString(),
    },
  ]);
}

/**
 * Reset cached config and token (useful for testing).
 */
export function resetGcpConfig(): void {
  cachedConfig = undefined;
  cachedAccessToken = null;
}
