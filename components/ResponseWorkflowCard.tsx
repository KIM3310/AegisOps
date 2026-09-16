import React, { useState } from 'react';
import { useResponseWorkflow } from '../hooks/useResponseWorkflow';
import { REVIEW_STATUS_LABELS, WORKFLOW_NOTICE, type CaseSubmission, type ResponseCase, type ReviewCommand } from '../shared/responseCase';
import { ResponseWorkflowLogin } from './ResponseWorkflowLogin';
import type { ResponseWorkflowCapability } from '../shared/responseCapability';

const buttonClass = 'border border-border rounded-lg px-3 py-2 text-sm hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed';

function ReviewControls({ current, busy, onReview }: { current: ResponseCase; busy: boolean; onReview: (command: ReviewCommand) => Promise<void> }) {
  const [acknowledgedIds, setAcknowledgedIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const blocked = current.content.gaps.some((gap) => gap.blocking);
  if (current.state.kind === 'draft') return <button className={buttonClass} disabled={busy} onClick={() => void onReview({ kind: 'begin' })}>검토 시작</button>;
  if (current.state.kind !== 'in-review') return <div className="space-y-2">
    <p>검토 메모: {current.state.note}</p>
    <p>검토자: {current.state.actor.kind}{current.state.actor.kind === 'oidc' ? ` / ${current.state.actor.subject}` : ''} · {current.state.at}</p>
    <p>이 검토는 종료되었습니다. 수정은 새 제출 스냅샷의 초안에서 시작하세요.</p>
  </div>;
  return <div className="space-y-3">
    <fieldset disabled={busy} className="space-y-3">
      <legend className="font-medium mb-2">계획별 명시적 검토 (작업 실행 표시가 아닙니다)</legend>
      {current.content.checks.map((check) => <label key={check.id} className="flex gap-3 items-start">
        <input type="checkbox" checked={acknowledgedIds.includes(check.id)} onChange={(event) => setAcknowledgedIds((previous) => event.target.checked ? [...previous, check.id] : previous.filter((id) => id !== check.id))} className="mt-1" />
        <span>{check.id}: 확인 계획과 위험을 검토했습니다. 실제 조치 실행 또는 결과 확인을 뜻하지 않습니다.</span>
      </label>)}
      <label className="block">검토 메모 (필수, 최대 2000자)
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={3} className="block w-full mt-2 bg-bg border border-border rounded-lg p-3" placeholder="다음 담당자, 확인할 시간 구간과 남은 의문을 기록하세요." />
      </label>
    </fieldset>
    <div className="flex flex-wrap gap-2">
      <button className={buttonClass} disabled={busy || blocked || current.content.checks.length === 0 || acknowledgedIds.length !== current.content.checks.length || !note.trim()}
        onClick={() => void onReview({ kind: 'complete', note, acknowledgements: acknowledgedIds.map((checkId) => ({ checkId, acknowledged: true })) })}>계획 검토 완료</button>
      <button className={buttonClass} disabled={busy || !note.trim()} onClick={() => void onReview({ kind: 'request-changes', note })}>보완 요청</button>
    </div>
    {blocked && <p className="text-sev2">차단 근거 공백이 있어 완료할 수 없습니다. 보완 요청 후 새 초안을 만드세요.</p>}
  </div>;
}

export function ResponseWorkflowCard({ submission = null, capability }: {
  submission?: CaseSubmission | null;
  capability?: ResponseWorkflowCapability | null;
}) {
  const workflow = useResponseWorkflow(submission, capability);
  const current = workflow.responseCase;
  const isCloud = capability?.kind === 'cloud-response';
  const disabled = workflow.busy || !workflow.available;
  return <section aria-label="공공 대응 검토" aria-busy={workflow.busy} className="rounded-xl border border-accent/30 bg-bg-card p-5 space-y-4 text-sm">
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">공공 대응 검토 · 근거에서 인계까지</h2>
      <p>{WORKFLOW_NOTICE}</p>
      <p className="text-text-muted">분석 보고서는 운영자가 제출한 스냅샷입니다. 모델의 제안과 공식 절차를 구분하세요. 원본 진위는 확인하지 않습니다.</p>
      {isCloud && <p>브라우저 합성 분석과 대응 검토 저장은 별개입니다. 검토는 공유 D1 작업 공간에 저장합니다. 합성 데이터만 제출하세요. 공유 토큰은 개인 승인이 아닙니다.</p>}
      {capability?.kind === 'unavailable' && <p role="status">{capability.reason === 'static' ? '정적 페이지에서는 대응 검토 저장·열기·내보내기를 사용할 수 없습니다.' : '클라우드 검토 설정이 완료되지 않아 저장·열기·내보내기를 사용할 수 없습니다. 관리자에게 설정 확인을 요청하세요.'} 분석 보고서와 브라우저 로컬 기록은 계속 사용할 수 있습니다.</p>}
      {capability === null && <p role="status">검토 기능을 확인하고 있습니다. 확인이 계속되지 않으면 페이지를 새로고침하세요.</p>}
      {capability === undefined && <p className="text-text-muted">{current ? '검토 API 응답을 확인했습니다.' : '검토 API 기능은 아직 확인되지 않았습니다. 실제 요청으로 연결을 확인합니다.'}</p>}
    </div>
    {workflow.session?.kind === 'checking' && <p role="status">검토 세션 확인 중입니다.</p>}
    {workflow.session?.kind === 'error' && <div className="space-y-2">
      <p role="alert" className="text-sev1">{workflow.session.message}</p>
      <button className={buttonClass} onClick={() => void workflow.refreshSession()}>세션 확인 다시 시도</button>
    </div>}
    {workflow.session?.kind === 'active' && <div className="space-y-2">
      <p>shared-token 로그인 확인 · 개인 승인 아님 · 만료 {workflow.session.session.expiresAt}. 저장이나 열기는 해당 버튼을 눌러 시도하세요.</p>
      <button className={buttonClass} disabled={workflow.busy} onClick={() => void workflow.logout()}>로그아웃</button>
    </div>}
    <div className="flex flex-wrap gap-2">
      {submission && <button disabled={disabled} onClick={() => void workflow.create()} className={buttonClass}>{current ? '새 제출 스냅샷으로 초안 만들기' : '대응 검토 시작'}</button>}
      {!submission && workflow.lastCaseId && <button disabled={disabled} onClick={() => { if (workflow.lastCaseId) void workflow.reopen(workflow.lastCaseId); }} className={buttonClass}>최근 검토 서버에서 다시 열기</button>}
      {current && <button disabled={disabled} onClick={() => void workflow.reopen(current.id)} className={buttonClass}>서버 상태 새로고침</button>}
    </div>
    {!submission && !current && <p>로그를 분석한 뒤 대응 검토를 시작하세요. 최근 검토는 ID만 브라우저에 기억하며, 열 때마다 서버에서 확인합니다.</p>}
    {workflow.busy && <p role="status">서버에서 검토를 확인하고 있습니다.</p>}
    {workflow.error && <p role="alert" className="text-sev1">{workflow.error}</p>}
    {((isCloud && workflow.session?.kind === 'inactive') || (!isCloud && workflow.authNeeded)) &&
      <ResponseWorkflowLogin initiallyOpen tokenOnly={isCloud} onAuthenticated={isCloud ? workflow.refreshSession : undefined} />}
    {current && <>
      <div className="rounded-lg border border-border p-3 space-y-2">
        <p className="font-semibold" role="status">{REVIEW_STATUS_LABELS[current.state.kind]} · 실행 승인 아님 · revision {current.revision}</p>
        <p>{current.createdBy.kind === 'local-demo' ? 'local-demo · 키 없는 로컬 연습용 검토' : current.createdBy.kind === 'shared-token' ? 'shared-token · 공유 자격 증명, 개인 승인 아님' : '검증된 OIDC 운영자'} · synthetic-demo 출처</p>
        <p>{current.content.report.title}</p><p>{current.content.report.summary}</p>
        <p className="break-all text-xs">검토 ID: {current.id}<br />스냅샷 SHA-256: {current.contentDigest}</p>
        <p>operator-submitted · 제출 시각 {current.createdAt} · 이미지 {current.content.evidence.declaredImageCount}개 선언, 이미지 보관 없음</p>
      </div>
      {current.content.gaps.length > 0 && <div className="rounded-lg border border-sev2/40 p-3 space-y-2">
        <h3 className="font-semibold">차단 근거 공백</h3>
        {current.content.gaps.map((gap) => <p key={gap.id}>{gap.reason}</p>)}
      </div>}
      {current.content.checks.map((check) => <article key={check.id} className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-semibold">확인 계획 · {check.id}</h3>
        <p>{check.instruction}</p><p>검증 계획: {check.verify}</p>
        <p>위험: {check.risk} · {check.caution}</p>
        <h4 className="font-medium">일치한 원본 근거 (정규화한 줄 번호)</h4>
        {current.content.evidence.spans.filter((span) => check.evidenceIds.includes(span.id)).map((span) => <div key={span.id}>
          <p>{span.startLine}~{span.endLine}줄</p><pre className="whitespace-pre-wrap break-all rounded bg-bg p-3 text-xs">{span.quote}</pre>
        </div>)}
        {current.content.sources.filter((source) => source.sourceId === check.sourceId && source.version === check.version && source.sectionId === check.sectionId).map((source) => <div key={source.sectionId} className="space-y-2">
          <h4 className="font-medium">정확한 출처 인용 · {source.title}</h4>
          <blockquote className="border-l-2 border-accent pl-3">{source.quote}</blockquote>
          <p className="break-all text-xs">{source.authority} · {source.sourceId} / {source.version} / {source.sectionId}<br />{source.sourcePath}<br />출처 SHA-256: {source.contentHash}</p>
        </div>)}
      </article>)}
      <ReviewControls key={`${current.id}:${current.revision}`} current={current} busy={disabled} onReview={workflow.review} />
      <details className="border border-border rounded p-3"><summary className="cursor-pointer">제출 로그 및 검토 이력</summary>
        <pre className="whitespace-pre-wrap break-all my-3 text-xs">{current.content.evidence.logs || '(텍스트 근거 없음)'}</pre>
        <ul>{current.reviewEvents.map((event) => <li key={event.revision}>{event.at} · {event.actor.kind} · {event.command.kind} · revision {event.revision}</li>)}</ul>
      </details>
      <div className="space-y-2">
        <h3 className="font-medium">저장된 검토 인계서 다운로드</h3>
        <div className="flex flex-wrap gap-2">{(['markdown', 'json', 'hancom-json'] as const).map((format) =>
          <button key={format} disabled={disabled} className={buttonClass} onClick={() => void workflow.download(format)}>{format === 'markdown' ? 'Markdown' : format === 'json' ? 'JSON' : '한컴 치환 JSON'} 다운로드</button>)}</div>
        <p className="text-text-muted">초안도 상태와 함께 내보냅니다. 한컴 치환 JSON은 .hwp/.hwpx 파일이 아니며, 기관 서식 검증이나 외부 전송은 하지 않습니다.</p>
      </div>
    </>}
    <p className="text-xs text-text-muted">{isCloud
      ? '공유 D1 저장소는 revision 검사로 동시 변경을 거부합니다. 위변조 방지나 기관별 격리를 제공하지 않습니다. 합성 데이터만 사용하세요. 연결 실패를 저장 성공이나 실패로 단정하지 마세요.'
      : capability === undefined
        ? '기존 네이티브 API의 파일 저장소는 위변조 방지, 다중 프로세스 동시성, 기관별 격리를 제공하지 않습니다. 합성 또는 사용 승인된 로컬 데이터만 사용하세요. 정적·오프라인 페이지에서는 검토 완료를 저장할 수 없습니다.'
        : '대응 검토 저장소를 사용할 수 없습니다. 브라우저 보고서 기록은 서버의 저장된 검토가 아닙니다. 기관별 격리나 위변조 방지를 제공하지 않습니다.'}</p>
  </section>;
}
