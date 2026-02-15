import dotenv from "dotenv";
dotenv.config();

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

const cfg = loadConfig();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "25mb" }));

app.get("/api/healthz", (_req, res) => {
  res.json({
    ok: true,
    mode: cfg.mode,
    limits: { maxImages: cfg.maxImages, maxLogChars: cfg.maxLogChars },
    defaults: { grounding: cfg.groundingDefault },
    models: { analyze: cfg.modelAnalyze, tts: cfg.modelTts },
  });
});

app.post("/api/analyze", async (req, res) => {
  try {
    const body = (req.body || {}) as AnalyzeBody;
    const logs = String(body.logs || "");
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
      return res.status(500).json({ error: { message: "Server misconfigured: GEMINI_API_KEY missing." } });
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
    return res.status(400).json({ error: { message } });
  }
});

app.post("/api/followup", async (req, res) => {
  try {
    const body = (req.body || {}) as FollowUpBody;
    const question = String(body.question || "").trim();
    if (!question) return res.status(400).json({ error: { message: "Missing question." } });

    const enableGrounding = Boolean(body.options?.enableGrounding ?? cfg.groundingDefault);
    const report = body.report;
    const history = Array.isArray(body.history) ? body.history : [];

    if (cfg.mode === "demo") {
      const answer = demoFollowUpAnswer({ report, question });
      return res.json({ answer });
    }

    if (!cfg.geminiApiKey) {
      return res.status(500).json({ error: { message: "Server misconfigured: GEMINI_API_KEY missing." } });
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
    return res.status(400).json({ error: { message } });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const body = (req.body || {}) as TtsBody;
    const text = String(body.text || "").trim();
    if (!text) return res.status(400).json({ error: { message: "Missing text." } });

    if (cfg.mode === "demo") return res.json({ audioBase64: undefined });
    if (!cfg.geminiApiKey) {
      return res.status(500).json({ error: { message: "Server misconfigured: GEMINI_API_KEY missing." } });
    }

    const audioBase64 = await geminiTts({ apiKey: cfg.geminiApiKey, model: cfg.modelTts, text });
    return res.json({ audioBase64 });
  } catch (e: any) {
    const message = e?.message || String(e);
    return res.status(400).json({ error: { message } });
  }
});

app.listen(cfg.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] AegisOps API listening on http://127.0.0.1:${cfg.port} (mode=${cfg.mode})`);
});

