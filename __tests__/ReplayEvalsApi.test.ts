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
});
