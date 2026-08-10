import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { describeIfSocketBinding } from "./socketBinding";

// Exercise rate limiting through the Express app so route middleware and
// response behavior are covered together.
describeIfSocketBinding("API rate limiting", () => {
  let app: any;
  let server: Server;
  let previousLogLevel: string | undefined;

  beforeEach(async () => {
    // Fresh import each test to reset rate buckets and limiter stores.
    previousLogLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "silent";
    vi.resetModules();
    const mod = await import("../server/index");
    app = mod.app;
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previousLogLevel;
    }
  });

  it("returns 200 for requests under the rate limit", async () => {
    const res = await request(server)
      .post("/api/analyze")
      .send({ logs: "ERROR: something went wrong" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body.title).toBeDefined();
  });

  it("returns valid incident report shape from demo mode", async () => {
    const res = await request(server)
      .post("/api/analyze")
      .send({ logs: "[14:32:00] ERROR: redis OOM kill detected\n[14:32:05] WARN: cache miss storm" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body.severity).toMatch(/^SEV[123]|UNKNOWN$/);
    expect(res.body.rootCauses).toBeInstanceOf(Array);
    expect(res.body.timeline).toBeInstanceOf(Array);
    expect(res.body.actionItems).toBeInstanceOf(Array);
    expect(res.body.tags).toBeInstanceOf(Array);
  });

  it("blocks repeated operator session authentication attempts", async () => {
    const attempts = [];
    for (let index = 0; index < 11; index += 1) {
      attempts.push(
        await request(server)
          .post("/api/auth/session")
          .send({ authMode: "token", credential: "invalid-credential" })
          .set("Content-Type", "application/json")
      );
    }

    expect(attempts.slice(0, 10).every((response) => response.status !== 429)).toBe(true);
    expect(attempts[10]!.status).toBe(429);
    expect(attempts[10]!.body.error.message).toContain("Too many operator session attempts");
    expect(attempts[10]!.headers.ratelimit).toBeDefined();
  });

  it("rate-limits excessive health check traffic", async () => {
    const responses = await Promise.all(
      Array.from({ length: 121 }, () => request(server).get("/api/healthz"))
    );
    const successful = responses.filter((response) => response.status === 200);
    const blocked = responses.filter((response) => response.status === 429);

    expect(successful).toHaveLength(120);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.body.error.message).toContain("Too many health check requests");
    expect(blocked[0]!.headers.ratelimit).toBeDefined();
  });
});
