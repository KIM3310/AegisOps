import { describe, it, expect, beforeEach } from "vitest";
import {
  incCounter,
  observeHistogram,
  recordHttpRequest,
  recordAnalysis,
  recordProviderUsage,
  recordFollowUp,
  recordTts,
  serializeMetrics,
  resetMetrics,
} from "../server/lib/prometheus";

describe("Prometheus Metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("incCounter", () => {
    it("creates and increments a counter", () => {
      incCounter("test_counter", { route: "/api/test" });
      incCounter("test_counter", { route: "/api/test" });
      const output = serializeMetrics();
      expect(output).toContain('test_counter{route="/api/test"} 2');
    });

    it("separates counters by label set", () => {
      incCounter("test_counter", { route: "/api/a" });
      incCounter("test_counter", { route: "/api/b" }, 5);
      const output = serializeMetrics();
      expect(output).toContain('test_counter{route="/api/a"} 1');
      expect(output).toContain('test_counter{route="/api/b"} 5');
    });
  });

  describe("observeHistogram", () => {
    it("distributes values into buckets", () => {
      observeHistogram("test_hist", {}, 0.005);
      observeHistogram("test_hist", {}, 0.5);
      observeHistogram("test_hist", {}, 3.0);
      const output = serializeMetrics();
      expect(output).toContain("test_hist_count 3");
      expect(output).toContain("test_hist_sum 3.505");
      // 0.005 fits in le="0.01" bucket
      expect(output).toContain('test_hist_bucket{le="0.01"} 1');
      // All 3 fit in le="+Inf"
      expect(output).toContain('test_hist_bucket{le="+Inf"} 3');
    });
  });

  describe("recordHttpRequest", () => {
    it("records counter and histogram", () => {
      recordHttpRequest({ method: "GET", route: "health", statusCode: 200, durationSec: 0.05 });
      recordHttpRequest({ method: "POST", route: "analyze", statusCode: 500, durationSec: 2.1 });
      const output = serializeMetrics();
      expect(output).toContain("aegisops_http_requests_total");
      expect(output).toContain("aegisops_http_request_duration_seconds");
      expect(output).toContain("aegisops_http_server_errors_total");
    });
  });

  describe("recordAnalysis", () => {
    it("records analysis counter and duration histogram", () => {
      recordAnalysis({ provider: "gemini", success: true, durationSec: 1.5, cached: false });
      recordAnalysis({ provider: "demo", success: true, durationSec: 0.01, cached: true });
      const output = serializeMetrics();
      expect(output).toContain("aegisops_analysis_total");
      expect(output).toContain("aegisops_analysis_duration_seconds");
      expect(output).toContain('provider="gemini"');
      expect(output).toContain('cached="false"');
    });
  });

  describe("recordProviderUsage", () => {
    it("increments provider counter", () => {
      recordProviderUsage("gemini");
      recordProviderUsage("gemini");
      recordProviderUsage("ollama");
      const output = serializeMetrics();
      expect(output).toContain('aegisops_provider_requests_total{provider="gemini"} 2');
      expect(output).toContain('aegisops_provider_requests_total{provider="ollama"} 1');
    });
  });

  describe("recordFollowUp", () => {
    it("records follow-up metrics", () => {
      recordFollowUp({ provider: "gemini", success: true, durationSec: 0.8 });
      const output = serializeMetrics();
      expect(output).toContain("aegisops_followup_total");
      expect(output).toContain("aegisops_followup_duration_seconds");
    });
  });

  describe("recordTts", () => {
    it("records TTS metrics", () => {
      recordTts({ provider: "gemini", success: true });
      recordTts({ provider: "demo", success: false });
      const output = serializeMetrics();
      expect(output).toContain("aegisops_tts_total");
      expect(output).toContain('status="success"');
      expect(output).toContain('status="failure"');
    });
  });

  describe("serializeMetrics", () => {
    it("returns valid Prometheus text format with HELP and TYPE", () => {
      recordHttpRequest({ method: "GET", route: "health", statusCode: 200, durationSec: 0.01 });
      const output = serializeMetrics();
      expect(output).toContain("# HELP aegisops_http_requests_total Total HTTP requests");
      expect(output).toContain("# TYPE aegisops_http_requests_total counter");
      expect(output).toContain("# TYPE aegisops_http_request_duration_seconds histogram");
    });

    it("returns minimal output when no metrics collected", () => {
      const output = serializeMetrics();
      expect(output.trim()).toBe("");
    });
  });
});
