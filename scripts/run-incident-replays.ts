import { buildIncidentReplayEvalOverview } from "../server/lib/replayEvals";

const overview = buildIncidentReplayEvalOverview();

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
    `[replays] dominant_gap=${dominant.category} failures=${dominant.failures} cases=${dominant.caseIds.join(",")}`
  );
} else {
  console.log("[replays] dominant_gap=none");
}
