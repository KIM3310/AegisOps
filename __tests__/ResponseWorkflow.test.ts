import { describe, expect, it, vi } from 'vitest';
import { CaseSubmissionSchema, ResponseCaseSchema, ReviewRequestSchema, type ReviewCommand } from '../shared/responseCase';
import { createResponseCase, applyReviewCommand, validateStoredResponseCase, renderResponseExport, contentHash } from '../server/lib/responseWorkflow';

const id = '06cbd1a9-2df5-440a-982b-09105aee3a91';
const at = '2026-01-15T00:00:00.000Z';
const actor = { kind: 'local-demo' } as const;
const report = { title: '합성 지연 관측', summary: '확인 필요', severity: 'SEV2', rootCauses: ['메모리 부족이라는 모델 가설'],
  timeline: [], actionItems: [], mitigationSteps: [], tags: [] };
const submission = { schemaVersion: 1, clientIncidentId: 'incident-1', report,
  evidence: { logs: 'normal\r\nservice=demo p95_latency=2400ms queue_depth=180', declaredImageCount: 0 } };
const build = (input: unknown = submission) => createResponseCase(input, id, actor, at);
const acknowledgements = [{ checkId: 'check-latency-queue', acknowledged: true }] as const;

describe('ResponseCase domain', () => {
  it('binds a literal normalized log line to an exact synthetic source and an inspection plan', () => {
    const result = build();
    expect(result.content.evidence.logs).toBe('normal\nservice=demo p95_latency=2400ms queue_depth=180');
    expect(result.content.evidence.spans).toEqual([{
      id: 'latency-queue-line-2', startLine: 2, endLine: 2,
      quote: 'service=demo p95_latency=2400ms queue_depth=180', logDigest: result.content.evidence.logDigest,
    }]);
    expect(result.content.sources[0]).toMatchObject({ sourceId: 'demo-operations', version: '1.0.0',
      sectionId: 'latency-queue', authority: 'synthetic-demo',
      quote: '지연 또는 대기열 포화가 관측되면 같은 시간대의 요청량, 응답 지연, 대기열 길이를 읽기 전용으로 비교한다. 원인을 단정하지 않으며 설정 변경은 별도 승인 절차를 따른다.' });
    expect(result.content.checks.map((check) => check.id)).toEqual(['check-latency-queue']);
    expect(result.content.sources[0]?.contentHash).toBe('cf34172f84e9cf23ef4f14e591cfef4948e7cc8771063cc9c8a6141b57753aed');
    expect(result.state).toEqual({ kind: 'draft' });
    expect(validateStoredResponseCase(result).contentDigest).toBe(result.contentDigest);
  });

  it.each([
    ['OOM killed worker', 'check-resource-pressure'],
    ['disk full: no space left', 'check-resource-pressure'],
    ['authentication failed for demo', 'check-auth-threat'],
    ['detector="ids" signature="test"', 'check-auth-threat'],
  ])('matches observed evidence %s without a provider', (logs, checkId) => {
    const external = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    try {
      const result = build({ ...submission, evidence: { logs, declaredImageCount: 0 } });
      expect(result.content.checks.map((check) => check.id)).toEqual([checkId]);
      expect(result.content.evidence.spans[0]?.quote).toBe(logs);
      expect(external).not.toHaveBeenCalled();
    } finally { external.mockRestore(); }
  });

  it.each(['', 'everything is normal', 'latency=5ms queue_depth=1'])('blocks unknown or absent evidence %s', (logs) => {
    const result = build({ ...submission, evidence: { logs, declaredImageCount: 0 } });
    expect(result.content.gaps).toEqual([{ id: 'unmatched-evidence', blocking: true,
      reason: '합성 매뉴얼과 일치하는 텍스트 근거가 없습니다. 원본 로그와 적용할 절차를 담당자가 보완해야 합니다.' }]);
    const reviewing = applyReviewCommand(result, { kind: 'begin' }, actor, at);
    expect(() => applyReviewCommand(reviewing, { kind: 'complete', acknowledgements: [], note: 'checked' }, actor, at)).toThrow('차단 근거 공백');
  });

  it('blocks image-only and unretained image evidence', () => {
    const result = build({ ...submission, evidence: { logs: '', declaredImageCount: 1 } });
    expect(result.content.gaps.map((gap) => gap.id)).toEqual(['unmatched-evidence', 'images-not-retained']);
    expect(result.content.evidence.imagesRetained).toBe(false);
  });

  it.each(['actor', 'state', 'citations', 'digest', 'sources'])('rejects forged input field %s', (field) => {
    expect(() => build({ ...submission, [field]: 'forged' })).toThrow();
    expect(() => build({ ...submission, report: { ...report, [field]: 'forged' } })).toThrow();
  });

  it('rejects own prototype keys before strict parsing can discard them', () => {
    const injected = JSON.parse(JSON.stringify(submission).replace('"summary":"확인 필요"', '"summary":"확인 필요","__proto__":{"kind":"reviewed"}'));
    expect(CaseSubmissionSchema.safeParse(injected).success).toBe(false);
    expect(ReviewRequestSchema.safeParse(JSON.parse('{"expectedRevision":1,"command":{"kind":"begin","__proto__":{"actor":"spoof"}}}')).success).toBe(false);
    expect(build().state).toEqual({ kind: 'draft' });
  });

  it('strips only the known report transport field and rejects unknown versions or oversized evidence', () => {
    expect(build({ ...submission, report: { ...report, sessionId: 'transport' } }).content.report).toEqual(report);
    expect(CaseSubmissionSchema.safeParse({ ...submission, schemaVersion: 2 }).success).toBe(false);
    expect(CaseSubmissionSchema.safeParse({ ...submission, evidence: { logs: 'x'.repeat(50001), declaredImageCount: 0 } }).success).toBe(false);
    expect(ReviewRequestSchema.safeParse({ expectedRevision: 1, command: { kind: 'begin', actor: 'spoof' } }).success).toBe(false);
    expect(ResponseCaseSchema.safeParse({ ...build(), schemaVersion: 2 }).success).toBe(false);
  });

  it('requires explicit unique acknowledgements, a note and the permitted state sequence', () => {
    const draft = build();
    const complete: Extract<ReviewCommand, { kind: 'complete' }> = { kind: 'complete', acknowledgements: [...acknowledgements], note: '시간 구간과 담당자 확인 계획 검토' };
    expect(() => applyReviewCommand(draft, complete, actor, at)).toThrow('검토 중');
    const reviewing = applyReviewCommand(draft, { kind: 'begin' }, actor, at);
    expect(() => applyReviewCommand(reviewing, { kind: 'begin' }, actor, at)).toThrow('초안');
    for (const entries of [[], [...acknowledgements, ...acknowledgements], [{ checkId: 'forged', acknowledged: true } as const]]) {
      expect(() => applyReviewCommand(reviewing, { ...complete, acknowledgements: entries }, actor, at)).toThrow('명시적으로');
    }
    expect(() => applyReviewCommand(reviewing, { ...complete, note: '' }, actor, at)).toThrow('명시적으로');
    const reviewed = applyReviewCommand(reviewing, complete, actor, at);
    expect(reviewed).toMatchObject({ revision: 3, state: { kind: 'reviewed', actor, contentDigest: draft.contentDigest } });
    expect(validateStoredResponseCase(reviewed).reviewEvents.map((event) => event.command.kind)).toEqual(['begin', 'complete']);
    for (const command of [{ kind: 'begin' }, complete, { kind: 'request-changes', note: 'no' }] as const) {
      expect(() => applyReviewCommand(reviewed, command, actor, at)).toThrow();
    }
    const changed = applyReviewCommand(reviewing, { kind: 'request-changes', note: '담당자 보완 필요' }, actor, at);
    expect(changed.state).toMatchObject({ kind: 'changes-requested', note: '담당자 보완 필요' });
    expect(() => applyReviewCommand(changed, { kind: 'begin' }, actor, at)).toThrow();
  });

  it('rejects all forbidden state transitions and unknown command shapes', () => {
    const draft = build();
    const reviewing = applyReviewCommand(draft, { kind: 'begin' }, actor, at);
    const complete: ReviewCommand = { kind: 'complete', acknowledgements: [...acknowledgements], note: '검토' };
    const requestChanges: ReviewCommand = { kind: 'request-changes', note: '보완' };
    const reviewed = applyReviewCommand(reviewing, complete, actor, at);
    const changed = applyReviewCommand(reviewing, requestChanges, actor, at);
    for (const [current, commands] of [
      [draft, [complete, requestChanges]], [reviewing, [{ kind: 'begin' }]],
      [reviewed, [{ kind: 'begin' }, complete, requestChanges]], [changed, [{ kind: 'begin' }, complete, requestChanges]],
    ] as [typeof draft, ReviewCommand[]][]) {
      for (const command of commands) expect(() => applyReviewCommand(current, command, actor, at)).toThrow();
    }
    expect(ReviewRequestSchema.safeParse({ expectedRevision: 2, command: { kind: 'complete', note: 'x'.repeat(2001), acknowledgements: [] } }).success).toBe(false);
    expect(ReviewRequestSchema.safeParse({ expectedRevision: 2, command: { kind: 'complete', note: '검토', acknowledgements: Array.from({ length: 11 }, () => acknowledgements[0]) } }).success).toBe(false);
    expect(reviewed.state.kind).toBe('reviewed');
  });

  it.each(['hash', 'source', 'span', 'report', 'state', 'history'])('fails closed on persisted %s corruption', (field) => {
    const result = build();
    if (field === 'hash') result.contentDigest = '0'.repeat(64);
    if (field === 'source' && result.content.sources[0]) { result.content.sources[0].quote = 'forged'; result.contentDigest = contentHash(result.content); }
    if (field === 'span' && result.content.evidence.spans[0]) { result.content.evidence.spans[0].endLine = 999; result.contentDigest = contentHash(result.content); }
    if (field === 'report') result.content.report.summary = 'changed';
    if (field === 'state') result.state = { kind: 'in-review' };
    if (field === 'history') result.revision = 2;
    expect(() => validateStoredResponseCase(result)).toThrow();
  });

  it('renders Korean draft provenance and scalar literal Hancom placeholders without a native document claim', () => {
    const result = build();
    const markdown = renderResponseExport(result, 'markdown', at);
    expect(markdown).toContain('상태: **초안**');
    expect(markdown).toContain('operator-submitted');
    expect(markdown).toContain('기관 공식 매뉴얼 아님. synthetic-demo 합성 예시 출처. 자동 조치 없음.');
    expect(markdown).toContain('계획 검토이며 장애 해결이나 실행 승인이 아닙니다.');
    expect(markdown).toContain('2026-01-15T00:00:00.000Z');
    const payload = JSON.parse(renderResponseExport(result, 'hancom-json', at));
    expect(payload).toMatchObject({ schemaVersion: 1, templateValidated: false,
      template_placeholders: { '{{INCIDENT_ID}}': id, '{{SUMMARY}}': '확인 필요', '{{REVIEW_STATUS}}': '초안 (실행 승인 아님)' } });
    expect(Object.values(payload.template_placeholders).every((value) => typeof value === 'string')).toBe(true);
    expect(JSON.parse(renderResponseExport(result, 'json', at)).responseCase.id).toBe(id);
  });
});
