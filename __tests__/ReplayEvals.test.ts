import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

describe("incident replay CLI", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function runReplayCli(failingFixture = false) {
    const directory = mkdtempSync(join(tmpdir(), "incident-replay-cli-"));
    temporaryDirectories.push(directory);
    const artifactPath = join(directory, "artifacts", "replays.json");
    const args = ["--import", "tsx"];
    if (failingFixture) {
      args.push("--import", "./__tests__/fixtures/failingIncidentReplay.ts");
    }
    args.push("scripts/run-incident-replays.ts", "--json-out", artifactPath);

    const result = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
    });
    return { result, artifactPath };
  }

  it("exits zero and writes the JSON artifact when every rubric passes", () => {
    const { result, artifactPath } = runReplayCli();
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[replays] pass_rate=100% checks=32/32 severity_accuracy=100%");
    expect(result.stdout).toContain("[replays] dominant_gap=none");
    expect(artifact).toMatchObject({
      suiteId: "incident-replay-v1",
      summary: {
        totalCases: 4,
        totalChecks: 32,
        passedChecks: 32,
        casesPassingAll: 4,
        passRate: 100,
        severityAccuracy: 100,
      },
      buckets: [],
    });
    expect(artifact.cases).toHaveLength(4);
  });

  it("exits one on a failing rubric after preserving the full JSON diagnostics", () => {
    const { result, artifactPath } = runReplayCli(true);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

    expect(result.stdout).toContain("[replays] FAIL synthetic-severity-mismatch 0% :: severity_match");
    expect(result.stdout).toContain("[replays] PASS search-warning-buildup 100%");
    expect(artifact.summary).toMatchObject({
      totalCases: 5,
      totalChecks: 33,
      passedChecks: 32,
      casesPassingAll: 4,
    });
    expect(artifact.cases).toHaveLength(5);
    expect(artifact.cases[1]).toMatchObject({
      id: "synthetic-severity-mismatch",
      status: "fail",
      observed: { severity: "SEV2" },
      failedChecks: [{
        id: "severity",
        category: "severity_match",
        passed: false,
        detail: "expected=SEV1 actual=SEV2",
      }],
    });
    expect(artifact.buckets).toEqual([{
      category: "severity_match",
      failures: 1,
      caseIds: ["synthetic-severity-mismatch"],
      labels: ["Severity classification matches the replay rubric."],
    }]);
    expect(result.status).toBe(1);
  });
});
