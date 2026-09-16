import { z } from 'zod';
import { CaseIdSchema, CaseSubmissionSchema, ResponseCaseSchema, type CaseSubmission, type ResponseCase, type ReviewRequest } from '../shared/responseCase';

export type ResponseExportFormat = 'markdown' | 'json' | 'hancom-json';
const CloudSessionSchema = z.discriminatedUnion('active', [
  z.strictObject({ active: z.literal(false) }),
  z.strictObject({ active: z.literal(true), authMode: z.literal('token'), actor: z.literal('shared-token'), expiresAt: z.iso.datetime() }),
]);
export type CloudSession = z.infer<typeof CloudSessionSchema>;
export type ResponseWorkflowErrorCode = 'HTTP_ERROR' | 'UNCONFIRMED' | 'CAPACITY' | 'RATE_LIMITED';
export class ResponseWorkflowHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: ResponseWorkflowErrorCode = 'HTTP_ERROR',
    public readonly retryAfterSeconds?: number,
  ) { super(message); }
}

type Mutation = 'create' | 'review';
const REQUEST_TIMEOUT_MS = 30_000;

function unconfirmed(mutation: Mutation, status = 0): ResponseWorkflowHttpError {
  const createNotice = mutation === 'create'
    ? ' 새 초안의 ID를 받지 못했을 수 있습니다. ID가 없으면 다시 열 수 없습니다. 이전 검토를 열어도 새 초안의 저장 결과는 확인되지 않습니다.' : '';
  return new ResponseWorkflowHttpError(status,
    `저장 결과를 확인할 수 없습니다. 표시된 검토는 마지막으로 확인한 상태입니다. 서버 상태를 새로고침하거나 검토 ID로 다시 열어 확인하세요.${createNotice} 요청을 자동으로 반복하지 마세요.`, 'UNCONFIRMED');
}

function responseError(response: Response, message: string | undefined, mutation?: Mutation): ResponseWorkflowHttpError {
  const { status } = response;
  if (mutation && (status >= 500 || status === 408)) return unconfirmed(mutation, status);
  const safeMessage = message || `검토 요청 실패 (${status})`;
  if (status === 429) {
    const rawDelay = response.headers.get('retry-after') ?? '';
    const seconds = /^\d+$/.test(rawDelay) ? Number(rawDelay) : NaN;
    const delay = Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
    return new ResponseWorkflowHttpError(status,
      delay === undefined ? safeMessage : `${safeMessage} ${delay}초 후 직접 다시 시도하세요. 자동으로 재시도하지 않습니다.`, 'RATE_LIMITED', delay);
  }
  return new ResponseWorkflowHttpError(status, safeMessage, mutation === 'create' && status === 409 ? 'CAPACITY' : 'HTTP_ERROR');
}

async function request<T>(url: string, options: RequestInit, consume: (response: Response) => Promise<T>, mutation?: Mutation): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const interrupted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new DOMException('Request interrupted', 'AbortError')), { once: true });
  });
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  let received: Response | undefined;
  try {
    return await Promise.race([(async () => {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      received = response;
      if (!response.ok) {
        if (mutation && (response.status >= 500 || response.status === 408)) throw unconfirmed(mutation, response.status);
        const body = await response.json().catch(() => null);
        const parsed = z.object({ error: z.object({ message: z.string().max(4000) }) }).safeParse(body);
        throw responseError(response, parsed.success ? parsed.data.error.message : undefined, mutation);
      }
      return consume(response);
    })(), interrupted]);
  } catch (error) {
    if (error instanceof ResponseWorkflowHttpError) throw error;
    if (received && !received.ok) throw responseError(received, undefined, mutation);
    if (mutation) throw unconfirmed(mutation, received?.status);
    if (options.signal?.aborted) throw error;
    throw new ResponseWorkflowHttpError(0, '검토 API 응답을 확인할 수 없습니다. 연결과 서비스 상태를 확인한 뒤 직접 다시 시도하세요.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

function caseRequest(url: string, options: RequestInit, mutation?: Mutation, expectedId?: string): Promise<ResponseCase> {
  return request(url, options, async (response) => {
    const parsed = ResponseCaseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || (expectedId !== undefined && parsed.data.id !== expectedId)) {
      if (mutation) throw unconfirmed(mutation, response.status);
      throw new ResponseWorkflowHttpError(0, '검토 서버 응답의 형식 또는 ID를 검증할 수 없습니다. 연결과 서비스 버전을 확인하세요.');
    }
    return parsed.data;
  }, mutation);
}

export const ResponseWorkflowService = {
  async session(signal: AbortSignal): Promise<CloudSession> {
    return request('/api/auth/session', { signal }, async (response) => {
      const result = CloudSessionSchema.safeParse(await response.json().catch(() => null));
      if (!result.success) throw new ResponseWorkflowHttpError(0, '검토 세션 응답을 확인할 수 없습니다. 세션 확인을 다시 시도하세요.');
      return result.data;
    });
  },
  async logout(signal: AbortSignal): Promise<void> {
    return request('/api/auth/session', { method: 'DELETE', signal }, async (response) => {
      const result = CloudSessionSchema.safeParse(await response.json().catch(() => null));
      if (!result.success || result.data.active) throw new ResponseWorkflowHttpError(0, '로그아웃 결과를 확인할 수 없습니다. 세션을 다시 확인하세요.');
    });
  },
  async create(submission: CaseSubmission, signal: AbortSignal): Promise<ResponseCase> {
    if (!CaseSubmissionSchema.safeParse(submission).success) {
      throw new ResponseWorkflowHttpError(400, '대응 검토는 분석 설정과 별도로 로그 50,000자·1,000줄 등 제출 스냅샷 한도를 적용합니다. 원문을 자동으로 자르지 않았습니다. 입력 범위와 형식을 확인하고 다시 분석한 뒤 검토하세요.');
    }
    return caseRequest('/api/response-workflows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submission), signal }, 'create');
  },
  async read(id: string, signal: AbortSignal): Promise<ResponseCase> {
    return caseRequest(`/api/response-workflows/${CaseIdSchema.parse(id)}`, { signal }, undefined, id);
  },
  async review(id: string, request: ReviewRequest, signal: AbortSignal): Promise<ResponseCase> {
    return caseRequest(`/api/response-workflows/${CaseIdSchema.parse(id)}/review`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal,
    }, 'review', id);
  },
  async export(id: string, format: ResponseExportFormat, signal: AbortSignal): Promise<Blob> {
    return request(`/api/response-workflows/${CaseIdSchema.parse(id)}/export?format=${format}`, { signal }, async (response) => {
      const expectedType = format === 'markdown' ? 'text/markdown' : 'application/json';
      if (!response.headers.get('content-type')?.includes(expectedType)) {
        throw new ResponseWorkflowHttpError(0, '내보내기 API가 문서를 반환하지 않았습니다. 연결과 서비스 상태를 확인하세요.');
      }
      return response.blob();
    });
  },
  async login(authMode: 'token' | 'oidc', credential: string, roles: string[], signal: AbortSignal): Promise<void> {
    try {
      await request('/api/auth/session', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ authMode, credential, roles }), signal }, async (response) => {
        const result = z.object({ active: z.literal(true) }).safeParse(await response.json().catch(() => null));
        if (!result.success) throw new ResponseWorkflowHttpError(403, '로그인이 확인되지 않았습니다. 세션을 다시 확인하세요.');
      });
    } finally { credential = ''; }
  },
};
