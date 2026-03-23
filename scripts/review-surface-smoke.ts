import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { app } from "../server/index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`);
  }
  return response.json();
}

function resolveJsonOutPath(argv: string[]) {
  const inlineFlag = argv.find((arg) => arg.startsWith("--json-out="));
  if (inlineFlag) {
    return inlineFlag.slice("--json-out=".length).trim();
  }

  const flagIndex = argv.findIndex((arg) => arg === "--json-out");
  if (flagIndex >= 0) {
    return argv[flagIndex + 1]?.trim() ?? "";
  }

  return "";
}

async function writeJsonArtifact(pathValue: string, payload: unknown) {
  if (!pathValue) {
    return;
  }

  const absolutePath = resolve(pathValue);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[smoke] json_out=${absolutePath}`);
}

async function main() {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("failed to resolve aegisops review smoke port");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const [healthz, meta, summaryPack, liveSessionPack, resourcePack, schema, replaySummary, runtimeScorecard] =
      await Promise.all([
        fetchJson(baseUrl, "/api/healthz"),
        fetchJson(baseUrl, "/api/meta"),
        fetchJson(baseUrl, "/api/summary-pack"),
        fetchJson(baseUrl, "/api/live-session-pack"),
        fetchJson(baseUrl, "/api/resource-pack"),
        fetchJson(baseUrl, "/api/schema/report"),
        fetchJson(baseUrl, "/api/evals/replays/summary"),
        fetchJson(baseUrl, "/api/runtime/scorecard?focus=quality"),
      ]);

    assert(meta?.links?.summaryPack === "/api/summary-pack", "service meta summary-pack link mismatch");
    assert(summaryPack?.summaryPackId, "summary pack id missing");
    assert(liveSessionPack?.liveSessionPackId, "live session pack id missing");
    assert(resourcePack?.resourcePackId === "aegisops-resource-pack-v1", "resource pack id mismatch");
    assert(schema?.schemaId === "incident-report-v1", "incident report schema id mismatch");
    assert(
      Array.isArray(schema?.requiredFields) && schema.requiredFields.includes("title"),
      "incident report schema required fields are incomplete"
    );
    assert(
      Array.isArray(summaryPack?.twoMinuteReview) && summaryPack.twoMinuteReview.length > 0,
      "summary pack two-minute review is missing"
    );
    assert(replaySummary?.summaryId === "incident-replay-summary-v1", "replay summary id mismatch");
    assert(runtimeScorecard?.summary, "runtime scorecard summary missing");

    const artifact = {
      smoke: "review-surface",
      ok: true,
      baseUrl,
      generatedAt: new Date().toISOString(),
      runtime: {
        deployment: healthz?.deployment ?? null,
        mode: healthz?.mode ?? null,
        provider: healthz?.provider ?? null,
      },
      proof: {
        summaryPackId: summaryPack.summaryPackId,
        liveSessionPackId: liveSessionPack.liveSessionPackId,
        resourcePackId: resourcePack.resourcePackId,
        schemaId: schema.schemaId,
        replaySummaryId: replaySummary.summaryId,
        replayPassRate: replaySummary?.totals?.passRate ?? null,
        severityAccuracy: replaySummary?.totals?.severityAccuracy ?? null,
        requiredFieldCount: Array.isArray(schema.requiredFields)
          ? schema.requiredFields.length
          : 0,
      },
      reviewRoutes: {
        healthz: meta?.links?.healthz ?? null,
        resourcePack: meta?.links?.resourcePack ?? null,
        summaryPack: meta?.links?.summaryPack ?? null,
        liveSessionPack: meta?.links?.liveSessionPack ?? null,
        runtimeScorecard: meta?.links?.runtimeScorecard ?? null,
        reportSchema: meta?.links?.reportSchema ?? null,
      },
      quality: {
        totalRequests: runtimeScorecard?.summary?.totalRequests ?? null,
        persistedEventCount: runtimeScorecard?.summary?.persistedEventCount ?? null,
        spotlightHeadline: runtimeScorecard?.spotlight?.headline ?? null,
      },
    };

    console.log(JSON.stringify(artifact, null, 2));
    await writeJsonArtifact(resolveJsonOutPath(process.argv.slice(2)), artifact);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
