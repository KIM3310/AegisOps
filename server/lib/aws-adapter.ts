/**
 * AWS Integration Adapter for AegisOps
 *
 * Provides S3 upload for incident reports and export bundles,
 * CloudWatch Logs integration for structured logging,
 * and SQS placeholder for async analysis pipelines.
 *
 * All functionality is gated by the AWS_ACCESS_KEY_ID env var.
 * When the env var is absent, every public function is a safe no-op.
 */

import { createHash } from "node:crypto";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AwsConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  s3Bucket: string;
  sqsQueueUrl?: string;
  cloudwatchLogGroup?: string;
  cloudwatchLogStream?: string;
}

export interface S3PutResult {
  bucket: string;
  key: string;
  etag: string;
  uploadedAt: string;
  contentLength: number;
}

export interface CloudWatchLogEntry {
  timestamp: number;
  message: string;
}

export interface SqsMessageResult {
  messageId: string;
  queueUrl: string;
  sentAt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadAwsConfig(): AwsConfig | null {
  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID ?? "").trim();
  if (!accessKeyId) return null;

  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY ?? "").trim();
  if (!secretAccessKey) {
    logger.warn({ event: "aws-adapter-missing-secret" }, "AWS_ACCESS_KEY_ID is set but AWS_SECRET_ACCESS_KEY is missing");
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    region: (process.env.AWS_REGION ?? "us-east-1").trim(),
    s3Bucket: (process.env.AWS_S3_BUCKET ?? "aegisops-reports").trim(),
    sqsQueueUrl: (process.env.AWS_SQS_QUEUE_URL ?? "").trim() || undefined,
    cloudwatchLogGroup: (process.env.AWS_CLOUDWATCH_LOG_GROUP ?? "aegisops").trim() || undefined,
    cloudwatchLogStream: (process.env.AWS_CLOUDWATCH_LOG_STREAM ?? "api").trim() || undefined,
  };
}

let cachedConfig: AwsConfig | null | undefined;

function getConfig(): AwsConfig | null {
  if (cachedConfig === undefined) {
    cachedConfig = loadAwsConfig();
  }
  return cachedConfig;
}

/**
 * Build an AWS Signature Version 4 authorization header.
 * This is a minimal implementation covering the subset needed for
 * S3 PUT, CloudWatch PutLogEvents, and SQS SendMessage.
 */
function hmacSha256(key: Buffer | string, data: string): Buffer {
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

interface SignedRequestOptions {
  method: string;
  service: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string | Buffer;
  config: AwsConfig;
}

function signRequest(options: SignedRequestOptions): Record<string, string> {
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const credentialScope = `${dateStamp}/${options.config.region}/${options.service}/aws4_request`;
  const payloadHash = sha256Hex(typeof options.body === "string" ? Buffer.from(options.body) : options.body);

  const signedHeaders: Record<string, string> = {
    ...options.headers,
    host: options.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };

  const sortedHeaderKeys = Object.keys(signedHeaders).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k.toLowerCase()}:${signedHeaders[k]?.trim()}\n`).join("");
  const signedHeaderList = sortedHeaderKeys.map((k) => k.toLowerCase()).join(";");

  const canonicalRequest = [
    options.method,
    options.path,
    "", // query string
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = getSignatureKey(options.config.secretAccessKey, dateStamp, options.config.region, options.service);
  const signature = hmacSha256(signingKey, stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${options.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`;

  return {
    ...signedHeaders,
    authorization,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true when AWS integration is configured and available. */
export function isAwsEnabled(): boolean {
  return getConfig() !== null;
}

/** Return a sanitised view of the current AWS config (no secrets). */
export function getAwsStatus(): {
  enabled: boolean;
  region: string | null;
  s3Bucket: string | null;
  sqsConfigured: boolean;
  cloudwatchConfigured: boolean;
} {
  const cfg = getConfig();
  if (!cfg) {
    return {
      enabled: false,
      region: null,
      s3Bucket: null,
      sqsConfigured: false,
      cloudwatchConfigured: false,
    };
  }
  return {
    enabled: true,
    region: cfg.region,
    s3Bucket: cfg.s3Bucket,
    sqsConfigured: Boolean(cfg.sqsQueueUrl),
    cloudwatchConfigured: Boolean(cfg.cloudwatchLogGroup),
  };
}

/**
 * Upload an incident report or export bundle to S3.
 *
 * @param key   - S3 object key (e.g. `reports/2026-03-20/incident-abc.json`)
 * @param body  - stringified JSON or Buffer payload
 * @param contentType - MIME type (default `application/json`)
 * @returns S3PutResult on success, null when AWS is disabled
 */
export async function s3PutObject(
  key: string,
  body: string | Buffer,
  contentType = "application/json"
): Promise<S3PutResult | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  const host = `${cfg.s3Bucket}.s3.${cfg.region}.amazonaws.com`;
  const path = `/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
  const bodyBuffer = typeof body === "string" ? Buffer.from(body, "utf-8") : body;

  const headers = signRequest({
    method: "PUT",
    service: "s3",
    host,
    path,
    headers: {
      "content-type": contentType,
      "content-length": String(bodyBuffer.length),
    },
    body: bodyBuffer,
    config: cfg,
  });

  const url = `https://${host}${path}`;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: bodyBuffer,
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.error(
        { event: "aws-s3-put-failed", status: response.status, key, errBody },
        "S3 PUT failed"
      );
      throw new Error(`S3 PUT failed: ${response.status}`);
    }

    const etag = response.headers.get("etag") ?? "";
    logger.info({ event: "aws-s3-put-success", bucket: cfg.s3Bucket, key, etag }, "S3 upload complete");

    return {
      bucket: cfg.s3Bucket,
      key,
      etag,
      uploadedAt: new Date().toISOString(),
      contentLength: bodyBuffer.length,
    };
  } catch (error) {
    logger.error(
      { event: "aws-s3-put-error", key, error: error instanceof Error ? error.message : String(error) },
      "S3 upload error"
    );
    throw error;
  }
}

/**
 * Upload an incident report to S3 with a standardised key structure.
 */
export async function uploadIncidentReport(
  reportId: string,
  report: Record<string, unknown>
): Promise<S3PutResult | null> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `reports/${date}/${reportId}.json`;
  const body = JSON.stringify(report, null, 2);
  return s3PutObject(key, body);
}

/**
 * Upload an export bundle to S3.
 */
export async function uploadExportBundle(
  bundleId: string,
  bundle: Record<string, unknown>
): Promise<S3PutResult | null> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `bundles/${date}/${bundleId}.json`;
  const body = JSON.stringify(bundle, null, 2);
  return s3PutObject(key, body);
}

/**
 * Send structured log entries to CloudWatch Logs.
 *
 * @param entries - array of log entries with timestamp and message
 * @returns true on success, false when disabled, throws on error
 */
export async function putCloudWatchLogs(entries: CloudWatchLogEntry[]): Promise<boolean> {
  const cfg = getConfig();
  if (!cfg || !cfg.cloudwatchLogGroup) return false;
  if (entries.length === 0) return true;

  const host = `logs.${cfg.region}.amazonaws.com`;
  const path = "/";
  const payload = JSON.stringify({
    logGroupName: cfg.cloudwatchLogGroup,
    logStreamName: cfg.cloudwatchLogStream ?? "api",
    logEvents: entries.map((e) => ({
      timestamp: e.timestamp,
      message: e.message,
    })),
  });

  const headers = signRequest({
    method: "POST",
    service: "logs",
    host,
    path,
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "Logs_20140328.PutLogEvents",
    },
    body: payload,
    config: cfg,
  });

  try {
    const response = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers,
      body: payload,
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.error(
        { event: "aws-cloudwatch-put-failed", status: response.status, errBody },
        "CloudWatch PutLogEvents failed"
      );
      return false;
    }

    logger.info(
      { event: "aws-cloudwatch-put-success", entryCount: entries.length },
      "CloudWatch log entries sent"
    );
    return true;
  } catch (error) {
    logger.error(
      { event: "aws-cloudwatch-put-error", error: error instanceof Error ? error.message : String(error) },
      "CloudWatch log send error"
    );
    return false;
  }
}

/**
 * Convenience: send a single structured log to CloudWatch.
 */
export async function logToCloudWatch(
  level: "INFO" | "WARN" | "ERROR",
  event: string,
  data: Record<string, unknown>
): Promise<boolean> {
  return putCloudWatchLogs([
    {
      timestamp: Date.now(),
      message: JSON.stringify({ level, event, ...data, service: "aegisops-api" }),
    },
  ]);
}

/**
 * Send an async analysis job to SQS.
 *
 * This is a placeholder for a future async pipeline. The queue URL
 * must be set via AWS_SQS_QUEUE_URL. Returns null when disabled.
 */
export async function sendToSqs(
  messageBody: Record<string, unknown>,
  messageGroupId = "aegisops-analysis"
): Promise<SqsMessageResult | null> {
  const cfg = getConfig();
  if (!cfg || !cfg.sqsQueueUrl) return null;

  const host = new URL(cfg.sqsQueueUrl).host;
  const path = new URL(cfg.sqsQueueUrl).pathname;
  const payload = new URLSearchParams({
    Action: "SendMessage",
    MessageBody: JSON.stringify(messageBody),
    MessageGroupId: messageGroupId,
    Version: "2012-11-05",
  }).toString();

  const headers = signRequest({
    method: "POST",
    service: "sqs",
    host,
    path,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: payload,
    config: cfg,
  });

  try {
    const response = await fetch(cfg.sqsQueueUrl, {
      method: "POST",
      headers,
      body: payload,
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.error(
        { event: "aws-sqs-send-failed", status: response.status, errBody },
        "SQS SendMessage failed"
      );
      throw new Error(`SQS SendMessage failed: ${response.status}`);
    }

    const responseText = await response.text();
    const messageIdMatch = responseText.match(/<MessageId>([^<]+)<\/MessageId>/);
    const messageId = messageIdMatch?.[1] ?? "unknown";

    logger.info(
      { event: "aws-sqs-send-success", messageId, queueUrl: cfg.sqsQueueUrl },
      "SQS message sent"
    );

    return {
      messageId,
      queueUrl: cfg.sqsQueueUrl,
      sentAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(
      { event: "aws-sqs-send-error", error: error instanceof Error ? error.message : String(error) },
      "SQS send error"
    );
    throw error;
  }
}

/**
 * Reset cached config (useful for testing).
 */
export function resetAwsConfig(): void {
  cachedConfig = undefined;
}
