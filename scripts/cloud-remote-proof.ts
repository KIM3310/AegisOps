import assert from 'node:assert/strict';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createResponseCase, renderResponseExport } from '../server/lib/responseWorkflow';
import { cloudSubmission, cloudCompletion, maximumCloudSubmission } from '../__tests__/fixtures/cloudResponse';
import type { CaseSubmission, ResponseCase } from '../shared/responseCase';

// This destructive fixture suite is deliberately restricted to this project's empty preview DB.
const project = 'aegisops-ai-incident-doctor';
const origin = `https://pr-50-proof.${project}.pages.dev`;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const database = process.env.AEGISOPS_PREVIEW_DATABASE_ID;
const token = process.env.AEGISOPS_OPERATOR_TOKEN;
const secret = process.env.AEGISOPS_OPERATOR_SESSION_SECRET;
assert(account && apiToken && database && token && secret, 'Remote proof credentials and preview database must be explicitly supplied');
const output = path.resolve(process.argv[2] || '.wrangler/remote-response-proof');
await mkdir(output, { recursive: true });
const prefix = `cloud-remote-proof-${randomUUID()}`;
const input = { ...cloudSubmission, clientIncidentId: prefix };
const base = '/api/response-workflows';
const findings: object[] = [];
const requests: object[] = [];
let cookie = '';
let owned = false;
let passed = false;
const record = (name: string, detail: object = {}) => { findings.push({ name, ...detail }); console.log('PASS ' + name); };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const literal = (value: unknown) => "'" + String(value).replaceAll("'", "''") + "'";

async function cf<T>(route: string, data?: object): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${route}`, {
    method: data ? 'POST' : 'GET', headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30000),
  });
  const body = await response.json() as { success: boolean; result: T; errors: object[] };
  assert(response.ok && body.success, `Cloudflare operation failed: ${JSON.stringify(body.errors)}`);
  return body.result;
}
type SqlResult = { results: Record<string, unknown>[]; success: boolean };
async function sql(statement: string): Promise<SqlResult[]> {
  assert(owned, 'Preview ownership checks must precede fixture writes');
  return cf<SqlResult[]>(`/d1/database/${database}/query`, { sql: statement });
}
async function count() { return Number((await sql('SELECT COUNT(*) AS n FROM response_cases'))[0]!.results[0]!.n); }
async function resetBudget() { await sql('DELETE FROM response_rate_budget'); }
type Options = { method?: string; body?: unknown; raw?: string; cookie?: string | null; origin?: string | null; headers?: Record<string, string>; chunks?: string[] };
async function http(route: string, options: Options = {}) {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers);
  if (options.cookie !== null && (options.cookie || cookie)) headers.set('cookie', options.cookie || cookie);
  if (method !== 'GET' && options.origin !== null) headers.set('origin', options.origin ?? origin);
  let body: BodyInit | undefined = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (options.chunks) body = new ReadableStream({ start(controller) {
    for (const chunk of options.chunks!) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } });
  if (body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const init: RequestInit & { duplex?: 'half' } = { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(30000) };
  if (options.chunks) init.duplex = 'half';
  const started = performance.now();
  const response = await fetch(origin + route, init);
  const text = await response.text();
  const elapsedMs = performance.now() - started;
  requests.push({ method, route, status: response.status, wallMsNotCpu: elapsedMs, ray: response.headers.get('cf-ray') });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert(!text.includes(token!) && !text.includes(secret!), 'Credentials must not appear in replies');
  return { status: response.status, headers: response.headers, text, elapsedMs };
}
async function expected(route: string, status: number, options: Options = {}) {
  const response = await http(route, options);
  assert.equal(response.status, status, `${route}: ${response.text.slice(0, 300)}`);
  return response;
}
async function create(body: CaseSubmission = input) {
  return JSON.parse((await expected(base, 201, { method: 'POST', body })).text) as ResponseCase;
}
async function read(id: string) { return JSON.parse((await expected(`${base}/${id}`, 200)).text) as ResponseCase; }
async function review(current: ResponseCase, command: unknown) {
  return JSON.parse((await expected(`${base}/${current.id}/review`, 200, {
    method: 'POST', body: { expectedRevision: current.revision, command },
  })).text) as ResponseCase;
}
function signed(claims: object) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const key = createHmac('sha256', secret!).update('aegisops.cloud.response.session.v1\0').update(token!).digest();
  return '__Host-aegisops_review_session=' + payload + '.' + createHmac('sha256', key).update(payload).digest('base64url');
}
async function stableMinute() {
  const seconds = new Date().getUTCSeconds();
  if (seconds >= 50) await new Promise((resolve) => setTimeout(resolve, (61 - seconds) * 1000));
}

try {
  type Environment = { fail_open: boolean; d1_databases: { RESPONSE_DB: { id: string } } };
  const configuration = await cf<{ deployment_configs: { preview: Environment; production: Environment } }>(`/pages/projects/${project}`);
  assert.equal(configuration.deployment_configs.preview.fail_open, false);
  assert.equal(configuration.deployment_configs.production.fail_open, false);
  assert.equal(configuration.deployment_configs.preview.d1_databases.RESPONSE_DB.id, database);
  assert.notEqual(configuration.deployment_configs.production.d1_databases.RESPONSE_DB.id, database);
  const metadata = await cf<{ name: string }>(`/d1/database/${database}`);
  assert.equal(metadata.name, 'aegisops-response-preview');
  const initial = await cf<SqlResult[]>(`/d1/database/${database}/query`, { sql: 'SELECT COUNT(*) AS n FROM response_cases' });
  assert.equal(initial[0]!.results[0]!.n, 0, 'Preview contains records; refuse to reset an existing workspace');
  owned = true;
  const health = JSON.parse((await expected('/api/healthz', 200, { cookie: null })).text);
  assert.equal(health.responseWorkflow.kind, 'cloud-response');
  assert.equal(health.responseWorkflow.configured, true);
  for (const route of ['/api', '/api/analyze', '/api/missing']) {
    assert.match((await expected(route, 404, { cookie: null })).headers.get('content-type')!, /application\/json/);
  }
  await expected(base, 405, { cookie: null });
  record('separate remote bindings, fail-closed configuration and API-only routing');

  await resetBudget();
  const loginBody = { authMode: 'token', credential: token };
  await expected('/api/auth/session', 403, { method: 'POST', body: loginBody, origin: null });
  await expected('/api/auth/session', 403, { method: 'POST', body: loginBody, origin: 'https://foreign.test' });
  await expected('/api/auth/session', 403, { method: 'POST', body: loginBody, headers: { 'sec-fetch-site': 'cross-site' } });
  await expected('/api/auth/session', 403, { method: 'POST', body: { authMode: 'token', credential: 'wrong' } });
  await expected('/api/auth/session', 400, { method: 'POST', body: { authMode: 'oidc', credential: token } });
  const login = await expected('/api/auth/session', 200, { method: 'POST', body: loginBody });
  const setCookie = login.headers.get('set-cookie')!;
  for (const flag of ['Secure', 'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=3600']) assert(setCookie.includes(flag));
  assert(!setCookie.includes('Domain='));
  cookie = setCookie.split(';')[0]!;
  const claims = JSON.parse(Buffer.from(cookie.split('=')[1]!.split('.')[0]!, 'base64url').toString());
  assert.equal(claims.aud, origin); assert.equal(claims.exp - claims.iat, 3600);
  for (const bad of [cookie + 'x', cookie + '; ' + cookie, signed({ ...claims, aud: 'https://foreign.test' }),
    signed({ ...claims, iat: claims.iat - 7200, exp: claims.exp - 7200 }), signed({ ...claims, credential: 'injected' })]) {
    assert.equal(JSON.parse((await expected('/api/auth/session', 200, { cookie: bad })).text).active, false);
    await expected(base + '/' + randomUUID(), 403, { cookie: bad });
  }
  record('remote token authentication, secure one-hour cookie, origin, expiry, tamper and audience rejection');

  await resetBudget();
  const draft = await create();
  assert.deepEqual(draft, createResponseCase(input, draft.id, { kind: 'shared-token' }, draft.createdAt));
  for (const suffix of ['', '/export?format=json']) await expected(`${base}/${draft.id}${suffix}`, 403, { cookie: null });
  const complete = await review(await review(draft, { kind: 'begin' }), cloudCompletion);
  assert.equal(complete.revision, 3); assert.equal(complete.state.kind, 'reviewed');
  assert.deepEqual(await read(draft.id), complete);
  const exports: Record<string, string> = {};
  for (const format of ['markdown', 'json', 'hancom-json'] as const) {
    const result = await expected(`${base}/${draft.id}/export?format=${format}`, 200);
    const generated = format === 'markdown' ? /생성 시각 \(UTC\): ([^\n]+)/.exec(result.text)![1]! : JSON.parse(result.text).generated_at_utc;
    const normalize = (text: string) => text.replace(/^(생성 시각 \(한국\): .*?) (AM|PM) /m,
      (_match, prefix: string, period: string) => `${prefix} ${period === 'AM' ? '오전' : '오후'} `);
    assert.equal(result.text, normalize(renderResponseExport(complete, format, generated)));
    exports[format] = hash(result.text);
  }
  const changes = await review(await review(await create(), { kind: 'begin' }), { kind: 'request-changes', note: 'Synthetic remote review' });
  assert.equal(changes.state.kind, 'changes-requested');
  record('remote lifecycle, both terminal states, authoritative reopen and exact export hashes', { exports });

  await resetBudget();
  const raced = await create();
  const races = await Promise.all([1, 2].map(() => http(`${base}/${raced.id}/review`, {
    method: 'POST', body: { expectedRevision: 1, command: { kind: 'begin' } },
  })));
  assert.deepEqual(races.map((x) => x.status).sort(), [200, 409]);
  assert.equal((await read(raced.id)).reviewEvents.length, 1);
  record('independent remote CAS race commits exactly once', { statuses: races.map((x) => x.status) });

  await resetBudget();
  const before = await count();
  await expected(base, 413, { method: 'POST', raw: ' '.repeat(262145) });
  await expected(base, 413, { method: 'POST', chunks: [' '.repeat(131072), ' '.repeat(131073)] });
  await expected(base, 415, { method: 'POST', raw: '{}', headers: { 'content-type': 'text/plain' } });
  await expected(base, 415, { method: 'POST', raw: '{}', headers: { 'content-encoding': 'gzip' } });
  for (const evidence of [{ logs: 'x'.repeat(50001), declaredImageCount: 0 }, { logs: '\n'.repeat(1000), declaredImageCount: 0 },
    { logs: 'OOM', declaredImageCount: 17 }]) {
    await expected(base, 400, { method: 'POST', body: { ...input, evidence } });
  }
  assert.equal(await count(), before);
  const exactRaw = JSON.stringify(input) + ' '.repeat(262144 - Buffer.byteLength(JSON.stringify(input)));
  await expected(base, 201, { method: 'POST', chunks: [exactRaw.slice(0, 131072), exactRaw.slice(131072)] });
  record('remote declared and streamed request bounds; invalid inputs do not persist');

  await resetBudget();
  const maximum = maximumCloudSubmission(); maximum.clientIncidentId = prefix;
  const excess = Buffer.byteLength(JSON.stringify(maximum)) - 262144;
  maximum.report.rootCauses[maximum.report.rootCauses.length - 1] = maximum.report.rootCauses.at(-1)!.slice(0, -excess);
  assert.equal(Buffer.byteLength(JSON.stringify(maximum)), 262144);
  const large = await create(maximum);
  assert.equal(large.content.evidence.logs.length, 50000);
  assert.deepEqual(large, createResponseCase(maximum, large.id, { kind: 'shared-token' }, large.createdAt));
  assert.deepEqual(await read(large.id), large);
  const largeComplete = await review(await review(large, { kind: 'begin' }), {
    kind: 'complete', note: 'Synthetic maximum remote proof',
    acknowledgements: large.content.checks.map((check) => ({ checkId: check.id, acknowledged: true })),
  });
  for (const format of ['markdown', 'json', 'hancom-json']) await expected(`${base}/${large.id}/export?format=${format}`, 200);
  record('retained 256KiB multibyte maximum succeeds remotely without dropping integrity checks', {
    requestBytes: 262144, aggregateBytes: Buffer.byteLength(JSON.stringify(largeComplete)), exactCpuMeasured: false,
  });

  await resetBudget();
  const fault = await create();
  await sql("CREATE TRIGGER remote_proof_fail_update BEFORE UPDATE ON response_cases BEGIN SELECT RAISE(ABORT, 'synthetic remote write fault'); END");
  const failure = await expected(`${base}/${fault.id}/review`, 503, { method: 'POST', body: { expectedRevision: 1, command: { kind: 'begin' } } });
  assert(!failure.text.includes('synthetic remote write fault'));
  assert.deepEqual(await read(fault.id), fault);
  await sql('DROP TRIGGER remote_proof_fail_update');
  record('real remote D1 write failure returns safe JSON503 and preserves the confirmed revision');

  await resetBudget(); await stableMinute();
  await expected('/api/auth/session', 403, { method: 'POST', body: { authMode: 'token', credential: 'wrong' } });
  await sql("UPDATE response_rate_budget SET used=19 WHERE name='login-minute'");
  const logins = await Promise.all([1, 2].map(() => http('/api/auth/session', { method: 'POST', body: loginBody })));
  assert.deepEqual(logins.map((x) => x.status).sort(), [200, 429]);
  assert(Number(logins.find((x) => x.status === 429)!.headers.get('retry-after')) > 0);
  await resetBudget(); await stableMinute(); await create();
  await sql("UPDATE response_rate_budget SET used=29 WHERE name='mutation-minute'");
  const mutations = await Promise.all([1, 2].map(() => http(base, { method: 'POST', body: input })));
  assert.deepEqual(mutations.map((x) => x.status).sort(), [201, 429]);
  await resetBudget();
  await expected('/api/auth/session', 403, { method: 'POST', body: { authMode: 'token', credential: 'wrong' } }); await create();
  await sql("UPDATE response_rate_budget SET used=120 WHERE name='login-day'; UPDATE response_rate_budget SET used=400 WHERE name='mutation-day'");
  await expected('/api/auth/session', 429, { method: 'POST', body: loginBody });
  await expected(base, 429, { method: 'POST', body: input });
  record('remote last-unit login/mutation races and daily limits', { login: logins.map((x) => x.status), mutation: mutations.map((x) => x.status) });

  await resetBudget();
  for (let remaining = 99 - await count(); remaining > 0;) {
    const batch = Math.min(5, remaining); const statements: string[] = [];
    for (let index = 0; index < batch; index++) {
      const fixture = createResponseCase(input, randomUUID(), { kind: 'shared-token' }, new Date().toISOString());
      statements.push(`INSERT INTO response_cases VALUES (${literal(fixture.id)},1,${literal(JSON.stringify(fixture))})`);
    }
    await sql(statements.join(';')); remaining -= batch;
  }
  const cap = await Promise.all([1, 2].map(() => http(base, { method: 'POST', body: input })));
  assert.deepEqual(cap.map((x) => x.status).sort(), [201, 409]);
  assert.equal(cap.find((x) => x.status === 409)!.headers.get('retry-after'), null);
  assert.equal(await count(), 100);
  record('remote99-to100 atomic capacity race distinguishes full storage from retryable rate limits');
  const logout = await expected('/api/auth/session', 200, { method: 'DELETE' });
  assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
  assert.equal(JSON.parse((await expected('/api/auth/session', 200, { cookie: null })).text).active, false);
  record('same-origin logout clears the secure cookie');
  passed = true;
} finally {
  let cleanupError: unknown;
  try {
    if (owned) {
      await sql('DROP TRIGGER IF EXISTS remote_proof_fail_update');
      await sql(`DELETE FROM response_cases WHERE json_extract(payload,'$.content.clientIncidentId')=${literal(prefix)}`);
      await resetBudget();
      assert.equal(await count(), 0, 'Unexpected preview records remain; do not delete unrelated data');
    }
  } catch (error) { passed = false; cleanupError = error; }
  await writeFile(path.join(output, 'results.json'), JSON.stringify({
    result: passed ? 'PASS' : 'FAIL', at: new Date().toISOString(), origin, previewDatabase: database,
    syntheticOnly: true, fixturesRemoved: owned && !cleanupError, exactCpuMeasured: false, checks: findings, requests,
  }, null, 2) + '\n');
  if (cleanupError) throw cleanupError;
}
