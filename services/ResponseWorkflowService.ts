import { z } from 'zod';
import { CaseIdSchema, CaseSubmissionSchema, ResponseCaseSchema, type CaseSubmission, type ResponseCase, type ReviewRequest } from '../shared/responseCase';

export type ResponseExportFormat = 'markdown' | 'json' | 'hancom-json';
export class ResponseWorkflowHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

async function checkedFetch(url: string, options: RequestInit): Promise<Response> {
  let response: Response;
  try { response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options }); }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ResponseWorkflowHttpError(0, '검토 API에 연결할 수 없습니다. 로컬 API를 실행하세요. 오프라인 검토 완료는 지원하지 않습니다.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    throw new ResponseWorkflowHttpError(response.status, parsed.success ? parsed.data.error.message : `검토 요청 실패 (${response.status})`);
  }
  return response;
}

async function caseRequest(url: string, options: RequestInit): Promise<ResponseCase> {
  const response = await checkedFetch(url, options);
  try { return ResponseCaseSchema.parse(await response.json()); }
  catch { throw new ResponseWorkflowHttpError(0, '검토 서버 응답을 검증할 수 없습니다. 로컬 API와 버전을 확인하세요.'); }
}

export const ResponseWorkflowService = {
  async create(submission: CaseSubmission, signal: AbortSignal): Promise<ResponseCase> {
    if (!CaseSubmissionSchema.safeParse(submission).success) {
      throw new ResponseWorkflowHttpError(400, '대응 검토는 분석 설정과 별도로 로그 50,000자·1,000줄 등 제출 스냅샷 한도를 적용합니다. 원문을 자동으로 자르지 않았습니다. 입력 범위와 형식을 확인하고 다시 분석한 뒤 검토하세요.');
    }
    return caseRequest('/api/response-workflows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submission), signal });
  },
  async read(id: string, signal: AbortSignal): Promise<ResponseCase> {
    const result = await caseRequest(`/api/response-workflows/${CaseIdSchema.parse(id)}`, { signal });
    if (result.id !== id) throw new ResponseWorkflowHttpError(0, '요청한 검토 ID와 응답이 다릅니다.');
    return result;
  },
  async review(id: string, request: ReviewRequest, signal: AbortSignal): Promise<ResponseCase> {
    const result = await caseRequest(`/api/response-workflows/${CaseIdSchema.parse(id)}/review`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal,
    });
    if (result.id !== id) throw new ResponseWorkflowHttpError(0, '요청한 검토 ID와 응답이 다릅니다.');
    return result;
  },
  async export(id: string, format: ResponseExportFormat, signal: AbortSignal): Promise<Blob> {
    const response = await checkedFetch(`/api/response-workflows/${CaseIdSchema.parse(id)}/export?format=${format}`, { signal });
    const expectedType = format === 'markdown' ? 'text/markdown' : 'application/json';
    if (!response.headers.get('content-type')?.includes(expectedType)) {
      throw new ResponseWorkflowHttpError(0, '내보내기 API가 문서를 반환하지 않았습니다. 로컬 API 연결을 확인하세요.');
    }
    return response.blob();
  },
  async login(authMode: 'token' | 'oidc', credential: string, roles: string[], signal: AbortSignal): Promise<void> {
    const response = await checkedFetch('/api/auth/session', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ authMode, credential, roles }), signal });
    const result = z.object({ active: z.literal(true) }).safeParse(await response.json());
    if (!result.success) throw new ResponseWorkflowHttpError(403, '로그인이 확인되지 않았습니다.');
  },
};
