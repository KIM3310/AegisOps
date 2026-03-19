import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../server/index";

describe("GET /api/metrics", () => {
  it("returns Prometheus text format with correct content type", async () => {
    const res = await request(app).get("/api/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
  });

  it("contains metric names after a request has been made", async () => {
    // Make a request first to populate metrics
    await request(app).get("/api/healthz");
    const res = await request(app).get("/api/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("aegisops_http_requests_total");
  });
});

describe("GET /api/integrations/status", () => {
  it("returns integration status for all cloud providers", async () => {
    const res = await request(app).get("/api/integrations/status");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty("aws");
    expect(res.body).toHaveProperty("gcp");
    expect(res.body).toHaveProperty("datadog");
    expect(res.body.aws).toHaveProperty("enabled");
    expect(res.body.gcp).toHaveProperty("enabled");
    expect(res.body.datadog).toHaveProperty("enabled");
  });
});
