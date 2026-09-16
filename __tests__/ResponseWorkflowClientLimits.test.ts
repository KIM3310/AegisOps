import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaseSubmissionSchema } from '../shared/responseCase';
import { createResponseCase } from '../server/lib/responseWorkflow';
import { ResponseWorkflowService } from '../services/ResponseWorkflowService';

const sample = CaseSubmissionSchema.parse(JSON.parse(readFileSync('samples/response-workflow.synthetic.json', 'utf8')));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('client workflow input boundary', () => {
  it.each([
    ['50001 characters', 'x'.repeat(50001)],
    ['1001 short lines', Array(1001).fill('x').join('\n')],
  ])('rejects %s before network with an actionable re-analysis message', async (_name, logs) => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('invalid snapshot must not be sent'));
    vi.stubGlobal('fetch', fetchMock);
    const submission = { ...sample, evidence: { ...sample.evidence, logs } };
    await expect(ResponseWorkflowService.create(submission, new AbortController().signal)).rejects.toMatchObject({
      status: 400, message: expect.stringContaining('50,000자·1,000줄'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(submission.evidence.logs).toBe(logs);
  });

  it.each([
    ['50000 characters', 'x'.repeat(50000)],
    ['1000 short lines', Array(1000).fill('x').join('\n')],
  ])('submits %s without silently trimming evidence', async (_name, logs) => {
    const submission = { ...sample, evidence: { ...sample.evidence, logs } };
    const saved = createResponseCase(submission, '123e4567-e89b-42d3-a456-426614174000', { kind: 'local-demo' }, '2026-01-15T00:00:00.000Z');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await ResponseWorkflowService.create(submission, new AbortController().signal);
    expect(result).toEqual(saved);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(submission.evidence.logs).toBe(logs);
    expect(fetchMock).toHaveBeenCalledWith('/api/response-workflows', expect.objectContaining({
      method: 'POST', body: JSON.stringify(submission),
    }));
  });
});


describe('client mutation result certainty', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const operations = [
    ['create', (signal: AbortSignal) => ResponseWorkflowService.create(sample, signal)],
    ['review', (signal: AbortSignal) => ResponseWorkflowService.review(id, { expectedRevision: 1, command: { kind: 'begin' } }, signal)],
  ] as const;
  const failures = [
    ['network loss', () => Promise.reject(new Error('connection reset'))],
    ['abort', () => Promise.reject(new DOMException('aborted', 'AbortError'))],
    ['invalid JSON success', () => Promise.resolve(new Response('{', { headers: { 'content-type': 'application/json' } }))],
    ['invalid case success', () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }))],
    ['lost response body', () => Promise.resolve(new Response(new ReadableStream({ start(controller) { controller.error(new Error('body lost')); } }), { headers: { 'content-type': 'application/json' } }))],
    ['ambiguous 500', () => Promise.resolve(new Response(JSON.stringify({ error: { message: '저장소 오류' } }), { status: 500, headers: { 'content-type': 'application/json' } }))],
    ['ambiguous 503', () => Promise.resolve(new Response(JSON.stringify({ error: { message: '저장소에 연결할 수 없습니다.' } }), { status: 503, headers: { 'content-type': 'application/json' } }))],
    ['gateway timeout', () => Promise.resolve(new Response('gateway timeout', { status: 504 }))],
  ] as const;

  describe.each(operations)('%s', (_name, operation) => {
    it.each(failures)('reports %s as UNCONFIRMED without automatically retrying', async (_failure, respond) => {
      const fetchMock = vi.fn().mockImplementation(respond);
      vi.stubGlobal('fetch', fetchMock);
      const error = await operation(new AbortController().signal).catch((value: unknown) => value);
      expect(error).toMatchObject({ code: 'UNCONFIRMED', message: expect.stringContaining('저장 결과를 확인할 수 없습니다') });
      expect(error).toMatchObject({ message: expect.stringContaining('자동으로 반복하지 마세요') });
      expect(error).toMatchObject({ message: expect.not.stringContaining('저장되지 않았습니다') });
      expect(error).toMatchObject({ message: expect.not.stringContaining('로컬 API를 실행') });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('bounds a stalled mutation and reports the timeout as unconfirmed', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn((_input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }));
      vi.stubGlobal('fetch', fetchMock);
      const controller = new AbortController();
      let outcome: unknown;
      void operation(controller.signal).then((result) => { outcome = result; }, (error: unknown) => { outcome = error; });
      try {
        await vi.advanceTimersByTimeAsync(31000);
        expect(outcome).toMatchObject({ code: 'UNCONFIRMED', message: expect.stringContaining('저장 결과를 확인할 수 없습니다') });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally { controller.abort(); }
    });
  });


  it('propagates caller cancellation to the network signal and reports an unconfirmed mutation', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const pending = ResponseWorkflowService.create(sample, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'UNCONFIRMED' });
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('marks a different case ID returned for review unconfirmed rather than accepting the proposed state', async () => {
    const wrongCase = createResponseCase(sample, '223e4567-e89b-42d3-a456-426614174000', { kind: 'shared-token' }, '2026-01-15T00:00:00.000Z');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(wrongCase), { headers: { 'content-type': 'application/json' } })));
    await expect(ResponseWorkflowService.review(id, { expectedRevision: 1, command: { kind: 'begin' } }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'UNCONFIRMED', message: expect.stringContaining('다시 열어') });
  });

  it('distinguishes create capacity from review revision conflict without inventing a capacity retry delay', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { message: '공유 검토 공간이 가득 찼습니다. 소유자의 명시적 초기화가 필요합니다.' } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(ResponseWorkflowService.create(sample, new AbortController().signal)).rejects.toMatchObject({ code: 'CAPACITY', status: 409, retryAfterSeconds: undefined, message: expect.stringContaining('소유자의 명시적 초기화') });
    await expect(ResponseWorkflowService.review(id, { expectedRevision: 1, command: { kind: 'begin' } }, new AbortController().signal)).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 409 });
  });

  it('keeps finite 429 rate delay distinct from storage capacity and never schedules a mutation retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: '공유 데모의 요청 한도에 도달했습니다.' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '7' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(ResponseWorkflowService.create(sample, new AbortController().signal)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterSeconds: 7, message: expect.stringContaining('7초') });
    await vi.advanceTimersByTimeAsync(8000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['Infinity', '-1', 'not-a-delay', '999999999999999999999999999999999'])('does not display invalid Retry-After %s as a finite delay', async (retryAfter) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: '요청 한도입니다.' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': retryAfter } })));
    await expect(ResponseWorkflowService.create(sample, new AbortController().signal)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterSeconds: undefined, message: expect.stringContaining('요청 한도') });
  });


  it.each([413, 415])('keeps a raw %s pre-write rejection definite even when the proxy body is not JSON', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream diagnostic must not be displayed', { status, headers: { 'content-type': 'text/plain' } })));
    await expect(ResponseWorkflowService.create(sample, new AbortController().signal)).rejects.toMatchObject({
      code: 'HTTP_ERROR', status, message: `검토 요청 실패 (${status})`,
    });
  });

  it.each([
    [413, '검토 요청 본문이 허용 크기를 초과했습니다.'],
    [415, 'JSON 형식의 검토 요청만 지원합니다.'],
  ] as const)('preserves a safe structured %s rejection without uncertainty or retry', async (status, message) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message } }), { status, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(ResponseWorkflowService.create(sample, new AbortController().signal)).rejects.toMatchObject({ code: 'HTTP_ERROR', status, message });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves a known Korean pre-write rejection without calling it unconfirmed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: '차단 근거 공백이 있어 완료할 수 없습니다.' } }), { status: 422, headers: { 'content-type': 'application/json' } })));
    await expect(ResponseWorkflowService.review(id, { expectedRevision: 2, command: { kind: 'complete', note: '합성 검토', acknowledgements: [] } }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'HTTP_ERROR', status: 422, message: '차단 근거 공백이 있어 완료할 수 없습니다.' });
  });

  it('gives connection-neutral recovery for read and export failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(ResponseWorkflowService.read(id, new AbortController().signal)).rejects.toMatchObject({ code: 'HTTP_ERROR', message: expect.stringContaining('연결') });
    fetchMock.mockResolvedValueOnce(new Response('<html>unavailable</html>', { headers: { 'content-type': 'text/html' } }));
    await expect(ResponseWorkflowService.export(id, 'markdown', new AbortController().signal)).rejects.toMatchObject({ message: expect.not.stringContaining('로컬 API') });
  });
});
