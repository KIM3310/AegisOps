import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts", "datadog-assets.mjs");
const fetchMockUrl = pathToFileURL(
  path.join(repoRoot, "__tests__", "fixtures", "mockDatadogFetch.mjs")
).href;
const apiCredential = "test-api-credential-do-not-log";
const appCredential = "test-app-credential-do-not-log";

function runDatadogAssets(mode: "plan" | "validate" | "sync", extraEnv = {}) {
  return spawnSync(process.execPath, [scriptPath, mode], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DD_API_KEY: apiCredential,
      DD_APP_KEY: appCredential,
      NODE_OPTIONS: `--import=${fetchMockUrl}`,
      ...extraEnv,
    },
  });
}

function expectNoCredentialDisclosure(output: string) {
  expect(output).not.toContain(apiCredential);
  expect(output).not.toContain(appCredential);
  expect(output).not.toContain("apiKeyConfigured");
  expect(output).not.toContain("appKeyConfigured");
  expect(output).not.toContain("apiKeyValid");
}

describe("Datadog asset CLI credential output", () => {
  it("keeps credential metadata out of plan output", () => {
    const result = runDatadogAssets("plan");
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).not.toHaveProperty("credentials");
    expectNoCredentialDisclosure(output);
  });

  it("prints only a fixed preflight result after validation", () => {
    const result = runDatadogAssets("validate");
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("Datadog credential preflight passed.");
    expectNoCredentialDisclosure(output);
  });

  it("validates the API credential without requiring an application credential", () => {
    const result = runDatadogAssets("validate", { DD_APP_KEY: "" });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("Datadog credential preflight passed.");
    expectNoCredentialDisclosure(output);
  });

  it("keeps credentials out of sync output", () => {
    const result = runDatadogAssets("sync");
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Datadog credential preflight passed.");
    expect(result.stdout).toContain("dashboard-test-id");
    expectNoCredentialDisclosure(output);
  });

  it("does not echo an upstream error body that contains credentials", () => {
    const result = runDatadogAssets("validate", { DD_DATADOG_TEST_REJECT: "1" });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GET /api/v1/validate failed (403)");
    expect(result.stderr).toContain("safe-test-request");
    expectNoCredentialDisclosure(output);
  });
});
