import type { D1Database } from '@cloudflare/workers-types';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CaseIdSchema } from '../shared/responseCase';
import { ResponseWorkflowError } from '../server/lib/responseWorkflow';
import { D1ResponseAuthority, WorkspaceError } from './responseAuthority';

export interface EdgeBindings {
  RESPONSE_DB?: D1Database;
  AEGISOPS_OPERATOR_TOKEN?: string;
  AEGISOPS_OPERATOR_SESSION_SECRET?: string;
}
type Configuration = { database: D1Database; token: string; secret: string };
const COOKIE_NAME = '__Host-aegisops_review_session';
const MAX_BODY_BYTES = 256 * 1024;
const claimsSchema = z.strictObject({
  v: z.literal(1), kind: z.literal('shared-token'), aud: z.string().max(512),
  iat: z.number().int().nonnegative().safe(), exp: z.number().int().nonnegative().safe(), nonce: z.uuid(),
});
const loginSchema = z.strictObject({
  authMode: z.enum(['token', 'oidc']), credential: z.string().min(1).max(1024),
  roles: z.array(z.string().max(64)).max(16).default([]),
});
const formats = z.enum(['markdown', 'json', 'hancom-json']);
type Claims = z.infer<typeof claimsSchema>;

function configuration(env: EdgeBindings): Configuration | null {
  const token = env.AEGISOPS_OPERATOR_TOKEN;
  const secret = env.AEGISOPS_OPERATOR_SESSION_SECRET;
  if (!env.RESPONSE_DB || typeof env.RESPONSE_DB.prepare !== 'function' || typeof token !== 'string' || typeof secret !== 'string'
    || Buffer.byteLength(token) < 32 || token.length > 1024 || Buffer.byteLength(secret) < 32 || secret.length > 1024 || token === secret) return null;
  return { database: env.RESPONSE_DB, token, secret };
}

function reply(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function sameOrigin(request: Request): void {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new WorkspaceError(403, 'HTTPS 동일 출처에서만 검토와 세션을 변경할 수 있습니다.');
  }
}

async function bodyJson(request: Request): Promise<unknown> {
  if (request.headers.has('content-encoding') && request.headers.get('content-encoding')?.toLowerCase() !== 'identity') {
    throw new WorkspaceError(415, '압축된 검토 요청은 지원하지 않습니다.');
  }
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') ?? '')) {
    throw new WorkspaceError(415, 'JSON 형식의 요청이 필요합니다.');
  }
  const tooLarge = () => new WorkspaceError(413, '검토 요청이 256 KiB 한도를 초과합니다. 원문을 자동으로 자르지 않았습니다.');
  const length = request.headers.get('content-length');
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new WorkspaceError(400, '요청 길이가 올바르지 않습니다.');
    if (Number(length) > MAX_BODY_BYTES) throw tooLarge();
  }
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError(400, 'JSON 요청 본문이 필요합니다.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new WorkspaceError(400, 'JSON 요청 본문이 올바르지 않습니다.'); }
}

function signingKey(config: Configuration): Buffer {
  return createHmac('sha256', config.secret).update('aegisops.cloud.response.session.v1\0').update(config.token).digest();
}
function signature(payload: string, config: Configuration): Buffer {
  return createHmac('sha256', signingKey(config)).update(payload).digest();
}
function cookie(value: string, clear = false): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : 3600}${clear ? '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' : ''}`;
}
function decode64(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid encoding');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('noncanonical encoding');
  return decoded;
}
function session(request: Request, config: Configuration): Claims | null {
  if (new URL(request.url).protocol !== 'https:') return null;
  const header = request.headers.get('cookie') ?? '';
  if (Buffer.byteLength(header) > 8192) return null;
  const matches = header.split(';').map((item) => item.trim()).filter((item) => item.startsWith(COOKIE_NAME + '='));
  if (matches.length !== 1) return null;
  const value = matches[0]!.slice(COOKIE_NAME.length + 1);
  if (value.length > 2048) return null;
  try {
    const parts = value.split('.');
    if (parts.length !== 2) return null;
    const [encoded, signed] = parts as [string, string];
    const actual = decode64(signed);
    const expected = signature(encoded, config);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = claimsSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode64(encoded))));
    const now = Math.floor(Date.now() / 1000);
    if (claims.aud !== new URL(request.url).origin || claims.exp <= now || claims.iat > now + 60 || claims.exp - claims.iat !== 3600) return null;
    return claims;
  } catch { return null; }
}
function sessionView(claims: Claims | null) {
  return claims ? { active: true, authMode: 'token', actor: 'shared-token', expiresAt: new Date(claims.exp * 1000).toISOString() } : { active: false };
}

export async function serveResponseWorkspace(request: Request, env: EdgeBindings): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const health = path === '/api/healthz';
    const auth = path === '/api/auth/session';
    const create = path === '/api/response-workflows';
    const casePath = /^\/api\/response-workflows\/([^/]+)(?:\/(review|export))?$/.exec(path);
    if (!health && !auth && !create && !casePath) return reply({ error: { message: '지원하지 않는 API 경로입니다.' } }, 404);
    const methods = health ? ['GET'] : auth ? ['GET', 'POST', 'DELETE'] : create || casePath?.[2] === 'review' ? ['POST'] : ['GET'];
    if (!methods.includes(request.method)) return reply({ error: { message: '지원하지 않는 요청 메서드입니다.' } }, 405, { Allow: methods.join(', ') });
    const config = configuration(env);
    if (health) return reply({ ok: true, service: 'aegisops-response-demo', deployment: 'static-demo', mode: 'demo', provider: 'demo',
      keySource: 'none', keyConfigured: false,
      limits: { maxImages: 16, maxLogChars: 50000, maxQuestionChars: 4000, maxTtsChars: 0 },
      defaults: { grounding: false }, models: { analyze: 'Recorded demo', tts: 'Unavailable' },
      responseWorkflow: config ? { kind: 'cloud-response', storage: 'd1', authMode: 'token', scope: 'shared-synthetic', configured: true }
        : { kind: 'unavailable', reason: 'configuration' },
    });
    if (!config) throw new WorkspaceError(503, '클라우드 검토를 사용할 수 없습니다. 소유자의 구성이 필요합니다.');
    const authority = new D1ResponseAuthority(config.database);
    if (request.method !== 'GET') sameOrigin(request);
    if (auth) {
      if (request.method === 'GET') return reply(sessionView(session(request, config)));
      if (request.method === 'DELETE') return reply({ active: false }, 200, { 'set-cookie': cookie('', true) });
      await authority.consumeLoginAttempt();
      const input = loginSchema.parse(await bodyJson(request));
      if (input.authMode !== 'token') throw new WorkspaceError(400, '클라우드 데모는 공유 토큰 로그인만 지원합니다. OIDC는 지원하지 않습니다.');
      const supplied = createHash('sha256').update(input.credential).digest();
      const expected = createHash('sha256').update(config.token).digest();
      if (!timingSafeEqual(supplied, expected)) throw new WorkspaceError(403, '운영자 토큰을 확인하세요.');
      const now = Math.floor(Date.now() / 1000);
      const claims: Claims = { v: 1, kind: 'shared-token', aud: url.origin, iat: now, exp: now + 3600, nonce: randomUUID() };
      const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return reply(sessionView(claims), 200, { 'set-cookie': cookie(encoded + '.' + signature(encoded, config).toString('base64url')) });
    }
    if (!session(request, config)) throw new WorkspaceError(403, '운영자 로그인이 필요합니다. 공유 토큰으로 로그인하세요.');
    if (create) return reply(await authority.create(await bodyJson(request)), 201);
    const id = CaseIdSchema.parse(casePath![1]);
    if (casePath![2] === 'review') return reply(await authority.review(id, await bodyJson(request)));
    if (casePath![2] === 'export') {
      if ([...url.searchParams.keys()].some((key) => key !== 'format') || url.searchParams.getAll('format').length > 1) {
        throw new WorkspaceError(400, '내보내기 형식 매개변수를 확인하세요.');
      }
      const format = formats.parse(url.searchParams.get('format') ?? 'markdown');
      return reply(await authority.export(id, format), 200, {
        'content-type': format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="response-${id}-${format}.${format === 'markdown' ? 'md' : 'json'}"`,
      });
    }
    return reply(await authority.read(id));
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : error instanceof ResponseWorkflowError ? error.status : 503;
    const message = error instanceof z.ZodError ? '검토 입력 형식 또는 버전이 올바르지 않습니다.'
      : error instanceof ResponseWorkflowError ? error.message : '검토 결과를 확인할 수 없습니다. 최신 검토를 다시 열어 확인하세요. 자동으로 다시 제출하지 마세요.';
    return reply({ error: { message } }, status, error instanceof WorkspaceError && error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {});
  }
}
