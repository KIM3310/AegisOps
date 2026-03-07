import { INCIDENT_REPLAY_CASES } from "../../evals/incidentReplays";
import type {
  IncidentReplayCase,
  ReplayEvalBucket,
  ReplayEvalCaseResult,
  ReplayEvalCheck,
  ReplayEvalOverview,
} from "../../types";
import { demoAnalyzeIncident } from "./demo";

function toPercent(passed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((passed / total) * 1000) / 10;
}

function normalizeText(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function collectText(parts: Array<string | undefined>): string {
  return parts.map((part) => normalizeText(part)).filter(Boolean).join(" | ");
}

function includesAllTerms(haystack: string, terms: string[] = []): boolean {
  const target = normalizeText(haystack);
  return terms.every((term) => target.includes(normalizeText(term)));
}

function buildCheck(input: Omit<ReplayEvalCheck, "passed"> & { passed: boolean }): ReplayEvalCheck {
  return {
    id: input.id,
    category: input.category,
    label: input.label,
    passed: input.passed,
    detail: input.detail,
  };
}

export function evaluateIncidentReplayCase(input: IncidentReplayCase, maxLogChars = 50_000): ReplayEvalCaseResult {
  const report = demoAnalyzeIncident({
    logs: input.logs,
    imageCount: input.imageCount,
    maxLogChars,
  });

  const checks: ReplayEvalCheck[] = [];
  const titleText = normalizeText(report.title);
  const tags = (report.tags || []).map((tag) => normalizeText(tag));
  const rootCauseText = collectText(report.rootCauses || []);
  const actionText = collectText((report.actionItems || []).map((item) => `${item.task} ${item.owner || ""} ${item.priority}`));
  const reasoningText = normalizeText(report.reasoning || "");
  const confidenceScore = Number(report.confidenceScore || 0);
  const expected = input.expected;

  checks.push(
    buildCheck({
      id: "severity",
      category: "severity_match",
      label: "Severity classification matches the replay rubric.",
      passed: report.severity === expected.severity,
      detail: `expected=${expected.severity} actual=${report.severity}`,
    })
  );

  if (expected.titleIncludes?.length) {
    checks.push(
      buildCheck({
        id: "title",
        category: "title_keywords",
        label: "Title keeps the dominant failure mode visible.",
        passed: includesAllTerms(titleText, expected.titleIncludes),
        detail: `expected keywords=${expected.titleIncludes.join(", ")} actual=${report.title}`,
      })
    );
  }

  if (expected.tagsInclude?.length) {
    const missingTags = expected.tagsInclude.filter((tag) => !tags.includes(normalizeText(tag)));
    checks.push(
      buildCheck({
        id: "tags",
        category: "tag_coverage",
        label: "Operational tags capture the main systems involved.",
        passed: missingTags.length === 0,
        detail:
          missingTags.length === 0
            ? `observed=${report.tags.join(", ")}`
            : `missing tags=${missingTags.join(", ")} observed=${report.tags.join(", ")}`,
      })
    );
  }

  if (typeof expected.minTimelineEvents === "number") {
    checks.push(
      buildCheck({
        id: "timeline",
        category: "timeline_coverage",
        label: "Timeline retains enough events for incident reconstruction.",
        passed: (report.timeline || []).length >= expected.minTimelineEvents,
        detail: `expected>=${expected.minTimelineEvents} actual=${(report.timeline || []).length}`,
      })
    );
  }

  if (expected.rootCauseIncludes?.length) {
    checks.push(
      buildCheck({
        id: "root-causes",
        category: "root_cause_coverage",
        label: "Root causes mention the failure mode, not just symptoms.",
        passed: includesAllTerms(rootCauseText, expected.rootCauseIncludes),
        detail: `expected keywords=${expected.rootCauseIncludes.join(", ")} actual=${(report.rootCauses || []).join(" | ")}`,
      })
    );
  }

  if (expected.actionItemsInclude?.length) {
    checks.push(
      buildCheck({
        id: "actions",
        category: "actionability",
        label: "Action items stay concrete and operator-facing.",
        passed: includesAllTerms(actionText, expected.actionItemsInclude),
        detail: `expected keywords=${expected.actionItemsInclude.join(", ")} actual=${(report.actionItems || [])
          .map((item) => item.task)
          .join(" | ")}`,
      })
    );
  }

  if (expected.reasoningSections?.length) {
    checks.push(
      buildCheck({
        id: "reasoning",
        category: "reasoning_trace",
        label: "Reasoning trace preserves observations, hypotheses, and decision path.",
        passed: includesAllTerms(reasoningText, expected.reasoningSections),
        detail: `expected sections=${expected.reasoningSections.join(", ")}`,
      })
    );
  }

  if (expected.confidenceRange) {
    const { min, max } = expected.confidenceRange;
    checks.push(
      buildCheck({
        id: "confidence",
        category: "confidence_range",
        label: "Confidence score stays within the rubric band.",
        passed: confidenceScore >= min && confidenceScore <= max,
        detail: `expected=${min}-${max} actual=${confidenceScore}`,
      })
    );
  }

  const failedChecks = checks.filter((check) => !check.passed);

  return {
    id: input.id,
    title: input.title,
    status: failedChecks.length === 0 ? "pass" : "fail",
    passRate: toPercent(checks.length - failedChecks.length, checks.length),
    observed: {
      title: report.title,
      severity: report.severity,
      tags: report.tags || [],
      confidenceScore,
      timelineEvents: (report.timeline || []).length,
      actionItems: (report.actionItems || []).length,
    },
    failedChecks,
  };
}

function buildBuckets(cases: ReplayEvalCaseResult[]): ReplayEvalBucket[] {
  const map = new Map<ReplayEvalBucket["category"], ReplayEvalBucket>();

  for (const item of cases) {
    for (const check of item.failedChecks) {
      const existing = map.get(check.category);
      if (existing) {
        existing.failures += 1;
        if (!existing.caseIds.includes(item.id)) existing.caseIds.push(item.id);
        if (!existing.labels.includes(check.label)) existing.labels.push(check.label);
        continue;
      }

      map.set(check.category, {
        category: check.category,
        failures: 1,
        caseIds: [item.id],
        labels: [check.label],
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.failures - a.failures || a.category.localeCompare(b.category));
}

function countExpectedChecks(input: IncidentReplayCase): number {
  let checks = 1;
  if (input.expected.titleIncludes?.length) checks += 1;
  if (input.expected.tagsInclude?.length) checks += 1;
  if (typeof input.expected.minTimelineEvents === "number") checks += 1;
  if (input.expected.rootCauseIncludes?.length) checks += 1;
  if (input.expected.actionItemsInclude?.length) checks += 1;
  if (input.expected.reasoningSections?.length) checks += 1;
  if (input.expected.confidenceRange) checks += 1;
  return checks;
}

export function buildIncidentReplayEvalOverview(maxLogChars = 50_000): ReplayEvalOverview {
  const cases = INCIDENT_REPLAY_CASES.map((item) => evaluateIncidentReplayCase(item, maxLogChars));
  const totalExpectedChecks = INCIDENT_REPLAY_CASES.reduce((sum, item) => sum + countExpectedChecks(item), 0);
  const failedChecks = cases.reduce((sum, item) => sum + item.failedChecks.length, 0);
  const passedChecks = totalExpectedChecks - failedChecks;
  const severityMatches = cases.filter((item, index) => item.observed.severity === INCIDENT_REPLAY_CASES[index].expected.severity).length;

  return {
    ok: true,
    suiteId: "incident-replay-v1",
    generatedAt: new Date().toISOString(),
    summary: {
      totalCases: cases.length,
      totalChecks: totalExpectedChecks,
      passedChecks,
      passRate: toPercent(passedChecks, totalExpectedChecks),
      casesPassingAll: cases.filter((item) => item.status === "pass").length,
      severityAccuracy: toPercent(severityMatches, cases.length),
    },
    buckets: buildBuckets(cases),
    cases,
  };
}
