import { createHash } from 'node:crypto';
import { SAMPLE_MANUALS } from '../../knowledge/sampleManuals';
import {
  CaseSubmissionSchema, ResponseCaseSchema, ResponseContentSchema,
  REVIEW_STATUS_LABELS, WORKFLOW_NOTICE,
  type CaseSubmission, type ResponseCase, type ResponseContent, type ReviewActor, type ReviewCommand,
} from '../../shared/responseCase';

export class ResponseWorkflowError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function matches(pattern: typeof SAMPLE_MANUALS[number]['pattern'], line: string): boolean {
  switch (pattern) {
    case 'latency': {
      const latency = /(?:p95(?:_latency)?|latency)[=: ]+(\d+(?:\.\d+)?)\s*ms/i.exec(line);
      const queue = /queue_depth[=: ]+(\d+)/i.exec(line);
      return Boolean((latency && Number(latency[1]) >= 1000) || (queue && Number(queue[1]) >= 100)
        || /queue (?:saturation|saturated)|대기열 포화/i.test(line));
    }
    case 'pressure':
      return /\b(?:OOM|OutOfMemory|ENOSPC)\b|out of memory|no space left|disk full|메모리 부족|저장소 포화|(?:memory|disk)[_ ](?:usage|used)[=: ]+(?:9\d|100)%/i.test(line);
    case 'security':
      return /authentication failed|failed (?:login|password)|suspicious authentication|인증 실패|detector=(?:"?)(?:waf|ids|ddos)\b/i.test(line);
  }
}

export function buildResponseContent(submission: CaseSubmission): ResponseContent {
  const logs = submission.evidence.logs.replace(/\r\n?/g, '\n');
  const lines = logs.split('\n');
  const logDigest = contentHash(logs);
  const spans: ResponseContent['evidence']['spans'] = [];
  const sources: ResponseContent['sources'] = [];
  const checks: ResponseContent['checks'] = [];
  for (const manual of SAMPLE_MANUALS) {
    const matched = lines.flatMap((line, index) => matches(manual.pattern, line) ? [{ line, index }] : []).slice(0, 4);
    if (matched.length === 0) continue;
    const { pattern: _pattern, instruction, verify, risk, caution, ...section } = manual;
    sources.push({ ...section, contentHash: contentHash(section) });
    const evidenceIds = matched.map(({ line, index }) => {
      const id = `${manual.sectionId}-line-${index + 1}`;
      spans.push({ id, startLine: index + 1, endLine: index + 1, quote: line, logDigest });
      return id;
    });
    checks.push({ id: `check-${manual.sectionId}`, instruction, verify, risk, caution, evidenceIds,
      sourceId: manual.sourceId, version: manual.version, sectionId: manual.sectionId });
  }
  const gaps: ResponseContent['gaps'] = [];
  if (checks.length === 0) gaps.push({ id: 'unmatched-evidence', blocking: true,
    reason: '합성 매뉴얼과 일치하는 텍스트 근거가 없습니다. 원본 로그와 적용할 절차를 담당자가 보완해야 합니다.' });
  if (submission.evidence.declaredImageCount > 0) gaps.push({ id: 'images-not-retained', blocking: true,
    reason: '이미지는 이 검토에 보관되지 않습니다. 이미지의 핵심 관측값을 원본 시각과 함께 텍스트로 보완한 새 초안이 필요합니다.' });
  return ResponseContentSchema.parse({
    provenance: 'operator-submitted', clientIncidentId: submission.clientIncidentId,
    report: submission.report, evidence: { logs, declaredImageCount: submission.evidence.declaredImageCount,
      imagesRetained: false, logDigest, spans }, catalogVersion: 'synthetic-ko-1', sources, checks, gaps,
  });
}

export function createResponseCase(input: unknown, id: string, actor: ReviewActor, at: string): ResponseCase {
  const content = buildResponseContent(CaseSubmissionSchema.parse(input));
  return ResponseCaseSchema.parse({ schemaVersion: 1, id, revision: 1, createdAt: at, createdBy: actor,
    content, contentDigest: contentHash(content), state: { kind: 'draft' }, reviewEvents: [] });
}

export function applyReviewCommand(current: ResponseCase, command: ReviewCommand, actor: ReviewActor, at: string): ResponseCase {
  let state: ResponseCase['state'];
  if (command.kind === 'begin') {
    if (current.state.kind !== 'draft') throw new ResponseWorkflowError(409, '초안에서만 검토를 시작할 수 있습니다.');
    state = { kind: 'in-review' };
  } else {
    if (current.state.kind !== 'in-review') throw new ResponseWorkflowError(409, '검토 중 상태에서만 결정할 수 있습니다. 새로고침하세요.');
    const stamp = { actor, at, note: command.note, contentDigest: current.contentDigest };
    if (command.kind === 'complete') {
      const ids = command.acknowledgements.map((entry) => entry.checkId);
      if (current.content.gaps.some((gap) => gap.blocking) || current.content.checks.length === 0) {
        throw new ResponseWorkflowError(422, '차단 근거 공백을 보완한 새 초안이 필요합니다.');
      }
      if (!command.note.trim() || ids.length !== current.content.checks.length || new Set(ids).size !== ids.length
        || current.content.checks.some((check) => !ids.includes(check.id))
        || command.acknowledgements.some((entry) => entry.acknowledged !== true)) {
        throw new ResponseWorkflowError(422, '모든 확인 계획과 위험을 명시적으로 검토하고 메모를 입력하세요.');
      }
      state = { kind: 'reviewed', ...stamp, acknowledgements: command.acknowledgements };
    } else {
      state = { kind: 'changes-requested', ...stamp };
    }
  }
  return { ...current, revision: current.revision + 1, state,
    reviewEvents: [...current.reviewEvents, { revision: current.revision + 1, command, actor, at, contentDigest: current.contentDigest }] };
}

export function validateStoredResponseCase(input: unknown): ResponseCase {
  const current = ResponseCaseSchema.parse(input);
  const rebuilt = buildResponseContent({ schemaVersion: 1, clientIncidentId: current.content.clientIncidentId,
    report: current.content.report, evidence: current.content.evidence });
  if (canonicalJson(rebuilt) !== canonicalJson(current.content) || contentHash(current.content) !== current.contentDigest) {
    throw new ResponseWorkflowError(500, '저장된 근거 또는 출처의 무결성을 확인할 수 없습니다.');
  }
  let replay: ResponseCase = { ...current, revision: 1, state: { kind: 'draft' }, reviewEvents: [] };
  let previousTime = Date.parse(current.createdAt);
  for (const event of current.reviewEvents) {
    if (Date.parse(event.at) < previousTime) throw new ResponseWorkflowError(500, '검토 이력이 올바르지 않습니다.');
    replay = applyReviewCommand(replay, event.command, event.actor, event.at);
    previousTime = Date.parse(event.at);
  }
  if (canonicalJson(replay) !== canonicalJson(current)) throw new ResponseWorkflowError(500, '검토 이력 또는 상태가 일치하지 않습니다.');
  return current;
}

function actorLabel(actor: ReviewActor): string {
  return actor.kind === 'local-demo' ? 'local-demo (연습용 검토)' : actor.kind === 'shared-token' ? 'shared-token (공유 자격 증명)' : `oidc (${actor.subject})`;
}

function escaped(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|<>]/g, (char) => `\\${char}`);
}

export function renderResponseMarkdown(current: ResponseCase, generatedAt: string): string {
  const { content, state } = current;
  return [
    '# 대응 검토 인계서', '', `상태: **${REVIEW_STATUS_LABELS[state.kind]}** | revision ${current.revision}`,
    WORKFLOW_NOTICE, `생성 시각 (UTC): ${generatedAt}`,
    `생성 시각 (한국): ${new Date(generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`,
    `사건 ID: ${current.id}`, `제출 경계: operator-submitted (운영자 제출 스냅샷, 진위 미검증)`,
    `제출자: ${escaped(actorLabel(current.createdBy))}`, `스냅샷 SHA-256: ${current.contentDigest}`,
    '', '## 사건 요약', escaped(content.report.title), `심각도: ${content.report.severity}`, escaped(content.report.summary),
    '', '## 원인 가설 (분석 제안, 확인된 사실 아님)', ...content.report.rootCauses.map((cause) => `- ${escaped(cause)}`),
    '', '## 제출 근거', `로그 SHA-256: ${content.evidence.logDigest}`,
    `선언된 이미지: ${content.evidence.declaredImageCount}개. 이미지 보관 없음.`,
    ...content.evidence.logs.split('\n').map((line, index) => `> ${index + 1}: ${escaped(line)}`),
    '', '## 확인 계획 (실행 결과 아님)', ...content.checks.flatMap((check) => [
      `### ${check.id}`, escaped(check.instruction), `검증 계획: ${escaped(check.verify)}`,
      `위험: ${check.risk}. ${escaped(check.caution)}`,
      `근거: ${check.evidenceIds.join(', ')}. 출처: ${check.sourceId}/${check.version}/${check.sectionId}`,
    ]),
    '', '## 미확인 사항', ...(content.gaps.length ? content.gaps.map((gap) => `- 차단: ${escaped(gap.reason)}`)
      : ['- 추가 관측 결과와 실제 원인, 조치 결과는 아직 확인 필요.']),
    '', '## 매뉴얼 출처 (synthetic-demo)', ...content.sources.flatMap((source) => [
      `### ${escaped(source.title)}`, `${source.sourceId}/${source.version}/${source.sectionId}`,
      `> ${escaped(source.quote)}`, `SHA-256: ${source.contentHash}`, `소스: ${source.sourcePath}`,
    ]),
    '', '## 검토 이력', ...current.reviewEvents.map((event) =>
      `- ${event.at} | ${escaped(actorLabel(event.actor))} | ${event.command.kind} | revision ${event.revision}${event.command.kind !== 'begin' ? ` | ${escaped(event.command.note)}` : ''}`),
    '', '## 다음 담당자 확인사항', '계획 검토와 실제 작업을 구분하고 원본 진위, 추가 관측, 변경 승인 여부를 별도로 확인하세요.',
    '파일 저장소는 위변조 방지, 다중 프로세스 동시성 또는 기관별 격리를 제공하지 않습니다.', '',
  ].join('\n');
}

export function renderResponseExport(current: ResponseCase, format: 'markdown' | 'json' | 'hancom-json', generatedAt: string): string {
  if (format === 'markdown') return renderResponseMarkdown(current, generatedAt);
  const notes = [WORKFLOW_NOTICE, 'operator-submitted 스냅샷. 입력 진위 미검증. 실제 조치 및 장애 해결은 확인 필요.'];
  if (format === 'json') return JSON.stringify({ schemaVersion: 1, generated_at_utc: generatedAt, notes, responseCase: current }, null, 2);
  const reviewer = current.reviewEvents.at(-1)?.actor ?? current.createdBy;
  const reviewNote = current.state.kind === 'reviewed' || current.state.kind === 'changes-requested'
    ? current.state.note : '결정 메모 없음. 검토 완료되지 않음.';
  return JSON.stringify({
    schemaVersion: 1, template_name: 'aegisops-synthetic-handover', generated_at_utc: generatedAt,
    templateValidated: false,
    notes: [...notes, '한컴 텍스트 치환용 JSON입니다. .hwp/.hwpx 파일 또는 검증된 기관 서식이 아닙니다.'],
    template_placeholders: {
      '{{INCIDENT_ID}}': current.id,
      '{{SUMMARY}}': current.content.report.summary,
      '{{SEVERITY}}': current.content.report.severity,
      '{{REVIEW_STATUS}}': `${REVIEW_STATUS_LABELS[current.state.kind]} (실행 승인 아님)`,
      '{{NEXT_ACTION}}': current.content.gaps.length
        ? '차단 근거 공백을 보완한 새 초안을 제출하세요. 자동 조치 없음.'
        : current.content.checks.map((check) => check.verify).join('\n') + '\n원본 진위와 별도 변경 승인 필요성을 확인하세요. 자동 조치 없음.',
      '{{REVIEW_NOTE}}': reviewNote,
      '{{REVIEWER}}': actorLabel(reviewer),
      '{{CHECKS}}': current.content.checks.map((check) => `${check.id} | ${check.instruction}\n위험: ${check.risk}. ${check.caution}\n검증 계획: ${check.verify}\n계획 검토: ${current.state.kind === 'reviewed' ? '명시적 검토 완료 (작업 실행 아님)' : '완료되지 않음'}`).join('\n\n') || '일치하는 확인 계획 없음. 보완 필요.',
      '{{BLOCKING_GAPS}}': current.content.gaps.map((gap) => gap.reason).join('\n') || '차단 공백 없음. 실제 관측 결과와 장애 해결은 별도 확인 필요.',
      '{{SOURCES}}': current.content.sources.map((source) => `${source.sourceId}/${source.version}/${source.sectionId} synthetic-demo\n${source.quote}\nSHA-256 ${source.contentHash}`).join('\n\n') || '일치 출처 없음. 보완 필요.',
      '{{PROVENANCE}}': `operator-submitted | SHA-256 ${current.contentDigest} | ${WORKFLOW_NOTICE}`,
    },
  }, null, 2);
}
