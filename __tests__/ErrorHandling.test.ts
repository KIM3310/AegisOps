import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { describeIfSocketBinding } from "./socketBinding";

describeIfSocketBinding("error handling and edge cases", () => {
  let app: any;
  let server: Server;

  beforeEach(async () => {
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
  });

  it("returns 404 for unknown API routes", async () => {
    const res = await request(server).get("/api/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain("Not found");
  });

  it("returns 400 for followup without question", async () => {
    const res = await request(server)
      .post("/api/followup")
      .send({ report: { title: "test" } })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("Missing question");
  });

  it("returns 400 for TTS without text", async () => {
    const res = await request(server)
      .post("/api/tts")
      .send({})
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("Missing text");
  });

  it("returns 400 for invalid runtime scorecard focus", async () => {
    const res = await request(server).get("/api/runtime/scorecard?focus=invalid");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("focus");
  });

  it("includes x-request-id header in all responses", async () => {
    const res = await request(server).get("/api/healthz");
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(res.headers["x-request-id"]).toMatch(/^req-/);
  });

  it("includes security headers in responses", async () => {
    const res = await request(server).get("/api/healthz");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("healthz endpoint returns correct structure", async () => {
    const res = await request(server).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe("aegisops-api");
    expect(res.body.provider).toBeDefined();
    expect(res.body.mode).toMatch(/^demo|live$/);
    expect(res.body.limits).toBeDefined();
    expect(res.body.models).toBeDefined();
    expect(res.body.architectureFastPath).toEqual(
      expect.arrayContaining([
        "/api/healthz",
        "/api/runtime/scorecard",
        "/api/resource-pack",
        "/api/summary-pack",
        "/api/schema/report",
      ])
    );
  });
});
