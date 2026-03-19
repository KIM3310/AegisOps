import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isDatadogEnabled,
  getDatadogStatus,
  bufferMetric,
  buildTracingHeaders,
  recordIncidentAnalysis,
  recordFollowUp,
  recordHttpRequest,
  recordProviderUsage,
  resetDatadogConfig,
} from "../server/lib/datadog-adapter";

describe("Datadog Adapter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetDatadogConfig();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetDatadogConfig();
  });

  describe("isDatadogEnabled", () => {
    it("returns false when DD_API_KEY is not set", () => {
      delete process.env.DD_API_KEY;
      expect(isDatadogEnabled()).toBe(false);
    });

    it("returns true when DD_API_KEY is set", () => {
      process.env.DD_API_KEY = "test-api-key-abc123";
      expect(isDatadogEnabled()).toBe(true);
    });
  });

  describe("getDatadogStatus", () => {
    it("returns disabled status when not configured", () => {
      delete process.env.DD_API_KEY;
      const status = getDatadogStatus();
      expect(status.enabled).toBe(false);
      expect(status.site).toBeNull();
      expect(status.service).toBeNull();
    });

    it("returns full status when configured", () => {
      process.env.DD_API_KEY = "test-api-key";
      process.env.DD_APP_KEY = "test-app-key";
      process.env.DD_SITE = "datadoghq.eu";
      process.env.DD_SERVICE = "my-service";
      process.env.DD_ENV = "staging";
      const status = getDatadogStatus();
      expect(status.enabled).toBe(true);
      expect(status.site).toBe("datadoghq.eu");
      expect(status.service).toBe("my-service");
      expect(status.env).toBe("staging");
      expect(status.appKeyConfigured).toBe(true);
    });

    it("uses default site, service, env", () => {
      process.env.DD_API_KEY = "test-api-key";
      delete process.env.DD_SITE;
      delete process.env.DD_SERVICE;
      delete process.env.DD_ENV;
      const status = getDatadogStatus();
      expect(status.site).toBe("datadoghq.com");
      expect(status.service).toBe("aegisops");
      expect(status.env).toBe("production");
    });
  });

  describe("bufferMetric", () => {
    it("is a no-op when DD_API_KEY is not set", () => {
      delete process.env.DD_API_KEY;
      bufferMetric("test.metric", 42);
      const status = getDatadogStatus();
      expect(status.bufferedMetrics).toBe(0);
    });

    it("buffers metrics when configured", () => {
      process.env.DD_API_KEY = "test-api-key";
      bufferMetric("test.metric", 42, "gauge", ["tag:value"]);
      const status = getDatadogStatus();
      expect(status.bufferedMetrics).toBe(1);
    });
  });

  describe("buildTracingHeaders", () => {
    it("returns null when DD_API_KEY is not set", () => {
      delete process.env.DD_API_KEY;
      expect(buildTracingHeaders("req-123")).toBeNull();
    });

    it("returns tracing headers when configured", () => {
      process.env.DD_API_KEY = "test-api-key";
      const headers = buildTracingHeaders("req-123");
      expect(headers).not.toBeNull();
      expect(headers!["x-datadog-trace-id"]).toBeTruthy();
      expect(headers!["x-datadog-parent-id"]).toBeTruthy();
      expect(headers!["x-datadog-sampling-priority"]).toBe("1");
      expect(headers!["x-datadog-origin"]).toBe("aegisops");
    });
  });

  describe("domain metric helpers", () => {
    beforeEach(() => {
      process.env.DD_API_KEY = "test-api-key";
    });

    it("recordIncidentAnalysis buffers metrics", () => {
      recordIncidentAnalysis({ provider: "gemini", severity: "SEV1", latencyMs: 1200, cached: false });
      const status = getDatadogStatus();
      expect(status.bufferedMetrics).toBeGreaterThanOrEqual(2);
    });

    it("recordFollowUp buffers metrics", () => {
      recordFollowUp({ provider: "gemini", latencyMs: 800 });
      const status = getDatadogStatus();
      expect(status.bufferedMetrics).toBeGreaterThanOrEqual(2);
    });

    it("recordHttpRequest buffers metrics", () => {
      recordHttpRequest({ method: "POST", route: "analyze", statusCode: 200, latencyMs: 500 });
      const status = getDatadogStatus();
      expect(status.bufferedMetrics).toBeGreaterThanOrEqual(2);
    });

    it("recordProviderUsage buffers a metric", () => {
      recordProviderUsage("ollama");
      const status = getDatadogStatus();
      expect(status.bufferedMetrics).toBeGreaterThanOrEqual(1);
    });
  });
});
