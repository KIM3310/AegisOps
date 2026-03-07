import { describe, expect, it } from "vitest";
import { buildIncidentReplayEvalOverview } from "../server/lib/replayEvals";

describe("incident replay eval overview", () => {
  it("scores the incident replay suite", () => {
    const overview = buildIncidentReplayEvalOverview();

    expect(overview.ok).toBe(true);
    expect(overview.suiteId).toBe("incident-replay-v1");
    expect(overview.summary.totalCases).toBe(4);
    expect(overview.summary.totalChecks).toBe(32);
    expect(overview.summary.passedChecks).toBe(32);
    expect(overview.summary.passRate).toBe(100);
    expect(overview.summary.severityAccuracy).toBe(100);
    expect(overview.buckets).toHaveLength(0);
    expect(overview.cases).toHaveLength(4);
    expect(overview.cases.every((item) => item.observed.timelineEvents >= 4)).toBe(true);
  });
});
