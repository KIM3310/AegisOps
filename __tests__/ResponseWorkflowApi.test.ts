// @vitest-environment node
import express from 'express';
import request from 'supertest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponseWorkflowStore } from '../server/lib/responseWorkflowStore';
import { createResponseWorkflowsRouter } from '../server/routes/responseWorkflows';

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
vi.mock('../server/lib/gemini', () => ({ geminiAnalyzeIncident: vi.fn(), geminiFollowUp: vi.fn(), geminiTts: vi.fn() }));
vi.mock('../server/lib/openai', () => ({ openaiAnalyzeIncident: vi.fn(), openaiFollowUp: vi.fn() }));
vi.mock('../server/lib/ollama', () => ({ ollamaAnalyzeIncident: vi.fn(), ollamaFollowUp: vi.fn() }));

const submission = { schemaVersion: 1, clientIncidentId: 'http-incident',
  report: { title: '합성 사례', summary: '지연 관측', severity: 'SEV2', rootCauses: [], timeline: [], actionItems: [], mitigationSteps: [], tags: [] },
  evidence: { logs: 'p95_latency=2400ms queue_depth=180', declaredImageCount: 0 } };
const base = '/api/response-workflows';
const token = 'synthetic-workflow-test-only';
const headers = { 'x-operator-token': token };
const completion = { kind: 'complete', note: '담당자에게 관측 구간 확인을 인계합니다.',
  acknowledgements: [{ checkId: 'check-latency-queue', acknowledged: true }] };

describe('ResponseCase real HTTP and atomic store', () => {
  let app: express.Express;
  let directory: string;
  let store: ResponseWorkflowStore;
  const blockedFetch = vi.fn().mockRejectedValue(new Error('outbound network forbidden'));

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(tmpdir(), 'aegisops-response-test-'));
    for (const name of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'AEGISOPS_OPERATOR_OIDC_ISSUER',
      'AEGISOPS_OPERATOR_OIDC_AUDIENCE', 'AEGISOPS_OPERATOR_ALLOWED_ROLES', 'GCP_PROJECT_ID', 'DD_API_KEY']) vi.stubEnv(name, '');
    vi.stubEnv('LLM_PROVIDER', 'demo');
    vi.stubEnv('GCP_ENABLED', 'false');
    vi.stubEnv('AWS_ENABLED', 'false');
    vi.stubEnv('DATADOG_ENABLED', 'false');
    vi.stubEnv('AEGISOPS_OPERATOR_TOKEN', token);
    vi.stubEnv('AEGISOPS_OPERATOR_SESSION_SECRET', 'synthetic-session-test-only');
    vi.stubEnv('AEGISOPS_RESPONSE_STORE_PATH', path.join(directory, 'cases'));
    vi.stubEnv('AEGISOPS_SESSION_STORE_PATH', path.join(directory, 'legacy.jsonl'));
    vi.stubEnv('AEGISOPS_RUNTIME_STORE_PATH', path.join(directory, 'runtime.jsonl'));
    vi.stubGlobal('fetch', blockedFetch);
    app = (await import('../server/index')).app;
    store = new ResponseWorkflowStore(path.join(directory, 'cases'));
  });
  beforeEach(() => {
    vi.stubEnv('AEGISOPS_OPERATOR_TOKEN', token);
    vi.stubEnv('AEGISOPS_OPERATOR_OIDC_ISSUER', '');
    vi.stubEnv('AEGISOPS_OPERATOR_OIDC_AUDIENCE', '');
  });
  afterAll(async () => {
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function create() {
    const result = await request(app).post(base).set(headers).send(submission);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ revision: 1, state: { kind: 'draft' }, createdBy: { kind: 'shared-token' } });
    return result.body.id as string;
  }

  it('creates, reads, begins, acknowledges, completes and exports the persisted case', async () => {
    const id = await create();
    const read = await request(app).get(`${base}/${id}`).set(headers);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(read.body.content.evidence.spans[0].quote).toBe('p95_latency=2400ms queue_depth=180');
    const begin = await request(app).post(`${base}/${id}/review`).set(headers).send({ expectedRevision: 1, command: { kind: 'begin' } });
    expect(begin.status).toBe(200);
    expect(begin.body.state).toEqual({ kind: 'in-review' });
    const complete = await request(app).post(`${base}/${id}/review`).set(headers).send({ expectedRevision: 2, command: completion });
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({ revision: 3, state: { kind: 'reviewed', actor: { kind: 'shared-token' } } });
    const reopened = await new ResponseWorkflowStore(store.directory).read(id);
    expect(reopened.state.kind).toBe('reviewed');
    expect(reopened.reviewEvents).toHaveLength(2);
    const markdown = await request(app).get(`${base}/${id}/export?format=markdown`).set(headers);
    expect(markdown.status).toBe(200);
    expect(markdown.text).toContain('상태: **검토 완료**');
    expect(markdown.text).toContain('자동 조치 없음');
    expect(markdown.headers['content-disposition']).toContain('.md');
    const json = await request(app).get(`${base}/${id}/export?format=json`).set(headers);
    expect(json.body.responseCase.id).toBe(id);
    const hancom = await request(app).get(`${base}/${id}/export?format=hancom-json`).set(headers);
    expect(hancom.body.templateValidated).toBe(false);
    expect(hancom.body.template_placeholders['{{REVIEW_STATUS}}']).toBe('검토 완료 (실행 승인 아님)');
    expect(hancom.body.template_placeholders['{{SEVERITY}}']).toBe('SEV2');
    expect(hancom.body.template_placeholders['{{REVIEW_NOTE}}']).toBe('담당자에게 관측 구간 확인을 인계합니다.');
    expect(hancom.body.template_placeholders['{{REVIEWER}}']).toBe('shared-token (공유 자격 증명)');
    expect(hancom.body.template_placeholders['{{CHECKS}}']).toContain('명시적 검토 완료 (작업 실행 아님)');
    expect(hancom.body.template_placeholders['{{BLOCKING_GAPS}}']).toBe('차단 공백 없음. 실제 관측 결과와 장애 해결은 별도 확인 필요.');
    expect(markdown.text).toContain('심각도: SEV2');
    expect(blockedFetch).not.toHaveBeenCalled();
    const providers = await import('../server/lib/gemini');
    expect(providers.geminiAnalyzeIncident).not.toHaveBeenCalled();
    expect((await import('../server/lib/openai')).openaiAnalyzeIncident).not.toHaveBeenCalled();
    expect((await import('../server/lib/ollama')).ollamaAnalyzeIncident).not.toHaveBeenCalled();
    if (process.platform !== 'win32') {
      expect((await fs.stat(path.join(store.directory, `${id}.json`))).mode & 0o777).toBe(0o600);
      expect((await fs.stat(store.directory)).mode & 0o777).toBe(0o700);
    }
  });

  it('denies anonymous and invalid-token reads and all export formats', async () => {
    const id = await create();
    for (const suffix of ['', '/export?format=markdown', '/export?format=json', '/export?format=hancom-json']) {
      for (const deniedHeaders of [{}, { 'x-operator-token': 'invalid' }]) {
        const result = await request(app).get(`${base}/${id}${suffix}`).set(deniedHeaders);
        expect(result.status).toBe(403);
        expect(result.text).not.toContain('지연 관측');
      }
    }
  });

  it('serializes concurrent commands and returns 409 for stale or repeated transitions', async () => {
    const id = await create();
    const command = { expectedRevision: 1, command: { kind: 'begin' } };
    const responses = await Promise.all([1, 2].map(() => request(app).post(`${base}/${id}/review`).set(headers).send(command)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await store.read(id)).reviewEvents).toHaveLength(1);
    const repeated = await request(app).post(`${base}/${id}/review`).set(headers).send({ ...command, expectedRevision: 2 });
    expect(repeated.status).toBe(409);
    const changes = await request(app).post(`${base}/${id}/review`).set(headers).send({ expectedRevision: 2, command: { kind: 'request-changes', note: '근거 담당자 보완' } });
    expect(changes.body.state.kind).toBe('changes-requested');
    const terminal = await request(app).post(`${base}/${id}/review`).set(headers).send({ ...command, expectedRevision: 3 });
    expect(terminal.status).toBe(409);
  });

  it('uses a validated session actor and rejects missing or cross-origin cookie mutation', async () => {
    const login = await request(app).post('/api/auth/session').send({ authMode: 'token', credential: token });
    expect(login.status).toBe(200);
    const rawCookie = login.headers['set-cookie'];
    const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)?.split(';')[0] || '';
    const missing = await request(app).post(base).set('cookie', cookie).send(submission);
    expect(missing.status).toBe(403);
    const cross = await request(app).post(base).set('cookie', cookie).set('origin', 'https://other.invalid').send(submission);
    expect(cross.status).toBe(403);
    const same = await request(app).post(base).set('cookie', cookie).set('Host', '127.0.0.1').set('Origin', 'http://127.0.0.1').send(submission);
    expect(same.status).toBe(201);
    expect(same.body.createdBy).toEqual({ kind: 'shared-token' });
    const read = await request(app).get(`${base}/${same.body.id}`).set('cookie', cookie);
    expect(read.status).toBe(200);
  });

  it('records the verified OIDC identity, not a caller display name', async () => {
    const existingId = await create();
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    vi.stubEnv('AEGISOPS_OPERATOR_TOKEN', '');
    vi.stubEnv('AEGISOPS_OPERATOR_OIDC_ISSUER', 'https://identity.invalid');
    vi.stubEnv('AEGISOPS_OPERATOR_OIDC_AUDIENCE', 'test-response');
    vi.stubEnv('AEGISOPS_OPERATOR_OIDC_JWKS_JSON', JSON.stringify({ keys: [{ ...jwk, kid: 'synthetic-key', alg: 'RS256' }] }));
    const encoded = [ { alg: 'RS256', kid: 'synthetic-key' }, { iss: 'https://identity.invalid', aud: 'test-response', sub: 'verified-test-subject', exp: Math.floor(Date.now() / 1000) + 120 } ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
    const jwt = `${encoded}.${sign('RSA-SHA256', Buffer.from(encoded), privateKey).toString('base64url')}`;
    const result = await request(app).post(base).set('authorization', `Bearer ${jwt}`).set('x-operator-name', 'forged-name').send(submission);
    expect(result.status).toBe(201);
    expect(result.body.createdBy).toEqual({ kind: 'oidc', subject: 'verified-test-subject' });
    const longEncoded = [{ alg: 'RS256', kid: 'synthetic-key' }, { iss: 'https://identity.invalid', aud: 'test-response', sub: 'x'.repeat(1001), exp: Math.floor(Date.now() / 1000) + 120 }]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
    const longJwt = `${longEncoded}.${sign('RSA-SHA256', Buffer.from(longEncoded), privateKey).toString('base64url')}`;
    const invalidActor = await request(app).post(`${base}/${existingId}/review`).set('authorization', `Bearer ${longJwt}`).send({ expectedRevision: 1, command: { kind: 'begin' } });
    expect(invalidActor.status).toBe(500);
    expect(await store.read(existingId)).toMatchObject({ revision: 1, state: { kind: 'draft' }, reviewEvents: [] });
  });

  it('permits local keyless demo but rejects a remote host and cross-site request', async () => {
    vi.stubEnv('AEGISOPS_OPERATOR_TOKEN', '');
    const local = await request(app).post(base).send(submission);
    expect(local.status).toBe(201);
    expect(local.body.createdBy).toEqual({ kind: 'local-demo' });
    expect((await request(app).post(base).set('Host', 'remote.invalid').send(submission)).status).toBe(403);
    expect((await request(app).post(base).set('Sec-Fetch-Site', 'cross-site').send(submission)).status).toBe(403);
  });

  it.each([base, '/API/RESPONSE-WORKFLOWS/'])('bounds the raw chunked request at the first full-app parser for %s', async (route) => {
    await fs.mkdir(store.directory, { recursive: true });
    const before = await fs.readdir(store.directory);
    const server = createServer(app);
    let receivedHeaders: IncomingHttpHeaders = {};
    server.on('request', (incoming) => { receivedHeaders = incoming.headers; });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP listener address unavailable');
    try {
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const outgoing = httpRequest({ host: '127.0.0.1', port: address.port, method: 'POST', path: route,
          headers: { ...headers, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (incoming) => {
          let body = '';
          incoming.setEncoding('utf8');
          incoming.on('data', (chunk: string) => { body += chunk; });
          incoming.on('error', reject);
          incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body }));
        });
        outgoing.on('error', reject);
        outgoing.write(' '.repeat(256 * 1024 + 1));
        outgoing.end(JSON.stringify(submission));
      });
      expect(receivedHeaders['content-length']).toBeUndefined();
      expect(receivedHeaders['transfer-encoding']).toBe('chunked');
      expect(response.status).toBe(413);
      expect(JSON.parse(response.body).error.message).toBe('Payload too large.');
      expect(await fs.readdir(store.directory)).toEqual(before);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rejects malformed IDs, forged fields, unknown versions, oversized bodies and unknown export formats', async () => {
    expect((await request(app).get(`${base}/not-a-uuid`).set(headers)).status).toBe(400);
    expect((await request(app).post(base).set(headers).send({ ...submission, state: { kind: 'reviewed' } })).status).toBe(400);
    expect((await request(app).post(base).set(headers).send({ ...submission, schemaVersion: 2 })).status).toBe(400);
    expect((await request(app).post(base).set(headers).send({ ...submission, extra: 'x'.repeat(270000) })).status).toBe(413);
    const id = await create();
    expect((await request(app).get(`${base}/${id}/export?format=hwp`).set(headers)).status).toBe(400);
    expect((await request(app).post(`${base}/${id}/review`).set(headers).send({ expectedRevision: 1, command: { kind: 'begin', actor: 'forged' } })).status).toBe(400);
  });

  it.each(['json', 'version', 'digest', 'source'])('fails closed for corrupt persisted %s on reads, review and export', async (kind) => {
    const id = await create();
    const filename = path.join(store.directory, `${id}.json`);
    const current = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (kind === 'version') current.schemaVersion = 999;
    if (kind === 'digest') current.contentDigest = '0'.repeat(64);
    if (kind === 'source') current.content.sources[0].quote = 'forged official source';
    await fs.writeFile(filename, kind === 'json' ? 'corrupt' : JSON.stringify(current));
    expect((await request(app).get(`${base}/${id}`).set(headers)).status).toBe(500);
    expect((await request(app).get(`${base}/${id}/export?format=markdown`).set(headers)).status).toBe(500);
    expect((await request(app).post(`${base}/${id}/review`).set(headers).send({ expectedRevision: 1, command: { kind: 'begin' } })).status).toBe(500);
  });

  it('preserves the previous revision when an atomic rename fails', async () => {
    const current = await store.create(submission, { kind: 'local-demo' });
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('synthetic disk failure'));
    try {
      await expect(store.review(current.id, { expectedRevision: 1, command: { kind: 'begin' } }, { kind: 'local-demo' })).rejects.toThrow('synthetic disk failure');
      expect(await store.read(current.id)).toEqual(current);
      expect((await fs.readdir(store.directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally { rename.mockRestore(); }
  });

  it('rejects a clock rollback before writing and preserves the original record', async () => {
    const current = await store.create(submission, { kind: 'local-demo' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
    try {
      await expect(store.review(current.id, { expectedRevision: 1, command: { kind: 'begin' } }, { kind: 'local-demo' })).rejects.toThrow();
      expect(await store.read(current.id)).toEqual(current);
    } finally { vi.useRealTimers(); }
  });

  it('returns failure when storage cannot be created, without pretending the case was saved', async () => {
    const occupied = path.join(directory, 'not-a-directory');
    await fs.writeFile(occupied, 'occupied');
    const failingApp = express().use(base, createResponseWorkflowsRouter(new ResponseWorkflowStore(occupied)));
    const result = await request(failingApp).post(base).set(headers).send(submission);
    expect(result.status).toBe(500);
    expect(result.body.error.message).toContain('성공한 검토로 처리하지 않았습니다');
    expect(await fs.readFile(occupied, 'utf8')).toBe('occupied');
  });
});
