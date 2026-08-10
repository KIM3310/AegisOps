import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const assetDir = path.join(repoRoot, "docs", "datadog", "assets");
const site = (process.env.DD_SITE || "datadoghq.com").trim();
const apiKey = (process.env.DD_API_KEY || "").trim();
const appKey = (process.env.DD_APP_KEY || "").trim();
const service = (process.env.DD_SERVICE || "aegisops").trim();
const env = (process.env.DD_ENV || "production").trim();
const prefix = (process.env.DD_DASHBOARD_PREFIX || "Portfolio").trim();

function applyTemplates(value, replacements) {
  if (typeof value === "string") {
    return value.replace(/\{\{(PREFIX|SERVICE|ENV)\}\}/g, (_, key) => replacements[key]);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => applyTemplates(entry, replacements));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, applyTemplates(entry, replacements)])
    );
  }
  return value;
}

async function readJson(filename) {
  const body = await fs.readFile(path.join(assetDir, filename), "utf8");
  return JSON.parse(body);
}

async function loadAssets() {
  const replacements = {
    PREFIX: prefix,
    SERVICE: service,
    ENV: env,
  };

  return {
    dashboard: applyTemplates(await readJson("dashboard.json"), replacements),
    monitors: applyTemplates(await readJson("monitors.json"), replacements),
  };
}

async function datadogRequest(method, apiPath, body, { requireAppKey = true } = {}) {
  if (!apiKey) {
    throw new Error("DD_API_KEY is required for Datadog API calls.");
  }
  if (requireAppKey && !appKey) {
    throw new Error("DD_APP_KEY is required for dashboard and monitor sync.");
  }

  const response = await fetch(`https://api.${site}${apiPath}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "DD-API-KEY": apiKey,
      ...(requireAppKey ? { "DD-APPLICATION-KEY": appKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    const requestReference = requestId ? ` (request ID ${requestId})` : "";
    throw new Error(`${method} ${apiPath} failed (${response.status})${requestReference}`);
  }

  return response.status === 204 ? null : response.json();
}

async function validateCredentials({ requireApplicationCredential = false } = {}) {
  if (!apiKey) {
    throw new Error("DD_API_KEY is required to validate Datadog credentials.");
  }
  if (requireApplicationCredential && !appKey) {
    throw new Error("DD_APP_KEY is required to validate Datadog credentials for asset sync.");
  }

  const apiValidation = await datadogRequest(
    "GET",
    "/api/v1/validate",
    undefined,
    { requireAppKey: false }
  );
  if (apiValidation?.valid !== true) {
    throw new Error("Datadog rejected the configured API credential.");
  }
}

async function syncAssets() {
  const { dashboard, monitors } = await loadAssets();
  const dashboards = await datadogRequest("GET", "/api/v1/dashboard");
  const existingDashboard = dashboards.dashboards?.find((entry) => entry.title === dashboard.title);

  const dashboardResult = existingDashboard
    ? await datadogRequest("PUT", `/api/v1/dashboard/${existingDashboard.id}`, dashboard)
    : await datadogRequest("POST", "/api/v1/dashboard", dashboard);

  const existingMonitors = await datadogRequest("GET", "/api/v1/monitor");
  const results = [];
  for (const monitor of monitors) {
    const existing = existingMonitors.find((entry) => entry.name === monitor.name);
    const result = existing
      ? await datadogRequest("PUT", `/api/v1/monitor/${existing.id}`, monitor)
      : await datadogRequest("POST", "/api/v1/monitor", monitor);
    results.push({
      id: result.id,
      name: result.name ?? monitor.name,
      mode: existing ? "updated" : "created",
    });
  }

  return {
    dashboard: {
      id: dashboardResult.id,
      title: dashboardResult.title ?? dashboard.title,
      mode: existingDashboard ? "updated" : "created",
    },
    monitors: results,
  };
}

async function main() {
  const mode = process.argv[2] ?? "plan";
  const assets = await loadAssets();

  if (mode === "plan") {
    console.log(
      JSON.stringify(
        {
          site,
          service,
          env,
          prefix,
          dashboard: assets.dashboard.title,
          monitors: assets.monitors.map((monitor) => monitor.name),
        },
        null,
        2
      )
    );
    return;
  }

  if (mode === "validate") {
    await validateCredentials();
    console.log("Datadog credential preflight passed.");
    return;
  }

  if (mode === "sync") {
    await validateCredentials({ requireApplicationCredential: true });
    const result = await syncAssets();
    console.log("Datadog credential preflight passed.");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
