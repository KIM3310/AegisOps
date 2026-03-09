import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createSign, generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/index";

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createOidcToken(options: {
  audience: string;
  issuer: string;
  roles?: string[];
}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  const kid = "aegisops-test-key";
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: options.issuer,
      aud: options.audience,
      sub: "operator-123",
      exp: Math.floor(Date.now() / 1000) + 60,
      roles: options.roles ?? [],
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer
    .sign(privateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return {
    jwksJson: JSON.stringify({
      keys: [{ ...publicJwk, alg: "RS256", kid, use: "sig" }],
    }),
    token: `${header}.${payload}.${signature}`,
  };
}

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
    expect(typeof body.summary.liveSessionCount).toBe("number");
    expect(body.persistence.enabled).toBe(true);
    expect(body.liveSessions.enabled).toBe(true);
    expect(body.persistence.methodCounts.POST).toBeGreaterThanOrEqual(1);
    expect(body.persistence.statusClasses.ok).toBeGreaterThanOrEqual(1);
    expect(body.operatorAuth.enabled).toBe(false);
    expect(body.replaySummary.summaryId).toBe("incident-replay-summary-v1");
    expect(body.links.runtimeScorecard).toBe("/api/runtime/scorecard");
    expect(Array.isArray(body.endpoints)).toBe(true);
    expect(Array.isArray(body.recommendations)).toBe(true);
  });

  it("enforces required operator roles for runtime mutation routes when configured", async () => {
    const previousToken = process.env.AEGISOPS_OPERATOR_TOKEN;
    const previousRoles = process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES;
    process.env.AEGISOPS_OPERATOR_TOKEN = "aegis-secret";
    process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES = "incident-commander,reviewer";

    try {
      const denied = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-operator-token": "aegis-secret",
        },
        body: JSON.stringify({ logs: "queue timeout on checkout svc", images: [] }),
      });
      const deniedBody = await denied.json();

      expect(denied.status).toBe(403);
      expect(deniedBody.error.message).toContain("required operator role");

      const allowed = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-operator-token": "aegis-secret",
          "x-operator-role": "incident-commander",
        },
        body: JSON.stringify({ logs: "queue timeout on checkout svc", images: [] }),
      });

      expect(allowed.status).toBe(200);

      const scorecard = await fetch(`${baseUrl}/api/runtime/scorecard`);
      const scorecardBody = await scorecard.json();

      expect(scorecard.status).toBe(200);
      expect(scorecardBody.operatorAuth.requiredRoles).toEqual([
        "incident-commander",
        "reviewer",
      ]);
      expect(scorecardBody.operatorAuth.roleHeaders).toContain("x-operator-role");
    } finally {
      if (typeof previousToken === "string") {
        process.env.AEGISOPS_OPERATOR_TOKEN = previousToken;
      } else {
        delete process.env.AEGISOPS_OPERATOR_TOKEN;
      }
      if (typeof previousRoles === "string") {
        process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES = previousRoles;
      } else {
        delete process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES;
      }
    }
  });

  it("accepts OIDC bearer tokens with required roles for runtime mutation routes", async () => {
    const previousIssuer = process.env.AEGISOPS_OPERATOR_OIDC_ISSUER;
    const previousAudience = process.env.AEGISOPS_OPERATOR_OIDC_AUDIENCE;
    const previousJwks = process.env.AEGISOPS_OPERATOR_OIDC_JWKS_JSON;
    const previousRoles = process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES;
    const previousToken = process.env.AEGISOPS_OPERATOR_TOKEN;
    const issuer = "https://issuer.aegisops.test";
    const audience = "aegisops-api";
    const { jwksJson, token } = createOidcToken({
      issuer,
      audience,
      roles: ["incident-commander"],
    });
    delete process.env.AEGISOPS_OPERATOR_TOKEN;
    process.env.AEGISOPS_OPERATOR_OIDC_ISSUER = issuer;
    process.env.AEGISOPS_OPERATOR_OIDC_AUDIENCE = audience;
    process.env.AEGISOPS_OPERATOR_OIDC_JWKS_JSON = jwksJson;
    process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES = "incident-commander";

    try {
      const allowed = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ logs: "oidc incident auth smoke", images: [] }),
      });

      expect(allowed.status).toBe(200);

      const scorecard = await fetch(`${baseUrl}/api/runtime/scorecard`);
      const scorecardBody = await scorecard.json();

      expect(scorecard.status).toBe(200);
      expect(scorecardBody.operatorAuth.mode).toBe("oidc");
      expect(scorecardBody.operatorAuth.oidc.enabled).toBe(true);
      expect(scorecardBody.operatorAuth.oidc.issuer).toBe(issuer);
    } finally {
      if (typeof previousIssuer === "string") {
        process.env.AEGISOPS_OPERATOR_OIDC_ISSUER = previousIssuer;
      } else {
        delete process.env.AEGISOPS_OPERATOR_OIDC_ISSUER;
      }
      if (typeof previousAudience === "string") {
        process.env.AEGISOPS_OPERATOR_OIDC_AUDIENCE = previousAudience;
      } else {
        delete process.env.AEGISOPS_OPERATOR_OIDC_AUDIENCE;
      }
      if (typeof previousJwks === "string") {
        process.env.AEGISOPS_OPERATOR_OIDC_JWKS_JSON = previousJwks;
      } else {
        delete process.env.AEGISOPS_OPERATOR_OIDC_JWKS_JSON;
      }
      if (typeof previousRoles === "string") {
        process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES = previousRoles;
      } else {
        delete process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES;
      }
      if (typeof previousToken === "string") {
        process.env.AEGISOPS_OPERATOR_TOKEN = previousToken;
      } else {
        delete process.env.AEGISOPS_OPERATOR_TOKEN;
      }
    }
  });
});
