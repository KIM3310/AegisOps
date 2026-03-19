import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isGcpEnabled,
  getGcpStatus,
  resetGcpConfig,
} from "../server/lib/gcp-adapter";

describe("GCP Adapter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetGcpConfig();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetGcpConfig();
  });

  describe("isGcpEnabled", () => {
    it("returns false when GOOGLE_APPLICATION_CREDENTIALS is not set", () => {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      expect(isGcpEnabled()).toBe(false);
    });

    it("returns false when credentials file does not exist", () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = "/nonexistent/path/key.json";
      expect(isGcpEnabled()).toBe(false);
    });
  });

  describe("getGcpStatus", () => {
    it("returns disabled status when not configured", () => {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const status = getGcpStatus();
      expect(status.enabled).toBe(false);
      expect(status.projectId).toBeNull();
      expect(status.storageBucket).toBeNull();
      expect(status.bigqueryDataset).toBeNull();
    });
  });
});
