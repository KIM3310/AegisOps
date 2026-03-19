import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isAwsEnabled,
  getAwsStatus,
  resetAwsConfig,
} from "../server/lib/aws-adapter";

describe("AWS Adapter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetAwsConfig();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetAwsConfig();
  });

  describe("isAwsEnabled", () => {
    it("returns false when AWS_ACCESS_KEY_ID is not set", () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      expect(isAwsEnabled()).toBe(false);
    });

    it("returns false when AWS_ACCESS_KEY_ID is set but secret is missing", () => {
      process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
      delete process.env.AWS_SECRET_ACCESS_KEY;
      expect(isAwsEnabled()).toBe(false);
    });

    it("returns true when both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set", () => {
      process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
      process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
      expect(isAwsEnabled()).toBe(true);
    });
  });

  describe("getAwsStatus", () => {
    it("returns disabled status when not configured", () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      const status = getAwsStatus();
      expect(status.enabled).toBe(false);
      expect(status.region).toBeNull();
      expect(status.s3Bucket).toBeNull();
    });

    it("returns enabled status with config details when configured", () => {
      process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
      process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
      process.env.AWS_REGION = "eu-west-1";
      process.env.AWS_S3_BUCKET = "my-bucket";
      const status = getAwsStatus();
      expect(status.enabled).toBe(true);
      expect(status.region).toBe("eu-west-1");
      expect(status.s3Bucket).toBe("my-bucket");
      expect(status.sqsConfigured).toBe(false);
    });

    it("detects SQS configuration", () => {
      process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
      process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
      process.env.AWS_SQS_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789/aegisops";
      const status = getAwsStatus();
      expect(status.sqsConfigured).toBe(true);
    });

    it("detects CloudWatch configuration", () => {
      process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
      process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
      process.env.AWS_CLOUDWATCH_LOG_GROUP = "my-log-group";
      const status = getAwsStatus();
      expect(status.cloudwatchConfigured).toBe(true);
    });

    it("uses default region and bucket when not specified", () => {
      process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
      process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
      delete process.env.AWS_REGION;
      delete process.env.AWS_S3_BUCKET;
      const status = getAwsStatus();
      expect(status.region).toBe("us-east-1");
      expect(status.s3Bucket).toBe("aegisops-reports");
    });
  });
});
