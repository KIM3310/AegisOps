import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponseWorkflowCard } from '../components/ResponseWorkflowCard';
import { ResponseWorkflowLogin } from '../components/ResponseWorkflowLogin';
import { DeploymentBanners } from '../components/DeploymentBanners';
import { ResponseWorkflowService } from '../services/ResponseWorkflowService';
import { fetchHealthz } from '../services/geminiService';
import { createResponseCase } from '../server/lib/responseWorkflow';
import App from '../App';
import type { CaseSubmission } from '../shared/responseCase';

const cloud = { kind: 'cloud-response', storage: 'd1', authMode: 'token', scope: 'shared-synthetic', configured: true } as const;
const inactive = { active: false } as const;
const active = { active: true, authMode: 'token', actor: 'shared-token', expiresAt: '2026-09-16T12:00:00.000Z' } as const;
const id = '06cbd1a9-2df5-440a-982b-09105aee3a91';
const submission: CaseSubmission = { schemaVersion: 1, clientIncidentId: 'cloud-incident',
  report: { title: '합성 지연 사례', summary: '관측 구간 확인 필요', severity: 'SEV2', rootCauses: [], timeline: [], actionItems: [], mitigationSteps: [], tags: [] },
  evidence: { logs: 'p95_latency=2400ms queue_depth=180', declaredImageCount: 0 } };
const saved = createResponseCase(submission, id, { kind: 'shared-token' }, '2026-01-15T00:00:00.000Z');
const health = { ok: true, deployment: 'static-demo', mode: 'demo', provider: 'demo', keySource: 'none', keyConfigured: false,
  limits: { maxImages: 16, maxLogChars: 50000, maxTtsChars: 0 }, defaults: { grounding: false }, models: { analyze: 'Recorded demo', tts: 'Unavailable' } };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }

let container: HTMLDivElement;
let root: ReactDOM.Root;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); sessionStorage.clear();
  container = document.createElement('div'); document.body.appendChild(container);
  root = ReactDOM.createRoot(container);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); fetchMock.mockReset();
});
function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === text);
  if (!found) throw new Error(`button missing: ${text}`);
  return found;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function renderCloud() { await act(async () => root.render(React.createElement(ResponseWorkflowCard, { submission, capability: cloud }))); }
async function fillCredential(value: string) {
  const password = container.querySelector<HTMLInputElement>('input[type=password]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!password || !setter) throw new Error('password missing');
  await act(async () => { setter.call(password, value); password.dispatchEvent(new Event('input', { bubbles: true })); });
  return password;
}
async function submitLogin() {
  const form = container.querySelector('form');
  if (!form) throw new Error('login form missing');
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('separate analysis and response capability at the health boundary', () => {
  it('marks a real static fallback unavailable while retaining synthetic browser analysis', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }));
    const result = await fetchHealthz();
    expect(result).toMatchObject({ deployment: 'static-demo', provider: 'demo', keyConfigured: false, responseWorkflow: { kind: 'unavailable', reason: 'static' } });
  });

  it('accepts D1 only through the complete capability and does not relabel native health', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...health, responseWorkflow: cloud }));
    expect(await fetchHealthz()).toMatchObject({ deployment: 'static-demo', responseWorkflow: cloud });
    fetchMock.mockResolvedValueOnce(json({ ...health, deployment: 'backend' }));
    const native = await fetchHealthz();
    expect(native.deployment).toBe('backend');
    expect(native.responseWorkflow).toBeUndefined();
  });

  it.each([
    { ...cloud, configured: false },
    { ...cloud, authMode: 'oidc' },
    { ...cloud, storage: 'file' },
    { kind: 'unavailable', reason: 'secret-value' },
    { kind: 'future-mode' },
    null,
  ])('fails closed for invalid or unknown capability %j', async (responseWorkflow) => {
    fetchMock.mockResolvedValueOnce(json({ ...health, responseWorkflow }));
    expect((await fetchHealthz()).responseWorkflow).toEqual({ kind: 'unavailable', reason: 'configuration' });
  });

  it('does not treat a static deployment without response capability as native compatibility', async () => {
    fetchMock.mockResolvedValueOnce(json(health));
    expect((await fetchHealthz()).responseWorkflow).toEqual({ kind: 'unavailable', reason: 'static' });
  });
});

describe('cloud session and truthful review controls', () => {
  it.each(['static', 'configuration'] as const)('disables save and reopen for unavailable %s review without removing local reports', async (reason) => {
    localStorage.setItem('aegisops:last-response-case-id', id);
    await act(async () => root.render(React.createElement(ResponseWorkflowCard, { submission, capability: { kind: 'unavailable', reason } })));
    expect(button('대응 검토 시작').disabled).toBe(true);
    expect(container.textContent).toContain(reason === 'static' ? '정적' : '설정');
    expect(container.querySelector('input[type=password]')).toBeNull();
    await act(async () => root.render(React.createElement(ResponseWorkflowCard, { capability: { kind: 'unavailable', reason } })));
    expect(button('최근 검토 서버에서 다시 열기').disabled).toBe(true);
    expect(localStorage.getItem('aegisops:last-response-case-id')).toBe(id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps native capability unverified until an actual review request succeeds', async () => {
    fetchMock.mockResolvedValueOnce(json(saved, 201));
    await act(async () => root.render(React.createElement(ResponseWorkflowCard, { submission })));
    expect(container.textContent).toContain('아직 확인되지 않았습니다');
    expect(button('대응 검토 시작').disabled).toBe(false);
    await click('대응 검토 시작');
    expect(container.textContent).toContain('검토 API 응답을 확인했습니다');
    expect(container.textContent).toContain('파일 저장소');
    expect(container.textContent).not.toContain('공유 D1');
  });

  it('keeps cloud actions disabled while probing the session and exposes only token login', async () => {
    let finish: (response: Response) => void = () => { throw new Error('no probe'); };
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await renderCloud();
    expect(button('대응 검토 시작').disabled).toBe(true);
    expect(container.textContent).toContain('세션 확인 중');
    await act(async () => finish(json(inactive)));
    expect(container.textContent).toContain('공유 D1');
    expect(container.textContent).toContain('합성 데이터만');
    expect(container.textContent).toContain('개인 승인');
    expect(container.querySelector('input[type=password]')?.getAttribute('type')).toBe('password');
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).not.toContain('OIDC');
    expect(container.textContent).not.toContain('역할 (');
    expect(container.textContent).not.toContain('이 파일 저장소');
    expect(button('대응 검토 시작').disabled).toBe(true);
  });

  it('clears the token before the pending login settles and enables only deliberate create after a parsed session refresh', async () => {
    let finishLogin: (response: Response) => void = () => { throw new Error('no login'); };
    fetchMock.mockResolvedValueOnce(json(inactive))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishLogin = resolve; }))
      .mockResolvedValueOnce(json(active))
      .mockResolvedValueOnce(json(saved, 201));
    await renderCloud();
    const password = await fillCredential('synthetic-cloud-token');
    await submitLogin();
    expect(password.value).toBe('');
    expect(button('대응 검토 시작').disabled).toBe(true);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
    expect(location.href).not.toContain('synthetic-cloud-token');
    await act(async () => finishLogin(json(active)));
    expect(button('대응 검토 시작').disabled).toBe(false);
    expect(container.textContent).toContain('shared-token');
    expect(container.textContent).not.toContain('revision 1');
    expect(fetchMock.mock.calls.map(([url, options]) => [String(url), options?.method ?? 'GET'])).toEqual([
      ['/api/auth/session', 'GET'], ['/api/auth/session', 'POST'], ['/api/auth/session', 'GET'],
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ authMode: 'token', credential: 'synthetic-cloud-token', roles: [] });
    await click('대응 검토 시작');
    expect(container.textContent).toContain('초안 · 실행 승인 아님 · revision 1');
    expect(localStorage.getItem('aegisops:last-response-case-id')).toBe(id);
  });

  it('offers an explicit retry for a failed cloud session probe and does not auto-create', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(json(active));
    await renderCloud();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('세션');
    expect(button('대응 검토 시작').disabled).toBe(true);
    await click('세션 확인 다시 시도');
    expect(button('대응 검토 시작').disabled).toBe(false);
    expect(container.textContent).not.toContain('revision 1');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/auth/session', '/api/auth/session']);
  });

  it('requires login again after expiry and never automatically repeats a rejected mutation', async () => {
    fetchMock.mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json({ error: { message: '로그인이 필요합니다.' } }, 403));
    await renderCloud(); await click('대응 검토 시작');
    expect(button('대응 검토 시작').disabled).toBe(true);
    expect(container.querySelector('input[type=password]')?.getAttribute('type')).toBe('password');
    expect(container.textContent).toContain('로그인이 필요합니다.');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/auth/session', '/api/response-workflows']);
  });

  it('uses session DELETE for logout and disables writes after the confirmed inactive response', async () => {
    fetchMock.mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json(inactive));
    await renderCloud(); await click('로그아웃');
    expect(button('대응 검토 시작').disabled).toBe(true);
    expect(container.querySelector('input[type=password]')?.getAttribute('type')).toBe('password');
    expect(fetchMock.mock.calls[1]).toEqual(['/api/auth/session', expect.objectContaining({ method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })]);
  });


  it('opens token login when the authoritative conflict reload loses access', async () => {
    fetchMock.mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json(saved, 201))
      .mockResolvedValueOnce(json({ error: { message: '다른 검토가 먼저 저장되었습니다.' } }, 409))
      .mockResolvedValueOnce(json({ error: { message: '로그인이 필요합니다.' } }, 403));
    await renderCloud(); await click('대응 검토 시작'); await click('검토 시작');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('로그인이 필요합니다.');
    expect(container.querySelector('input[type=password]')?.getAttribute('type')).toBe('password');
    expect(button('대응 검토 시작').disabled).toBe(true);
    expect(container.textContent).not.toContain('revision 1');
  });

  it('retains OIDC and roles on the native login only', async () => {
    await act(async () => root.render(React.createElement(ResponseWorkflowLogin, { initiallyOpen: true })));
    expect(container.querySelector('select')?.textContent).toContain('OIDC');
    expect(container.textContent).toContain('역할 (');
    expect(container.textContent).toContain('loopback');
  });

  it('describes browser synthetic analysis and D1 review separately in the deployment banner', async () => {
    await act(async () => root.render(React.createElement(DeploymentBanners, { isStaticDemo: true, isOllamaMode: false, responseWorkflow: cloud })));
    expect(container.textContent).toContain('브라우저 합성 분석');
    expect(container.textContent).toContain('공유 D1');
    expect(container.textContent).toContain('토큰');
    expect(container.textContent).not.toContain('Start the local Express API');
  });
});

describe('strict cloud session response parsing', () => {
  it('accepts only the safe active or inactive view and uses same-origin uncached requests', async () => {
    fetchMock.mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json(inactive));
    const signal = new AbortController().signal;
    expect(await ResponseWorkflowService.session(signal)).toEqual(active);
    expect(await ResponseWorkflowService.session(signal)).toEqual(inactive);
    expect(fetchMock.mock.calls[0]).toEqual(['/api/auth/session', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', signal: expect.any(AbortSignal) })]);
  });

  it.each([
    { active: true },
    { ...active, authMode: 'oidc' },
    { ...active, actor: 'local-demo' },
    { ...active, expiresAt: 'not-a-date' },
    { ...active, credential: 'must-not-enter-state' },
    { ...inactive, actor: 'shared-token' },
  ])('rejects a malformed session instead of enabling cloud mutations %j', async (session) => {
    fetchMock.mockResolvedValueOnce(json(session));
    await expect(ResponseWorkflowService.session(new AbortController().signal)).rejects.toMatchObject({ message: expect.stringContaining('세션') });
  });

  it('does not report logout success for an active or malformed response', async () => {
    fetchMock.mockResolvedValueOnce(json(active));
    await expect(ResponseWorkflowService.logout(new AbortController().signal)).rejects.toMatchObject({ message: expect.stringContaining('로그아웃') });
  });
});


describe('App response capability', () => {
  function apiFor(responseWorkflow?: typeof cloud | { kind: 'unavailable'; reason: 'static' | 'configuration' }) {
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/api/healthz') return json({ ...health, deployment: responseWorkflow === undefined ? 'backend' : 'static-demo', responseWorkflow });
      if (String(input) === '/api/auth/session') return json(inactive);
      return json({ error: { message: '지원하지 않는 API입니다.' } }, 404);
    });
  }

  it('shows only cloud token login across the entire App, including the intro', async () => {
    apiFor(cloud);
    await act(async () => root.render(React.createElement(App)));
    expect(container.textContent).toContain('공유 D1');
    expect(container.querySelectorAll('input[type=password]').length).toBe(1);
    expect(container.textContent).not.toContain('OIDC ID 토큰');
    expect(container.textContent).not.toContain('역할 (');
    expect(Array.from(container.querySelectorAll('option')).map((option) => option.textContent)).not.toContain('OIDC');
    expect(container.textContent).not.toContain('로컬 데모는 API 키 없이 사용할 수 있습니다');
  });

  it.each(['static', 'configuration'] as const)('removes native login and broken review instructions from the %s intro', async (reason) => {
    apiFor({ kind: 'unavailable', reason });
    await act(async () => root.render(React.createElement(App)));
    const intro = container.querySelector('h1')?.closest('section');
    expect(intro?.textContent).toContain('대응 검토 저장은 사용할 수 없습니다');
    expect(container.querySelectorAll('input[type=password]').length).toBe(0);
    expect(intro?.textContent).not.toContain('3. 대응 검토를 시작합니다');
    expect(container.textContent).toContain('분석 보고서와 브라우저 로컬 기록은 계속 사용할 수 있습니다');
  });

  it('does not offer native login while capability discovery is pending', async () => {
    let finishHealth: (response: Response) => void = () => { throw new Error('health probe missing'); };
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/api/healthz') return new Promise<Response>((resolve) => { finishHealth = resolve; });
      if (String(input) === '/api/auth/session') return json(inactive);
      return json({ error: { message: '지원하지 않는 API입니다.' } }, 404);
    });
    await act(async () => root.render(React.createElement(App)));
    expect(container.querySelector('h1')?.closest('section')?.textContent).toContain('검토 기능 확인 후');
    expect(container.querySelector('h1')?.closest('section')?.querySelector('input[type=password]')).toBeNull();
    await act(async () => finishHealth(json({ ...health, responseWorkflow: cloud })));
    expect(container.textContent).toContain('공유 D1');
    expect(container.textContent).not.toContain('OIDC ID 토큰');
  });


  it('hides runtime-key controls while health is pending and enables them only after native health is confirmed', async () => {
    let finishHealth: (response: Response) => void = () => { throw new Error('health probe missing'); };
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/api/healthz') return new Promise<Response>((resolve) => { finishHealth = resolve; });
      return json({ error: { message: '지원하지 않는 API입니다.' } }, 404);
    });
    await act(async () => root.render(React.createElement(App)));
    expect(container.querySelector('input[placeholder="Enter Gemini API key (e.g. AIza...)"]')).toBeNull();
    expect(container.querySelector('[aria-label="Toggle API key panel"]')).toBeNull();
    await act(async () => finishHealth(json({ ...health, deployment: 'backend' })));
    expect(container.querySelector('input[placeholder="Enter Gemini API key (e.g. AIza...)"]')?.getAttribute('type')).toBe('password');
    expect(container.querySelector('[aria-label="Toggle API key panel"]')?.textContent).toContain('API Key');
  });

  it('retains native compatibility login when backend health has no capability field', async () => {
    apiFor();
    await act(async () => root.render(React.createElement(App)));
    const intro = container.querySelector('h1')?.closest('section');
    expect(intro?.textContent).toContain('OIDC ID 토큰');
    expect(intro?.textContent).toContain('역할 (');
    expect(intro?.textContent).toContain('3. 대응 검토를 시작합니다');
    expect(container.textContent).toContain('아직 확인되지 않았습니다');
  });
});
