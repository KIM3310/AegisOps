import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/index";

describe("service meta endpoints", () => {
  const server = createServer(app);
  let baseUrl = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  it("returns service meta that ties workflow, replay suite, and report contract together", async () => {
    const res = await fetch(`${baseUrl}/api/meta`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.product.name).toBe("AegisOps");
    expect(body.workflow).toEqual(["collect", "reason", "decide", "communicate"]);
    expect(body.replaySuite.totalChecks).toBe(32);
    expect(body.replaySuite.summaryContract).toBe("incident-replay-summary-v1");
    expect(body.reportContract.schemaId).toBe("incident-report-v1");
    expect(body.links.liveSessionPack).toBe("/api/live-session-pack");
    expect(body.links.reviewPack).toBe("/api/review-pack");
    expect(body.links.runtimeScorecard).toBe("/api/runtime/scorecard");
    expect(body.links.replaySummary).toBe("/api/evals/replays/summary");
    expect(body.links.reportSchema).toBe("/api/schema/report");
  });

  it("returns a review pack that compresses flow, trust boundary, and proof links", async () => {
    const res = await fetch(`${baseUrl}/api/review-pack`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.reviewPackId).toBe("aegisops-review-pack-v1");
    expect(body.operatorJourney).toHaveLength(4);
    expect(body.trustBoundary.length).toBeGreaterThan(0);
    expect(body.twoMinuteReview.length).toBe(4);
    expect(body.proofAssets.length).toBeGreaterThanOrEqual(4);
    expect(body.proofBundle.totalChecks).toBe(32);
    expect(body.proofBundle.liveSessionPackId).toBe("aegisops-live-session-pack-v1");
    expect(body.proofBundle.replaySummaryId).toBe("incident-replay-summary-v1");
    expect(body.links.liveSessionPack).toBe("/api/live-session-pack");
    expect(body.links.reviewPack).toBe("/api/review-pack");
  });

  it("returns a live session pack for realtime multimodal incident walkthroughs", async () => {
    const res = await fetch(`${baseUrl}/api/live-session-pack`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.liveSessionPackId).toBe("aegisops-live-session-pack-v1");
    expect(body.sessionRoles).toHaveLength(3);
    expect(body.modalities.some((item: { id: string }) => item.id === "voice-briefing")).toBe(true);
    expect(body.reliabilityPosture.recommendedReviewRoutes).toContain("/api/live-session-pack");
    expect(body.links.liveSessionPack).toBe("/api/live-session-pack");
  });

  it("returns report schema guidance for operator-facing incident reports", async () => {
    const res = await fetch(`${baseUrl}/api/schema/report`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.schemaId).toBe("incident-report-v1");
    expect(body.requiredFields).toContain("title");
    expect(body.requiredFields).toContain("actionItems");
    expect(Array.isArray(body.fieldGuide)).toBe(true);
    expect(body.fieldGuide.some((field: { key: string }) => field.key === "severity")).toBe(true);
  });

  it("returns a runtime scorecard that combines request telemetry, cache posture, and replay quality", async () => {
    await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ logs: "worker timeout on checkout svc", images: [] }),
    });
    await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ logs: "worker timeout on checkout svc", images: [] }),
    });

    const res = await fetch(`${baseUrl}/api/runtime/scorecard?focus=quality`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("aegisops-runtime-scorecard");
    expect(body.focus).toBe("quality");
    expect(body.summary.totalRequests).toBeGreaterThan(0);
    expect(body.analyzeRuntime.cacheMisses).toBeGreaterThan(0);
    expect(typeof body.summary.analyzeCacheHitRatePct).toBe("number");
    expect(typeof body.summary.persistedEventCount).toBe("number");
    expect(body.persistence.enabled).toBe(true);
    expect(body.persistence.methodCounts.POST).toBeGreaterThanOrEqual(1);
    expect(body.persistence.statusClasses.ok).toBeGreaterThanOrEqual(1);
    expect(body.operatorAuth.enabled).toBe(false);
    expect(body.replaySummary.summaryId).toBe("incident-replay-summary-v1");
    expect(body.links.runtimeScorecard).toBe("/api/runtime/scorecard");
    expect(Array.isArray(body.endpoints)).toBe(true);
    expect(Array.isArray(body.recommendations)).toBe(true);
  });
});
