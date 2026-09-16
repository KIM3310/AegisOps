// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { D1Database } from '@cloudflare/workers-types';
import { serveResponseWorkspace, type EdgeBindings } from '../edge/responseWorkspace';

const origin = 'https://response.test';
const token = 'synthetic-only-operator-token-0123456789abcdef';
const secret = 'synthetic-only-session-secret-abcdef0123456789';
const cookieName = '__Host-aegisops_review_session';
const database = { prepare() { return { bind() { return { async run() { return { success: true, meta: { changes: 1 } }; }, async first() { return null; } }; } }; } } as unknown as D1Database;
const bindings: EdgeBindings = { RESPONSE_DB: database, AEGISOPS_OPERATOR_TOKEN: token, AEGISOPS_OPERATOR_SESSION_SECRET: secret };
const login = { authMode: 'token', credential: token, roles: [] };
function call(path: string, options: RequestInit = {}, env = bindings) { return serveResponseWorkspace(new Request(origin + path, options), env); }
function post(body: unknown = login, headers: Record<string, string> = {}) {
  return { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}
async function sessionCookie() {
  const response = await call('/api/auth/session', post());
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}
function signed(claims: object) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const key = createHmac('sha256', secret).update('aegisops.cloud.response.session.v1\0').update(token).digest();
  return cookieName + '=' + encoded + '.' + createHmac('sha256', key).update(encoded).digest('base64url');
}

describe('cloud web boundary', () => {
  it('distinguishes synthetic analysis from configured cloud review without leaking configuration', async () => {
    const response = await call('/api/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deployment: 'static-demo', provider: 'demo', keyConfigured: false,
      responseWorkflow: { kind: 'cloud-response', storage: 'd1', authMode: 'token', scope: 'shared-synthetic', configured: true } });
    const unavailable = await call('/api/healthz', {}, {});
    expect(await unavailable.json()).toMatchObject({ responseWorkflow: { kind: 'unavailable', reason: 'configuration' } });
    const denied = await call('/api/auth/session', post(), {});
    expect(denied.status).toBe(503);
    expect(await denied.text()).not.toContain(token);
  });
  it.each([
    { RESPONSE_DB: undefined }, { AEGISOPS_OPERATOR_TOKEN: undefined }, { AEGISOPS_OPERATOR_SESSION_SECRET: undefined },
    { AEGISOPS_OPERATOR_TOKEN: 'x'.repeat(31) }, { AEGISOPS_OPERATOR_SESSION_SECRET: 'x'.repeat(31) },
    { AEGISOPS_OPERATOR_SESSION_SECRET: token }, { AEGISOPS_OPERATOR_TOKEN: 'x'.repeat(1025) },
  ])('fails closed for missing or invalid independent configuration %j', async (override) => {
    const env = { ...bindings, ...override };
    const health = await call('/api/healthz', {}, env);
    expect(await health.json()).toMatchObject({ responseWorkflow: { kind: 'unavailable', reason: 'configuration' } });
    expect((await call('/api/auth/session', post(), env)).status).toBe(503);
    expect((await call('/api/response-workflows/06cbd1a9-2df5-440a-982b-09105aee3a91', {}, env)).status).toBe(503);
  });
  it('returns JSON 404 and method 405 with dynamic security headers', async () => {
    for (const path of ['/api', '/api/analyze', '/api/unknown']) {
      const response = await call(path);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect((await response.json() as { error: { message: string } }).error.message).toBeTruthy();
    }
    const wrong = await call('/api/response-workflows', { method: 'PUT' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');
  });
  it('issues a strict token-free audience-bound one-hour cookie and clears it with identical flags', async () => {
    const response = await call('/api/auth/session', post());
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain(cookieName + '=');
    for (const flag of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=3600']) expect(cookie).toContain(flag);
    expect(cookie).not.toContain('Domain=');
    const payload = JSON.parse(Buffer.from(cookie.split('=')[1]!.split('.')[0]!, 'base64url').toString());
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'kind', 'nonce', 'v']);
    expect(payload).toMatchObject({ v: 1, kind: 'shared-token', aud: origin });
    expect(payload.exp - payload.iat).toBe(3600);
    expect(JSON.stringify(payload)).not.toContain(token);
    const active = await call('/api/auth/session', { headers: { cookie: cookie.split(';')[0]! } });
    expect(await active.json()).toMatchObject({ active: true, authMode: 'token', actor: 'shared-token' });
    const logout = await call('/api/auth/session', { method: 'DELETE', headers: { origin, cookie } });
    expect(await logout.json()).toEqual({ active: false });
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(logout.headers.get('set-cookie')).toContain('Secure; SameSite=Strict');
  });
  it('rejects missing, foreign, null, and cross-site Origin on login and logout, including cookie-free calls', async () => {
    for (const headers of [{}, { origin: 'null' }, { origin: 'https://other.test' }, { origin, 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) {
      for (const method of ['POST', 'DELETE']) {
        const result = await call('/api/auth/session', { method, headers: { 'content-type': 'application/json', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(login) } : {}) });
        expect(result.status).toBe(403);
      }
    }
    const insecure = await serveResponseWorkspace(new Request('http://response.test/api/auth/session', post()), bindings);
    expect(insecure.status).toBe(403);
  });
  it('rejects token headers, bad credentials, OIDC, unknown claims and malformed session cookies', async () => {
    expect((await call('/api/auth/session', post({ ...login, credential: 'wrong' }))).status).toBe(403);
    expect((await call('/api/auth/session', post({ ...login, authMode: 'oidc' }))).status).toBe(400);
    expect((await call('/api/response-workflows', post({}, { 'x-operator-token': token }))).status).toBe(403);
    const valid = await sessionCookie();
    const now = Math.floor(Date.now() / 1000);
    const claims = { v: 1, kind: 'shared-token', aud: origin, iat: now, exp: now + 3600, nonce: '06cbd1a9-2df5-440a-982b-09105aee3a91' };
    const bad = [valid + 'x', valid + '; ' + valid, cookieName + '=bad', 'x'.repeat(8193),
      signed({ ...claims, exp: now - 1, iat: now - 3601 }), signed({ ...claims, exp: now + 7200 }),
      signed({ ...claims, iat: now + 61, exp: now + 3661 }), signed({ ...claims, aud: 'https://other.test' }),
      signed({ ...claims, nonce: 'not-uuid' }), signed({ ...claims, credential: token })];
    for (const cookie of bad) {
      expect(await (await call('/api/auth/session', { headers: { cookie } })).json()).toEqual({ active: false });
      expect((await call('/api/response-workflows/06cbd1a9-2df5-440a-982b-09105aee3a91', { headers: { cookie } })).status).toBe(403);
    }
    const rotated = { ...bindings, AEGISOPS_OPERATOR_TOKEN: token + '-rotated' };
    expect(await (await call('/api/auth/session', { headers: { cookie: valid } }, rotated)).json()).toEqual({ active: false });
    const secretRotated = { ...bindings, AEGISOPS_OPERATOR_SESSION_SECRET: secret + '-rotated' };
    expect(await (await call('/api/auth/session', { headers: { cookie: valid } }, secretRotated)).json()).toEqual({ active: false });
  });
  it('enforces both declared and streamed 256 KiB bounds before JSON parsing and cancels oversized streams', async () => {
    const cookie = await sessionCookie();
    const headers = { origin, cookie, 'content-type': 'application/json' };
    const large = await call('/api/response-workflows', { method: 'POST', headers: { ...headers, 'content-length': '262145' }, body: '{}' });
    expect(large.status).toBe(413);
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } });
    const streamed = await call('/api/response-workflows', { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(cancelled).toBe(true);
    expect((await call('/api/response-workflows', { method: 'POST', headers, body: ' '.repeat(262144) })).status).toBe(400);
    expect((await call('/api/response-workflows', { method: 'POST', headers: { ...headers, 'content-encoding': 'gzip' }, body: '{}' })).status).toBe(415);
    expect((await call('/api/response-workflows', { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
  });
  it('authenticates reads and all export formats and rejects duplicate or unknown query parameters', async () => {
    const path = '/api/response-workflows/06cbd1a9-2df5-440a-982b-09105aee3a91';
    for (const suffix of ['', '/export?format=markdown', '/export?format=json', '/export?format=hancom-json']) expect((await call(path + suffix)).status).toBe(403);
    const cookie = await sessionCookie();
    for (const query of ['format=json&format=markdown', 'format=hwp', 'replace=forged']) expect((await call(path + '/export?' + query, { headers: { cookie } })).status).toBe(400);
    expect((await call(path, { headers: { cookie } })).status).toBe(404);
  });
});
