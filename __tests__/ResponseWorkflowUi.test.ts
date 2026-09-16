import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponseWorkflowCard } from '../components/ResponseWorkflowCard';
import { ResponseWorkflowLogin } from '../components/ResponseWorkflowLogin';
import { useResponseWorkflow } from '../hooks/useResponseWorkflow';
import { createResponseCase, applyReviewCommand, renderResponseExport } from '../server/lib/responseWorkflow';
import { CaseSubmissionSchema, ReviewRequestSchema, type ResponseCase, type CaseSubmission } from '../shared/responseCase';

const id = '06cbd1a9-2df5-440a-982b-09105aee3a91';
const secondId = '14cbd1a9-2df5-440a-982b-09105aee3a92';
const at = '2026-01-15T00:00:00.000Z';
const actor = { kind: 'local-demo' } as const;
const submission: CaseSubmission = { schemaVersion: 1, clientIncidentId: 'incident-1',
  report: { title: '지연 합성 사례', summary: '관측 구간 확인 필요', severity: 'SEV2', rootCauses: [], timeline: [], actionItems: [], mitigationSteps: [], tags: [] },
  evidence: { logs: 'p95_latency=2400ms queue_depth=180', declaredImageCount: 0 } };
const lastKey = 'aegisops:last-response-case-id';

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }

describe('Response workflow Korean interactions', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let saved: ResponseCase;
  let requests: { url: string; options?: RequestInit }[];
  const fetchMock = vi.fn<typeof fetch>();
  const anchorClick = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear(); requests = [];
    saved = createResponseCase(submission, id, actor, at);
    container = document.createElement('div'); document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test-export'), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick);
    fetchMock.mockImplementation(async (input, options) => {
      const url = String(input); requests.push({ url, options });
      if (url === '/api/auth/session') return json({ active: true });
      if (url === '/api/response-workflows') {
        saved = createResponseCase(CaseSubmissionSchema.parse(JSON.parse(String(options?.body))), id, actor, at);
        return json(saved, 201);
      }
      if (url.endsWith('/review')) {
        const request = ReviewRequestSchema.parse(JSON.parse(String(options?.body)));
        saved = applyReviewCommand(saved, request.command, actor, at);
        return json(saved);
      }
      if (url.includes('/export?')) {
        const format = new URL(url, 'http://localhost').searchParams.get('format');
        if (format !== 'markdown' && format !== 'json' && format !== 'hancom-json') throw new Error('unexpected export');
        return new Response(renderResponseExport(saved, format, at), { headers: { 'content-type': format === 'markdown' ? 'text/markdown' : 'application/json' } });
      }
      return json(saved);
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); fetchMock.mockReset(); anchorClick.mockReset();
  });
  function button(text: string): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === text);
    if (!found) throw new Error(`button missing: ${text}`);
    return found;
  }
  async function click(text: string) { await act(async () => button(text).click()); }
  async function render(value: CaseSubmission | null = submission) {
    await act(async () => root.render(React.createElement(ResponseWorkflowCard, { submission: value })));
  }
  async function note(value: string) {
    const field = container.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!field || !setter) throw new Error('note field missing');
    await act(async () => { setter.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  async function complete() {
    await click('대응 검토 시작'); await click('검토 시작');
    const checkbox = container.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (!checkbox) throw new Error('checkbox missing');
    await act(async () => checkbox.click());
    await note('관측 구간과 담당자를 확인할 계획입니다.'); await click('계획 검토 완료');
  }

  it('shows exact sources, requires plan/risk acknowledgement and a note, then downloads server exports', async () => {
    await render(); await click('대응 검토 시작');
    expect(container.textContent).toContain('local-demo · 키 없는 로컬 연습용 검토');
    expect(container.textContent).toContain('p95_latency=2400ms queue_depth=180');
    expect(container.querySelector('blockquote')?.textContent).toBe('지연 또는 대기열 포화가 관측되면 같은 시간대의 요청량, 응답 지연, 대기열 길이를 읽기 전용으로 비교한다. 원인을 단정하지 않으며 설정 변경은 별도 승인 절차를 따른다.');
    expect(container.textContent).toContain('demo-operations / 1.0.0 / latency-queue');
    await click('검토 시작');
    expect(button('계획 검토 완료').disabled).toBe(true);
    const checkbox = container.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (!checkbox) throw new Error('checkbox missing');
    expect(checkbox.closest('label')?.textContent).toContain('실제 조치 실행 또는 결과 확인을 뜻하지 않습니다.');
    await act(async () => checkbox.click());
    expect(button('계획 검토 완료').disabled).toBe(true);
    await note('담당자가 원본 관측을 확인할 계획입니다.');
    expect(button('계획 검토 완료').disabled).toBe(false);
    await click('계획 검토 완료');
    expect(container.textContent).toContain('검토 완료 · 실행 승인 아님 · revision 3');
    expect(saved.state).toMatchObject({ kind: 'reviewed', note: '담당자가 원본 관측을 확인할 계획입니다.' });
    for (const label of ['Markdown 다운로드', 'JSON 다운로드', '한컴 치환 JSON 다운로드']) await click(label);
    expect(requests.filter((item) => item.url.includes('/export?')).map((item) => item.url)).toEqual([
      `/api/response-workflows/${id}/export?format=markdown`, `/api/response-workflows/${id}/export?format=json`, `/api/response-workflows/${id}/export?format=hancom-json`,
    ]);
    expect(anchorClick).toHaveBeenCalledTimes(3);
    expect(requests.every((item) => item.options?.credentials === 'same-origin' && item.options.cache === 'no-store')).toBe(true);
    expect(localStorage.getItem(lastKey)).toBe(id);
    expect(localStorage.length).toBe(1);
  });

  it('reopens only the saved ID and fetches authoritative status after browser reload', async () => {
    await render(); await complete();
    await act(async () => root.unmount()); root = ReactDOM.createRoot(container);
    await render(null);
    expect(container.textContent).not.toContain('검토 완료 · 실행 승인 아님');
    await click('최근 검토 서버에서 다시 열기');
    expect(requests.at(-1)?.url).toBe(`/api/response-workflows/${id}`);
    expect(container.textContent).toContain('검토 완료 · 실행 승인 아님 · revision 3');
    expect(container.textContent).toContain('관측 구간과 담당자를 확인할 계획입니다.');
  });

  it('does not reopen case A inside report B and still refreshes the case created for B', async () => {
    localStorage.setItem(lastKey, id);
    const secondSubmission = { ...submission, clientIncidentId: 'incident-2', report: { ...submission.report, title: '두 번째 보고서' } };
    await render(secondSubmission);
    const foreignReopen = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '최근 검토 서버에서 다시 열기');
    if (foreignReopen) await act(async () => foreignReopen.click());
    expect(container.textContent).not.toContain('검토 ID: ' + id);
    expect(foreignReopen).toBeUndefined();
    expect(requests).toEqual([]);
    fetchMock.mockImplementationOnce(async () => {
      saved = createResponseCase(secondSubmission, secondId, actor, at);
      return json(saved, 201);
    });
    await click('대응 검토 시작');
    expect(container.textContent).toContain('두 번째 보고서');
    await click('서버 상태 새로고침');
    expect(requests.at(-1)?.url).toBe(`/api/response-workflows/${secondId}`);
    expect(container.textContent).toContain('검토 ID: ' + secondId);
  });

  it('refuses a foreign reopen through the hook when a report owns the context', async () => {
    function Probe({ input }: { input: CaseSubmission | null }) {
      const workflow = useResponseWorkflow(input);
      return React.createElement('div', null,
        React.createElement('button', { onClick: () => void workflow.reopen(id) }, '외부 사례 열기'),
        React.createElement('output', null, workflow.responseCase?.content.report.title ?? '등록된 검토 없음'));
    }
    await act(async () => root.render(React.createElement(Probe, { input: { ...submission, clientIncidentId: 'incident-2' } })));
    await click('외부 사례 열기');
    expect(container.querySelector('output')?.textContent).toBe('등록된 검토 없음');
    expect(requests).toEqual([]);
    await act(async () => root.render(React.createElement(Probe, { input: null })));
    await click('외부 사례 열기');
    expect(container.querySelector('output')?.textContent).toBe('지연 합성 사례');
    expect(requests.at(-1)?.url).toBe(`/api/response-workflows/${id}`);
  });

  it('discards a late create response when the incident or its input changes', async () => {
    let finish: (response: Response) => void = () => { throw new Error('not pending'); };
    fetchMock.mockImplementationOnce((_input, options) => {
      requests.push({ url: '/api/response-workflows', options });
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    await render(); await click('대응 검토 시작');
    await render({ ...submission, clientIncidentId: 'incident-2', evidence: { logs: 'authentication failed for second incident', declaredImageCount: 0 } });
    expect(requests[0]?.options?.signal?.aborted).toBe(true);
    await act(async () => finish(json(saved, 201)));
    expect(container.textContent).not.toContain('지연 합성 사례');
    expect(localStorage.getItem(lastKey)).toBeNull();
    fetchMock.mockImplementationOnce(async () => json(createResponseCase({ ...submission, clientIncidentId: 'incident-2', report: { ...submission.report, title: '두 번째 사례' } }, secondId, actor, at), 201));
    await click('대응 검토 시작');
    expect(container.textContent).toContain('두 번째 사례');
    expect(container.textContent).not.toContain('검토 ID: ' + id);
  });

  it('refetches after 409 and resets local check marks to the server revision', async () => {
    await render(); await click('대응 검토 시작');
    saved = applyReviewCommand(saved, { kind: 'begin' }, actor, at);
    fetchMock.mockResolvedValueOnce(json({ error: { message: 'stale' } }, 409));
    await click('검토 시작');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('서버의 최신 상태를 다시 불러왔습니다');
    expect(container.textContent).toContain('검토 중 · 실행 승인 아님 · revision 2');
    expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false);
    expect(requests.at(-1)?.url).toBe(`/api/response-workflows/${id}`);
  });

  it('does not invent successful offline review or trust a persisted ID when its server read fails', async () => {
    await render(); fetchMock.mockRejectedValueOnce(new Error('offline'));
    await click('대응 검토 시작');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('오프라인 검토 완료는 지원하지 않습니다');
    expect(container.textContent).not.toContain('revision 1');
    localStorage.setItem(lastKey, id);
    await act(async () => root.unmount()); root = ReactDOM.createRoot(container);
    await render(null); fetchMock.mockResolvedValueOnce(json({ error: { message: '저장소 무결성 실패' } }, 500));
    await click('최근 검토 서버에서 다시 열기');
    expect(container.querySelector('[role=alert]')?.textContent).toBe('저장소 무결성 실패');
    expect(container.textContent).not.toContain('revision');
  });

  it('hides an older reviewed view when authoritative refresh fails', async () => {
    await render(); await complete();
    expect(container.textContent).toContain('검토 완료 · 실행 승인 아님 · revision 3');
    fetchMock.mockResolvedValueOnce(json({ error: { message: '저장소 무결성 실패' } }, 500));
    await click('서버 상태 새로고침');
    expect(container.querySelector('[role=alert]')?.textContent).toBe('저장소 무결성 실패');
    expect(container.textContent).not.toContain('revision 3');
    expect(container.textContent).not.toContain('최근 검토 서버에서 다시 열기');
    await render(null);
    expect(container.textContent).toContain('최근 검토 서버에서 다시 열기');
  });

  it('keeps blocking gaps visible and allows an explicit change request, not completion', async () => {
    await render({ ...submission, evidence: { logs: 'unknown evidence', declaredImageCount: 1 } });
    await click('대응 검토 시작'); await click('검토 시작');
    expect(container.textContent).toContain('이미지는 이 검토에 보관되지 않습니다.');
    await note('원본 로그를 보완해 주세요.');
    expect(button('계획 검토 완료').disabled).toBe(true);
    await click('보완 요청');
    expect(container.textContent).toContain('보완 필요 · 실행 승인 아님 · revision 3');
    expect(container.textContent).toContain('원본 로그를 보완해 주세요.');
  });

  it('offers an actionable login on access denial without saving credentials in localStorage or URL', async () => {
    await render(); fetchMock.mockResolvedValueOnce(json({ error: { message: 'login required' } }, 403));
    await click('대응 검토 시작');
    expect(container.querySelector('details')?.open).toBe(true);
    const password = container.querySelector<HTMLInputElement>('input[type=password]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!password || !setter) throw new Error('password missing');
    await act(async () => { setter.call(password, 'synthetic-test-credential'); password.dispatchEvent(new Event('input', { bubbles: true })); });
    const form = container.querySelector('form');
    if (!form) throw new Error('login form missing');
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain('로그인되었습니다.');
    expect(password.value).toBe('');
    expect(localStorage.length).toBe(0);
    expect(requests.at(-1)?.url).toBe('/api/auth/session');
    expect(JSON.parse(String(requests.at(-1)?.options?.body))).toEqual({ authMode: 'token', credential: 'synthetic-test-credential', roles: [] });
  });
});
