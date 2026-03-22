import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openaiAnalyzeIncident, openaiFollowUp } from "../server/lib/openai";

// mockCreate is hoisted so the vi.mock factory can reference it.
const mockCreate = vi.fn();

vi.mock("openai", () => {
  const MockOpenAI = vi.fn(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));
  return { default: MockOpenAI };
});

const SAMPLE_REPORT_JSON = JSON.stringify({
  title: "Database connection pool exhausted",
  summary: "The database connection pool hit its limit causing cascading failures.",
  severity: "SEV1",
  rootCauses: ["Connection pool misconfigured", "Sudden traffic spike"],
  reasoning: "Observations: pool exhausted. Hypotheses: config drift. Decision Path: rollback config.",
  confidenceScore: 82,
  timeline: [
    { time: "14:30:00", description: "Pool saturation warning", severity: "warning" },
    { time: "14:31:00", description: "Connection failures begin", severity: "critical" },
  ],
  actionItems: [
    { task: "Increase connection pool size", owner: "DBA", priority: "HIGH" },
  ],
  mitigationSteps: ["Restart connection pool manager", "Enable connection queuing"],
  impact: { estimatedUsersAffected: "~5000", duration: "12 minutes" },
  tags: ["database", "connection-pool", "latency"],
  lessonsLearned: "Pool limits were not adjusted after traffic doubled.",
  preventionRecommendations: ["Add pool saturation alerting"],
});

function makeChatCompletion(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

const BASE_ANALYZE_INPUT = {
  apiKey: "test-key",
  model: "gpt-4o",
  logs: "[14:30:00] ERROR: DB pool exhausted",
  images: [] as { mimeType: string; data: string }[],
  maxLogChars: 50_000,
  timeoutMs: 30_000,
  retryMaxAttempts: 1,
  retryBaseDelayMs: 0,
};

describe("openaiAnalyzeIncident", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a valid JSON response into an IncidentReport", async () => {
    mockCreate.mockResolvedValue(makeChatCompletion(SAMPLE_REPORT_JSON));

    const report = await openaiAnalyzeIncident(BASE_ANALYZE_INPUT);

    expect(report.severity).toBe("SEV1");
    expect(report.title).toBe("Database connection pool exhausted");
    expect(report.rootCauses).toHaveLength(2);
    expect(report.timeline).toHaveLength(2);
    expect(report.confidenceScore).toBe(82);
    expect(report.tags).toContain("database");
  });

  it("normalises severity to UNKNOWN when the model returns an unrecognised value", async () => {
    const badJson = JSON.stringify({ ...JSON.parse(SAMPLE_REPORT_JSON), severity: "P1" });
    mockCreate.mockResolvedValue(makeChatCompletion(badJson));

    const report = await openaiAnalyzeIncident(BASE_ANALYZE_INPUT);

    expect(report.severity).toBe("UNKNOWN");
  });

  it("clamps confidenceScore to [0, 100]", async () => {
    const overflowJson = JSON.stringify({ ...JSON.parse(SAMPLE_REPORT_JSON), confidenceScore: 999 });
    mockCreate.mockResolvedValue(makeChatCompletion(overflowJson));

    const report = await openaiAnalyzeIncident(BASE_ANALYZE_INPUT);

    expect(report.confidenceScore).toBe(100);
  });

  it("falls back to confidenceScore 50 when the field is missing", async () => {
    const noConfidence = JSON.parse(SAMPLE_REPORT_JSON);
    delete noConfidence.confidenceScore;
    mockCreate.mockResolvedValue(makeChatCompletion(JSON.stringify(noConfidence)));

    const report = await openaiAnalyzeIncident(BASE_ANALYZE_INPUT);

    expect(report.confidenceScore).toBe(50);
  });

  it("throws when the model returns an empty response", async () => {
    mockCreate.mockResolvedValue(makeChatCompletion(""));

    await expect(openaiAnalyzeIncident(BASE_ANALYZE_INPUT)).rejects.toThrow(
      "Empty response from OpenAI model."
    );
  });

  it("propagates API errors without retrying on non-retriable codes", async () => {
    mockCreate.mockRejectedValue(new Error("401 Unauthorized"));

    await expect(
      openaiAnalyzeIncident({ ...BASE_ANALYZE_INPUT, retryMaxAttempts: 3 })
    ).rejects.toThrow("401 Unauthorized");

    // Should only have been called once since 401 is not retriable.
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("retries on rate-limit errors", async () => {
    mockCreate
      .mockRejectedValueOnce(new Error("429 rate limit exceeded"))
      .mockResolvedValue(makeChatCompletion(SAMPLE_REPORT_JSON));

    const report = await openaiAnalyzeIncident({
      ...BASE_ANALYZE_INPUT,
      retryMaxAttempts: 3,
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(report.severity).toBe("SEV1");
  });

  it("includes image data in the request when images are provided", async () => {
    mockCreate.mockResolvedValue(makeChatCompletion(SAMPLE_REPORT_JSON));

    await openaiAnalyzeIncident({
      ...BASE_ANALYZE_INPUT,
      images: [{ mimeType: "image/png", data: "base64encodeddata" }],
    });

    const callArgs = mockCreate.mock.calls[0]![0];
    const userMessage = callArgs.messages.find((m: any) => m.role === "user");
    expect(Array.isArray(userMessage.content)).toBe(true);
    const imagePart = userMessage.content.find((p: any) => p.type === "image_url");
    expect(imagePart).toBeDefined();
    expect(imagePart.image_url.url).toContain("data:image/png;base64,");
  });
});

describe("openaiFollowUp", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseReport = {
    title: "DB pool exhausted",
    summary: "Connection pool hit limit.",
    severity: "SEV1" as const,
    rootCauses: ["Config drift"],
    reasoning: "Observations: pool full.",
    confidenceScore: 80,
    timeline: [],
    actionItems: [],
    mitigationSteps: [],
    impact: {},
    tags: ["database"],
    lessonsLearned: "",
    preventionRecommendations: [],
  };

  const BASE_FOLLOWUP_INPUT = {
    apiKey: "test-key",
    model: "gpt-4o",
    report: baseReport,
    history: [] as { role: "user" | "assistant"; content: string }[],
    question: "How do we prevent this?",
    timeoutMs: 30_000,
    retryMaxAttempts: 1,
    retryBaseDelayMs: 0,
  };

  it("returns the model answer for a follow-up question", async () => {
    mockCreate.mockResolvedValue(
      makeChatCompletion("Increase the pool size and add a saturation alert.")
    );

    const answer = await openaiFollowUp(BASE_FOLLOWUP_INPUT);

    expect(answer).toBe("Increase the pool size and add a saturation alert.");
  });

  it("falls back to default text when the model returns empty content", async () => {
    mockCreate.mockResolvedValue(makeChatCompletion(""));

    const answer = await openaiFollowUp({ ...BASE_FOLLOWUP_INPUT, question: "What happened?" });

    expect(answer).toBe("No answer generated.");
  });

  it("threads conversation history into messages", async () => {
    mockCreate.mockResolvedValue(makeChatCompletion("Follow-up answer."));

    await openaiFollowUp({
      ...BASE_FOLLOWUP_INPUT,
      history: [
        { role: "user", content: "What was the impact?" },
        { role: "assistant", content: "About 5000 users." },
      ],
      question: "How long did it last?",
    });

    const callArgs = mockCreate.mock.calls[0]![0];
    const roles = callArgs.messages.map((m: any) => m.role);
    expect(roles).toContain("system");
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });
});
