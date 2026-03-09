import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/index";

describe("GET /api/evals/replays", () => {
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

  it("returns replay eval telemetry for the incident suite", async () => {
    const res = await fetch(`${baseUrl}/api/evals/replays`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.suiteId).toBe("incident-replay-v1");
    expect(body.summary.totalCases).toBe(4);
    expect(Array.isArray(body.cases)).toBe(true);
  });

  it("returns a filtered replay summary surface for reviewer triage", async () => {
    const res = await fetch(`${baseUrl}/api/evals/replays/summary?status=fail&limit=2`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.summaryId).toBe("incident-replay-summary-v1");
    expect(body.filters.status).toBe("fail");
    expect(body.filters.limit).toBe(2);
    expect(Array.isArray(body.topFailureBuckets)).toBe(true);
    expect(body.spotlightCases.length).toBeLessThanOrEqual(2);
    expect(body.spotlightCases.every((item: { status: string }) => item.status === "fail")).toBe(true);
  });

  it("rejects invalid replay summary filters", async () => {
    const res = await fetch(`${baseUrl}/api/evals/replays/summary?status=unknown`);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toContain("status must be either");
  });
});
