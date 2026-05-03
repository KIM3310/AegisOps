import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../server/index";
import { describeIfSocketBinding } from "./socketBinding";

let server: Server;

beforeAll(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describeIfSocketBinding("GET /api/metrics", () => {
  it("returns Prometheus text format with correct content type", async () => {
    const res = await request(server).get("/api/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
  });

  it("contains metric names after a request has been made", async () => {
    // Make a request first to populate metrics
    await request(server).get("/api/healthz");
    const res = await request(server).get("/api/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("aegisops_http_requests_total");
  });
});

describeIfSocketBinding("GET /api/integrations/status", () => {
  it("returns integration status for all cloud providers", async () => {
    const res = await request(server).get("/api/integrations/status");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty("aws");
    expect(res.body).toHaveProperty("gcp");
    expect(res.body).toHaveProperty("datadog");
    expect(res.body.aws).toHaveProperty("enabled");
    expect(res.body.gcp).toHaveProperty("enabled");
    expect(res.body.datadog).toHaveProperty("enabled");
  });

  it("returns a compact cloud proof board with operator links", async () => {
    const res = await request(server).get("/api/cloud-proof");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.integrations).toHaveProperty("openai");
    expect(res.body.integrations).toHaveProperty("gcp");
    expect(res.body.integrations).toHaveProperty("aws");
    expect(res.body.links.runtimeScorecard).toBe("/api/runtime/scorecard");
  });
});
