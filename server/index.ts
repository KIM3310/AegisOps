import dotenv from "dotenv";
dotenv.config();

import { randomUUID } from "node:crypto";
import express from "express";
import { loadConfig } from "./lib/config";
import { demoAnalyzeIncident, demoFollowUpAnswer } from "./lib/demo";
import { geminiAnalyzeIncident, geminiFollowUp, geminiTts } from "./lib/gemini";

type AnalyzeBody = {
  logs?: string;
  images?: { mimeType?: string; data?: string }[];
  options?: { enableGrounding?: boolean };
};

type FollowUpBody = {
  report?: any;
  history?: { role: "user" | "assistant"; content: string }[];
  question?: string;
  options?: { enableGrounding?: boolean };
};

type TtsBody = { text?: string };

type FollowUpHistoryItem = { role: "user" | "assistant"; content: string };

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

const cfg = loadConfig();
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "25mb" }));

function nextRequestId(): string {
  return `req-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function normalizeIp(req: express.Request): string {
  return String(req.ip || req.socket.remoteAddress || "unknown").replace(/[:.]/g, "_");
}

function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (bucket.count >= limit) return true;
  bucket.count += 1;
  return false;
}

function sendError(req: express.Request, res: express.Response, status: number, message: string): express.Response {
  return res.status(status).json({
    error: {
      message,
      requestId: req.requestId || nextRequestId(),
    },
  });
}

app.use((req, res, next) => {
  req.requestId = String(req.headers["x-request-id"] || nextRequestId());
  res.setHeader("x-request-id", req.requestId);
  res.setHeader("cache-control", "no-store");
  next();
});

app.get("/api/healthz", (req, res) => {
  res.json({
    ok: true,
    requestId: req.requestId,
    mode: cfg.mode,
    limits: { maxImages: cfg.maxImages, maxLogChars: cfg.maxLogChars },
    defaults: { grounding: cfg.groundingDefault },
    models: { analyze: cfg.modelAnalyze, tts: cfg.modelTts },
  });
});

app.post("/api/analyze", async (req, res) => {
  try {
    if (isRateLimited(`analyze:${normalizeIp(req)}`, 40, 60_000)) {
      return sendError(req, res, 429, "Too many analyze requests. Please slow down.");
    }

    const body = (req.body || {}) as AnalyzeBody;
    const logs = String(body.logs || "").slice(0, cfg.maxLogChars);
    const enableGrounding = Boolean(body.options?.enableGrounding ?? cfg.groundingDefault);

    const imagesRaw = Array.isArray(body.images) ? body.images : [];
    const images = imagesRaw
      .filter((x) => x && typeof x.data === "string" && x.data.trim().length > 0)
      .slice(0, Math.max(0, cfg.maxImages))
      .map((x) => ({
        mimeType: (x.mimeType || "image/png").trim() || "image/png",
        data: (x.data || "").trim(),
      }));

    if (cfg.mode === "demo") {
      const report = demoAnalyzeIncident({ logs, imageCount: images.length, maxLogChars: cfg.maxLogChars });
      return res.json(report);
    }

    if (!cfg.geminiApiKey) {
      return sendError(req, res, 500, "Server misconfigured: GEMINI_API_KEY missing.");
    }

    const report = await geminiAnalyzeIncident({
      apiKey: cfg.geminiApiKey,
      model: cfg.modelAnalyze,
      logs,
      images,
      enableGrounding,
      maxLogChars: cfg.maxLogChars,
    });
    return res.json(report);
  } catch (e: any) {
    const message = e?.message || String(e);
    return sendError(req, res, 400, message);
  }
});

app.post("/api/followup", async (req, res) => {
  try {
    if (isRateLimited(`followup:${normalizeIp(req)}`, 120, 60_000)) {
      return sendError(req, res, 429, "Too many follow-up requests. Please slow down.");
    }

    const body = (req.body || {}) as FollowUpBody;
    const question = String(body.question || "").trim().slice(0, Math.max(200, cfg.maxLogChars));
    if (!question) return sendError(req, res, 400, "Missing question.");

    const enableGrounding = Boolean(body.options?.enableGrounding ?? cfg.groundingDefault);
    const report = body.report;
    const historyRaw = Array.isArray(body.history) ? body.history : [];
    const history: FollowUpHistoryItem[] = historyRaw
      .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .slice(-20)
      .map((item) => ({
        role: item.role,
        content: item.content.trim().slice(0, 4_000),
      }))
      .filter((item) => item.content.length > 0);

    if (cfg.mode === "demo") {
      const answer = demoFollowUpAnswer({ report, question });
      return res.json({ answer });
    }

    if (!cfg.geminiApiKey) {
      return sendError(req, res, 500, "Server misconfigured: GEMINI_API_KEY missing.");
    }

    const answer = await geminiFollowUp({
      apiKey: cfg.geminiApiKey,
      model: cfg.modelAnalyze,
      report,
      history,
      question,
      enableGrounding,
    });
    return res.json({ answer });
  } catch (e: any) {
    const message = e?.message || String(e);
    return sendError(req, res, 400, message);
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    if (isRateLimited(`tts:${normalizeIp(req)}`, 60, 60_000)) {
      return sendError(req, res, 429, "Too many TTS requests. Please slow down.");
    }

    const body = (req.body || {}) as TtsBody;
    const text = String(body.text || "").trim();
    if (!text) return sendError(req, res, 400, "Missing text.");

    if (cfg.mode === "demo") return res.json({ audioBase64: undefined });
    if (!cfg.geminiApiKey) {
      return sendError(req, res, 500, "Server misconfigured: GEMINI_API_KEY missing.");
    }

    const audioBase64 = await geminiTts({ apiKey: cfg.geminiApiKey, model: cfg.modelTts, text });
    return res.json({ audioBase64 });
  } catch (e: any) {
    const message = e?.message || String(e);
    return sendError(req, res, 400, message);
  }
});

app.listen(cfg.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] AegisOps API listening on http://127.0.0.1:${cfg.port} (mode=${cfg.mode})`);
});
