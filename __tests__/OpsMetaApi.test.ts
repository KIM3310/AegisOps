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
    expect(body.links.postmortemPack).toBe("/api/postmortem-pack");
    expect(body.links.escalationReadiness).toBe("/api/escalation-readiness");
    expect(body.links.reviewPack).toBe("/api/review-pack");
    expect(body.links.reviewerBundle).toBe("/api/reviewer-bundle");
    expect(body.links.reviewerBundleVerify).toBe("/api/reviewer-bundle/verify");
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
    expect(body.proofBundle.postmortemPackId).toBe("aegisops-postmortem-pack-v1");
    expect(body.proofBundle.replaySummaryId).toBe("incident-replay-summary-v1");
    expect(body.links.liveSessionPack).toBe("/api/live-session-pack");
    expect(body.links.postmortemPack).toBe("/api/postmortem-pack");
    expect(body.links.reviewPack).toBe("/api/review-pack");
  });

  it("returns a digest-backed reviewer bundle and verification surface", async () => {
    const bundleRes = await fetch(`${baseUrl}/api/reviewer-bundle`);
    const bundleBody = await bundleRes.json();

    expect(bundleRes.status).toBe(200);
    expect(bundleBody.ok).toBe(true);
    expect(bundleBody.service).toBe("aegisops-reviewer-bundle");
    expect(bundleBody.reviewerBundleId).toBe("aegisops-reviewer-bundle-v1");
    expect(bundleBody.integrity.algorithm).toBe("SHA-256");
    expect(bundleBody.integrity.digest).toHaveLength(64);
    expect(bundleBody.links.reviewerBundleVerify).toBe("/api/reviewer-bundle/verify");

    const verifyRes = await fetch(
      `${baseUrl}/api/reviewer-bundle/verify?digest=${bundleBody.integrity.digest}`
    );
    const verifyBody = await verifyRes.json();

    expect(verifyRes.status).toBe(200);
    expect(verifyBody.service).toBe("aegisops-reviewer-bundle-verify");
    expect(verifyBody.match).toBe(true);
    expect(verifyBody.computedDigest).toBe(bundleBody.integrity.digest);
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
    expect(body.reliabilityPosture.recommendedReviewRoutes).toContain("/api/postmortem-pack");
    expect(body.links.liveSessionPack).toBe("/api/live-session-pack");
  });

  it("returns a postmortem pack that ties live evidence to runtime telemetry", async () => {
    await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        logs: "checkout worker timeout on billing shard",
        images: [],
        lane: "incident-command",
        sessionId: "sev1-bridge",
      }),
    });

    const res = await fetch(`${baseUrl}/api/postmortem-pack`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("aegisops-postmortem-pack");
    expect(body.postmortemPackId).toBe("aegisops-postmortem-pack-v1");
    expect(body.summary.liveSessionCount).toBeGreaterThanOrEqual(1);
    expect(body.summary.evidenceTimelineCount).toBeGreaterThanOrEqual(1);
    expect(body.postmortemFlow).toHaveLength(4);
    expect(body.evidenceTimeline.some((item: { source: string }) => item.source === "live-session")).toBe(true);
    expect(body.evidenceTimeline.some((item: { source: string }) => item.source === "runtime-event")).toBe(true);
    expect(body.proofBundle.replaySummaryId).toBe("incident-replay-summary-v1");
    expect(body.links.postmortemPack).toBe("/api/postmortem-pack");
    expect(body.links.escalationReadiness).toBe("/api/escalation-readiness");
    expect(body.links.runtimeScorecard).toBe("/api/runtime/scorecard");
  });

  it("returns escalation readiness for commander handoff review", async () => {
    await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        logs: "api latency spike on checkout path",
        images: [],
        lane: "incident-command",
        sessionId: "sev1-commander",
      }),
    });

    const res = await fetch(`${baseUrl}/api/escalation-readiness`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("aegisops-escalation-readiness");
    expect(body.escalationReadinessId).toBe("aegisops-escalation-readiness-v1");
    expect(["attention", "ready"]).toContain(body.summary.escalationStatus);
    expect(["high", "moderate", "bounded"]).toContain(body.summary.confidenceBand);
    expect(body.confidenceBands).toHaveLength(3);
    expect(body.handoffContract.requiredEvidence).toContain("/api/postmortem-pack");
    expect(body.links.escalationReadiness).toBe("/api/escalation-readiness");
    expect(body.links.providerComparison).toBe("/api/evals/providers");
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

  it("returns a provider comparison surface for reviewer tradeoff decisions", async () => {
    const res = await fetch(`${baseUrl}/api/evals/providers`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("aegisops-provider-comparison");
    expect(body.compareAgainst).toBe("static-demo");
    expect(body.summary.currentProvider).toBeTruthy();
    expect(body.providers).toHaveLength(4);
    expect(body.providers.some((item: { id: string }) => item.id === "gemini")).toBe(true);
    expect(body.providers.some((item: { id: string }) => item.id === "ollama")).toBe(true);
    expect(body.links.providerComparison).toBe("/api/evals/providers");
    expect(body.links.runtimeScorecard).toBe("/api/runtime/scorecard");
    expect(body.links.postmortemPack).toBe("/api/postmortem-pack");
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

  it("boots an operator session cookie and reuses it for protected runtime routes", async () => {
    const previousToken = process.env.AEGISOPS_OPERATOR_TOKEN;
    const previousRoles = process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES;
    process.env.AEGISOPS_OPERATOR_TOKEN = "session-secret";
    process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES = "incident-commander";

    try {
      const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          authMode: "token",
          credential: "session-secret",
          roles: ["incident-commander"],
        }),
      });
      const setCookie = sessionResponse.headers.get("set-cookie");
      const sessionBody = await sessionResponse.json();

      expect(sessionResponse.status).toBe(200);
      expect(setCookie).toContain("aegisops_operator_session=");
      expect(sessionBody.active).toBe(true);
      expect(sessionBody.session.roles).toContain("incident-commander");

      const analyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: String(setCookie || "").split(";")[0] || "",
        },
        body: JSON.stringify({ logs: "session-backed incident run", images: [] }),
      });
      expect(analyzeResponse.status).toBe(200);

      const currentSession = await fetch(`${baseUrl}/api/auth/session`, {
        headers: {
          cookie: String(setCookie || "").split(";")[0] || "",
        },
      });
      const currentSessionBody = await currentSession.json();
      expect(currentSession.status).toBe(200);
      expect(currentSessionBody.active).toBe(true);
      expect(currentSessionBody.validation.ok).toBe(true);

      const clearResponse = await fetch(`${baseUrl}/api/auth/session`, {
        method: "DELETE",
      });
      expect(clearResponse.status).toBe(200);
      expect(clearResponse.headers.get("set-cookie")).toContain("Max-Age=0");
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
