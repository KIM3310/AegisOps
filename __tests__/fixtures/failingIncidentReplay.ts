import { INCIDENT_REPLAY_CASES } from "../../evals/incidentReplays";

INCIDENT_REPLAY_CASES.splice(1, 0, {
  id: "synthetic-severity-mismatch",
  title: "Synthetic severity mismatch for CLI regression",
  description: "Deliberately wrong SEV1 rubric for an ERROR-only synthetic log.",
  logs: "[2026-09-16T00:00:00Z] ERROR: Synthetic checkout request error",
  imageCount: 0,
  expected: { severity: "SEV1" },
});
