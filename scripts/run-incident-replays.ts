import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildIncidentReplayEvalOverview } from "../server/lib/replayEvals";

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
  console.log(`[replays] json_out=${absolutePath}`);
}

async function main() {
  const overview = buildIncidentReplayEvalOverview();
  const artifact = {
    generatedAt: new Date().toISOString(),
    suiteId: overview.suiteId,
    summary: overview.summary,
    buckets: overview.buckets,
    cases: overview.cases,
  };

  console.log(`[replays] suite=${overview.suiteId} cases=${overview.summary.totalCases}`);
  console.log(
    `[replays] pass_rate=${overview.summary.passRate}% checks=${overview.summary.passedChecks}/${overview.summary.totalChecks} severity_accuracy=${overview.summary.severityAccuracy}%`
  );

  for (const item of overview.cases) {
    const detail =
      item.failedChecks.length > 0
        ? item.failedChecks.map((check) => check.category).join(", ")
        : item.observed.tags.join(", ");
    console.log(`[replays] ${item.status.toUpperCase()} ${item.id} ${item.passRate}% :: ${detail}`);
  }

  if (overview.buckets.length > 0) {
    const dominant = overview.buckets[0];
    console.log(
      `[replays] dominant_gap=${dominant!.category} failures=${dominant!.failures} cases=${dominant!.caseIds.join(",")}`
    );
  } else {
    console.log("[replays] dominant_gap=none");
  }

  await writeJsonArtifact(resolveJsonOutPath(process.argv.slice(2)), artifact);

  if (overview.cases.some((item) => item.status === "fail")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
