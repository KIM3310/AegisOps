import { z } from 'zod';

const text = z.string().max(6000);
const shortText = z.string().max(500);
export const CaseIdSchema = z.uuid();
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime();
const safeObjectKeys = z.unknown().superRefine((value, context) => {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        context.addIssue({ code: 'custom', message: '허용되지 않은 객체 키입니다.' });
      }
      pending.push(child);
    }
  }
});

export const SubmittedReportSchema = z.strictObject({
  title: shortText.min(1),
  summary: text.min(1),
  severity: z.enum(['SEV1', 'SEV2', 'SEV3', 'UNKNOWN']),
  rootCauses: z.array(text).max(30),
  timeline: z.array(z.strictObject({
    time: shortText,
    description: text,
    severity: z.enum(['critical', 'warning', 'info', 'success']).optional(),
  })).max(100),
  actionItems: z.array(z.strictObject({
    task: text,
    owner: shortText.optional(),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  })).max(100),
  mitigationSteps: z.array(text).max(50),
  impact: z.strictObject({
    estimatedUsersAffected: shortText.optional(),
    duration: shortText.optional(),
    peakLatency: shortText.optional(),
    peakErrorRate: shortText.optional(),
  }).optional(),
  tags: z.array(shortText).max(50),
  lessonsLearned: text.optional(),
  preventionRecommendations: z.array(text).max(50).optional(),
  references: z.array(z.strictObject({ title: shortText, uri: z.string().max(2000) })).max(30).optional(),
  reasoning: z.string().max(20000).optional(),
  confidenceScore: z.number().finite().min(0).max(100).optional(),
});

const logsSchema = z.string().max(50000).refine(
  (logs) => logs.split(/\r\n|\r|\n/).length <= 1000,
  '로그는 1000줄 이하여야 합니다.',
);
export const CaseSubmissionSchema = safeObjectKeys.pipe(z.strictObject({
  schemaVersion: z.literal(1),
  clientIncidentId: z.string().min(1).max(200),
  report: z.preprocess((value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'sessionId'));
    }
    return value;
  }, SubmittedReportSchema),
  evidence: z.strictObject({ logs: logsSchema, declaredImageCount: z.number().int().min(0).max(16) }),
}));
export type CaseSubmission = z.infer<typeof CaseSubmissionSchema>;

export const ReviewActorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('local-demo') }),
  z.strictObject({ kind: z.literal('shared-token') }),
  z.strictObject({ kind: z.literal('oidc'), subject: z.string().min(1).max(1000) }),
]);
export type ReviewActor = z.infer<typeof ReviewActorSchema>;
const acknowledgement = z.strictObject({ checkId: shortText.min(1), acknowledged: z.literal(true) });
export const ReviewCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('begin') }),
  z.strictObject({ kind: z.literal('complete'), acknowledgements: z.array(acknowledgement).max(10), note: z.string().trim().min(1).max(2000) }),
  z.strictObject({ kind: z.literal('request-changes'), note: z.string().trim().min(1).max(2000) }),
]);
export const ReviewRequestSchema = safeObjectKeys.pipe(z.strictObject({
  expectedRevision: z.number().int().min(1).max(3),
  command: ReviewCommandSchema,
}));
export type ReviewCommand = z.infer<typeof ReviewCommandSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const ManualSectionSchema = z.strictObject({
  sourceId: shortText.min(1), version: shortText.min(1), sectionId: shortText.min(1),
  title: shortText.min(1), quote: text.min(1), authority: z.literal('synthetic-demo'),
  sourcePath: shortText.min(1), contentHash: DigestSchema,
});
const EvidenceSpanSchema = z.strictObject({
  id: shortText.min(1), startLine: z.number().int().min(1).max(1000),
  endLine: z.number().int().min(1).max(1000), quote: z.string().max(50000), logDigest: DigestSchema,
});
const CheckSchema = z.strictObject({
  id: shortText.min(1), instruction: text.min(1), verify: text.min(1),
  risk: z.enum(['read-only-check', 'requires-change-approval']), caution: text.min(1),
  evidenceIds: z.array(shortText).min(1).max(4),
  sourceId: shortText, version: shortText, sectionId: shortText,
});
export const ResponseContentSchema = z.strictObject({
  provenance: z.literal('operator-submitted'),
  clientIncidentId: z.string().min(1).max(200),
  report: SubmittedReportSchema,
  evidence: z.strictObject({
    logs: logsSchema, declaredImageCount: z.number().int().min(0).max(16),
    imagesRetained: z.literal(false), logDigest: DigestSchema,
    spans: z.array(EvidenceSpanSchema).max(12),
  }),
  catalogVersion: z.literal('synthetic-ko-1'),
  sources: z.array(ManualSectionSchema).max(3),
  checks: z.array(CheckSchema).max(3),
  gaps: z.array(z.strictObject({ id: shortText, reason: text, blocking: z.literal(true) })).max(3),
});
export type ResponseContent = z.infer<typeof ResponseContentSchema>;

const reviewStamp = {
  actor: ReviewActorSchema, at: timestamp, note: z.string().min(1).max(2000), contentDigest: DigestSchema,
};
export const ReviewStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('draft') }),
  z.strictObject({ kind: z.literal('in-review') }),
  z.strictObject({ kind: z.literal('changes-requested'), ...reviewStamp }),
  z.strictObject({ kind: z.literal('reviewed'), ...reviewStamp, acknowledgements: z.array(acknowledgement).min(1).max(3) }),
]);
export const ResponseCaseSchema = safeObjectKeys.pipe(z.strictObject({
  schemaVersion: z.literal(1), id: CaseIdSchema,
  revision: z.number().int().min(1).max(3), createdAt: timestamp, createdBy: ReviewActorSchema,
  content: ResponseContentSchema, contentDigest: DigestSchema,
  state: ReviewStateSchema,
  reviewEvents: z.array(z.strictObject({
    revision: z.number().int().min(2).max(3), command: ReviewCommandSchema,
    actor: ReviewActorSchema, at: timestamp, contentDigest: DigestSchema,
  })).max(2),
}));
export type ResponseCase = z.infer<typeof ResponseCaseSchema>;
export const REVIEW_STATUS_LABELS: Record<ResponseCase['state']['kind'], string> = {
  draft: '초안', 'in-review': '검토 중', reviewed: '검토 완료', 'changes-requested': '보완 필요',
};
export const WORKFLOW_NOTICE = '기관 공식 매뉴얼 아님. synthetic-demo 합성 예시 출처. 자동 조치 없음. 검토 완료는 계획 검토이며 장애 해결이나 실행 승인이 아닙니다.';
