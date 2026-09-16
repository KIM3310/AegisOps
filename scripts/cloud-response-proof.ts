import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createResponseCase, applyReviewCommand, contentHash, renderResponseExport } from '../server/lib/responseWorkflow';
import { cloudSubmission, cloudCompletion, maximumCloudSubmission } from '../__tests__/fixtures/cloudResponse';
import type { ResponseCase } from '../shared/responseCase';
import { verifyResponseBrowser } from './cloud-browser-proof';

const root = process.cwd();
const output = path.resolve(process.argv[2] || '.wrangler/cloud-proof-results');
await mkdir(output, { recursive: true });
const owned = await mkdtemp(path.join(output, 'run-'));
const persist = path.join(owned, 'd1');
const faultPersist = path.join(owned, 'fault-d1');
const localHome = path.join(owned, 'home');
await mkdir(localHome);
const token = 'synthetic-only-operator-token-0123456789abcdef';
const secret = 'synthetic-only-session-secret-abcdef0123456789';
const origin = 'https://127.0.0.1:8788';
const base = '/api/response-workflows';
const cookieName = '__Host-aegisops_review_session';
const actor = { kind: 'shared-token' } as const;
const env = { PATH: process.env.PATH, HOME: localHome, XDG_CONFIG_HOME: path.join(localHome, 'config'),
  TMPDIR: process.env.TMPDIR, CI: 'true', WRANGLER_SEND_METRICS: 'false',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' };
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const varsFile = path.join(root, '.dev.vars');
const findings: { name: string; [key: string]: unknown }[] = [];
const commands: string[][] = [];
let server: ChildProcess | undefined;
const auxiliary: ChildProcess[] = [];
let serverLog = '';
let sequence = 0;
let ownsVars = false;
let passed = false;
let cookie = '';
const record = (name: string, detail: Record<string, unknown> = {}) => { findings.push({ name, ...detail }); console.log('PASS ' + name); };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sqlValue = (value: unknown) => "'" + String(value).replaceAll("'", "''") + "'";

async function cli(args: string[], allowedFailure = false) {
  commands.push(args);
  const child = spawn(process.execPath, [wrangler, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout!.on('data', (chunk: Buffer) => { text += chunk.toString(); });
  child.stderr!.on('data', (chunk: Buffer) => { text += chunk.toString(); });
  const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  await writeFile(path.join(owned, `command-${++sequence}.log`), text);
  if (!allowedFailure) assert.equal(code, 0, `Wrangler failed: ${args.join(' ')}\n${text}`);
  return { code, text };
}
async function sql(statement: string, directory = persist, allowedFailure = false) {
  const filename = path.join(owned, `fixture-${++sequence}.sql`);
  await writeFile(filename, statement);
  const result = await cli(['d1', 'execute', 'RESPONSE_DB', '--local', '--persist-to', directory, '--file', filename, '--json'], allowedFailure);
  if (allowedFailure && result.code !== 0) assert.match(result.text, /CHECK constraint failed/);
  return result.code === 0 ? JSON.parse(result.text) as { results: Record<string, unknown>[]; meta: Record<string, unknown> }[] : null;
}
async function count(directory = persist) {
  const result = await sql('SELECT COUNT(*) AS n FROM response_cases;', directory);
  return result![0]!.results[0]!.n;
}
async function resetBudget(directory = persist) { await sql('DELETE FROM response_rate_budget;', directory); }
async function stop() {
  if (!server || server.exitCode !== null) { server = undefined; return; }
  const current = server;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => current.kill('SIGKILL'), 5000);
    current.once('close', () => { clearTimeout(timer); resolve(); });
    current.kill('SIGTERM');
  });
  server = undefined;
}
async function start(directory = persist) {
  assert.equal(server, undefined);
  const args = ['pages', 'dev', 'dist', '--ip', '127.0.0.1', '--port', '8788', '--inspector-port', '0',
    '--local-protocol', 'https', '--persist-to', directory];
  commands.push(args);
  server = spawn(process.execPath, [wrangler, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    let pending = '';
    const timer = setTimeout(() => reject(new Error('Wrangler startup timeout\n' + pending)), 30000);
    const ready = (chunk: Buffer) => {
      const text = chunk.toString(); pending += text; serverLog += text;
      if (pending.includes('Ready on')) { clearTimeout(timer); resolve(); }
    };
    server!.stdout!.on('data', ready); server!.stderr!.on('data', ready);
    server!.once('error', reject);
    server!.once('exit', (code) => { clearTimeout(timer); reject(new Error('Wrangler exited before ready: ' + code + '\n' + pending)); });
  });
}
async function startAuxiliary(args: string[], readyText: string, extraEnv: Record<string, string> = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  auxiliary.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Local auxiliary startup timeout: ' + output)), 20000);
    const receive = (chunk: Buffer) => {
      output += chunk.toString(); serverLog += chunk.toString();
      if (output.replace(/\u001b\[[0-9;]*m/g, '').includes(readyText)) { clearTimeout(timer); resolve(); }
    };
    child.stdout!.on('data', receive); child.stderr!.on('data', receive);
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('Local auxiliary exited: ' + code + output)); });
  });
}
type HttpResult = { status: number; text: string; headers: Record<string, string | string[] | undefined>; elapsedMs: number };
async function http(route: string, options: { method?: string; body?: unknown; raw?: string; cookie?: string | null; origin?: string | null; headers?: Record<string, string>; chunks?: string[] } = {}): Promise<HttpResult> {
  const method = options.method || 'GET';
  const data = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const headers: Record<string, string> = { ...options.headers };
  if (options.cookie !== null && (options.cookie || cookie)) headers.cookie = options.cookie || cookie;
  if (method !== 'GET' && options.origin !== null) headers.origin = options.origin ?? origin;
  if (data !== undefined || options.chunks) headers['content-type'] ??= 'application/json';
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest(origin + route, { method, headers, rejectUnauthorized: false, agent: false }, (incoming) => {
      let text = '';
      incoming.setEncoding('utf8'); incoming.on('data', (chunk: string) => { text += chunk; });
      incoming.on('error', reject);
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, text, headers: incoming.headers, elapsedMs: performance.now() - started }));
    });
    outgoing.setTimeout(15000, () => outgoing.destroy(new Error('HTTP timeout')));
    outgoing.on('error', reject);
    if (options.chunks) { for (const chunk of options.chunks) outgoing.write(chunk); outgoing.end(); }
    else outgoing.end(data);
  });
}
function secure(response: HttpResult) {
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert(!response.text.includes(token)); assert(!response.text.includes(secret));
}
async function expected(route: string, status: number, options: Parameters<typeof http>[1] = {}) {
  const response = await http(route, options);
  secure(response); assert.equal(response.status, status, `${route}: ${response.text.slice(0, 500)}`);
  return response;
}
async function create(body: unknown = cloudSubmission) {
  const response = await expected(base, 201, { method: 'POST', body });
  return JSON.parse(response.text) as ResponseCase;
}
async function review(current: ResponseCase, command: unknown) {
  const response = await expected(`${base}/${current.id}/review`, 200, { method: 'POST', body: { expectedRevision: current.revision, command } });
  return JSON.parse(response.text) as ResponseCase;
}
function signed(claims: object) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const key = createHmac('sha256', secret).update('aegisops.cloud.response.session.v1\0').update(token).digest();
  return cookieName + '=' + payload + '.' + createHmac('sha256', key).update(payload).digest('base64url');
}
function insert(value: ResponseCase) {
  return `INSERT INTO response_cases (id, revision, payload) VALUES (${sqlValue(value.id)}, ${value.revision}, ${sqlValue(JSON.stringify(value))});`;
}

try {
  const filenames = await readdir(root);
  assert(!filenames.some((name) => name.startsWith('.dev.vars') || (name.startsWith('.env') && name !== '.env.example')),
    'Private local config exists. Inspect filenames only and move no existing config. Use a clean isolated checkout.');
  await writeFile(varsFile, `AEGISOPS_OPERATOR_TOKEN="${token}"\nAEGISOPS_OPERATOR_SESSION_SECRET="${secret}"\n`, { flag: 'wx', mode: 0o600 });
  ownsVars = true;
  await cli(['d1', 'migrations', 'apply', 'RESPONSE_DB', '--local', '--persist-to', persist]);
  await start();
  const health = await expected('/api/healthz', 200, { cookie: null });
  assert.deepEqual(JSON.parse(health.text).responseWorkflow, { kind: 'cloud-response', storage: 'd1', authMode: 'token', scope: 'shared-synthetic', configured: true });
  for (const route of ['/api', '/api/analyze', '/api/missing']) {
    const response = await expected(route, 404, { cookie: null }); assert.match(String(response.headers['content-type']), /application\/json/);
  }
  for (const [route, method, allow] of [[base, 'GET', 'POST'], ['/api/auth/session', 'PUT', 'GET, POST, DELETE'], ['/api/healthz', 'POST', 'GET']]) {
    const response = await expected(route!, 405, { method }); assert.equal(response.headers.allow, allow);
  }
  record('compiled API-only routing and dynamic MIME/security headers');

  await expected('/api/auth/session', 403, { method: 'POST', body: { authMode: 'token', credential: token }, origin: null });
  await expected('/api/auth/session', 403, { method: 'POST', body: { authMode: 'token', credential: token }, origin: 'https://foreign.test' });
  await expected('/api/auth/session', 403, { method: 'POST', body: { authMode: 'token', credential: token }, headers: { 'sec-fetch-site': 'cross-site' } });
  await expected('/api/auth/session', 403, { method: 'POST', body: { authMode: 'token', credential: 'wrong' } });
  await expected('/api/auth/session', 400, { method: 'POST', body: { authMode: 'oidc', credential: token } });
  const login = await expected('/api/auth/session', 200, { method: 'POST', body: { authMode: 'token', credential: token, roles: ['ignored-admin'] } });
  const setCookie = login.headers['set-cookie']![0]!;
  cookie = setCookie.split(';')[0]!;
  assert.match(setCookie, /^__Host-aegisops_review_session=/);
  for (const flag of ['Secure', 'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=3600']) assert(setCookie.includes(flag));
  assert(!setCookie.includes('Domain='));
  const claims = JSON.parse(Buffer.from(cookie.split('=')[1]!.split('.')[0]!, 'base64url').toString());
  assert.deepEqual(Object.keys(claims).sort(), ['aud', 'exp', 'iat', 'kind', 'nonce', 'v']);
  assert.equal(claims.aud, origin); assert.equal(claims.exp - claims.iat, 3600); assert(!JSON.stringify(claims).includes(token));
  assert.equal(JSON.parse((await expected('/api/auth/session', 200, { cookie: signed(claims) })).text).active, true);
  const invalidCookies = [cookie + 'x', cookie + '; ' + cookie, cookieName + '=malformed', 'x'.repeat(8193),
    signed({ ...claims, aud: 'https://foreign.test' }), signed({ ...claims, iat: claims.iat - 7200, exp: claims.exp - 7200 }),
    signed({ ...claims, exp: claims.exp + 3600 }), signed({ ...claims, nonce: 'invalid' }), signed({ ...claims, credential: token })];
  for (const badCookie of invalidCookies) {
    assert.deepEqual(JSON.parse((await expected('/api/auth/session', 200, { cookie: badCookie })).text), { active: false });
    await expected(base + '/06cbd1a9-2df5-440a-982b-09105aee3a91', 403, { cookie: badCookie });
  }
  record('HTTPS one-hour token-free cookie; Origin, token, OIDC, expiry, tamper, audience, duplicate and strict-claims denials');

  const draft = await create();
  const literal = createResponseCase(cloudSubmission, draft.id, actor, draft.createdAt);
  assert.deepEqual(draft, literal);
  assert.equal(draft.contentDigest, '7d2408ef04c076e25f9ce84a5f6306a6c6be541c487a18fe35914590c8a5dea7');
  assert.equal(draft.content.evidence.logDigest, 'cb25700db8bd0c87cd5582fe8ed30aa9e7d3ff22401829b72e3e335d61516a53');
  assert.equal(draft.content.sources[0]!.contentHash, 'cf34172f84e9cf23ef4f14e591cfef4948e7cc8771063cc9c8a6141b57753aed');
  assert.equal(draft.content.evidence.spans[0]!.quote, 'service=demo p95_latency=2400ms queue_depth=180');
  assert.equal(draft.content.evidence.logs, 'normal\nservice=demo p95_latency=2400ms queue_depth=180');
  for (const suffix of ['', '/export?format=markdown', '/export?format=json', '/export?format=hancom-json']) await expected(`${base}/${draft.id}${suffix}`, 403, { cookie: null });
  await expected(base, 403, { method: 'POST', body: cloudSubmission, origin: null });
  await expected(`${base}/${draft.id}/review`, 403, { method: 'POST', body: { expectedRevision: 1, command: { kind: 'begin' } }, origin: 'null' });
  await expected(`${base}/${draft.id}/review`, 403, { method: 'POST', body: { expectedRevision: 1, command: { kind: 'begin' } }, headers: { 'sec-fetch-site': 'cross-site' } });
  const begun = await review(draft, { kind: 'begin' });
  const complete = await review(begun, cloudCompletion);
  assert.equal(complete.state.kind, 'reviewed'); assert.equal(complete.revision, 3); assert.equal(complete.reviewEvents.length, 2);
  const exports: Record<string, string> = {};
  for (const format of ['markdown', 'json', 'hancom-json'] as const) {
    const result = await expected(`${base}/${draft.id}/export?format=${format}`, 200);
    assert.match(String(result.headers['content-disposition']), new RegExp(`response-${draft.id}-${format}`));
    assert.match(String(result.headers['content-type']), format === 'markdown' ? /text\/markdown/ : /application\/json/);
    const generatedAt = format === 'markdown' ? /생성 시각 \(UTC\): ([^\n]+)/.exec(result.text)![1]! : JSON.parse(result.text).generated_at_utc;
    const expectedExport = renderResponseExport(complete, format, generatedAt);
    const koreanTimestamp = (text: string) => text.replace(/^(생성 시각 \(한국\): .*?) (AM|PM) /m, (_match, prefix: string, period: string) => `${prefix} ${period === 'AM' ? '오전' : '오후'} `);
    assert.equal(result.text, format === 'markdown' ? koreanTimestamp(expectedExport) : expectedExport);
    if (format === 'json') assert.deepEqual(JSON.parse(result.text).responseCase, complete);
    if (format === 'hancom-json') { assert.equal(JSON.parse(result.text).templateValidated, false); assert.equal(JSON.parse(result.text).template_placeholders['{{REVIEW_STATUS}}'], '검토 완료 (실행 승인 아님)'); }
    exports[format] = hash(result.text); await writeFile(path.join(owned, 'export-' + format + (format === 'markdown' ? '.md' : '.json')), result.text);
  }
  for (const query of ['format=hwp', 'format=json&format=markdown', 'payload=forged']) await expected(`${base}/${draft.id}/export?${query}`, 400);
  const changesDraft = await create(); const changes = await review(await review(changesDraft, { kind: 'begin' }), { kind: 'request-changes', note: '합성 추가 근거 요청' });
  assert.equal(changes.state.kind, 'changes-requested');
  record('exact Node-domain evidence, digests, citations, both terminal states and all persisted exports', { id: draft.id, revision: complete.revision, contentDigest: complete.contentDigest, logDigest: complete.content.evidence.logDigest, exports });

  await stop(); await start();
  assert.deepEqual(JSON.parse((await expected(`${base}/${draft.id}`, 200)).text), complete);
  assert.equal(JSON.parse((await expected('/api/auth/session', 200)).text).active, true);
  record('Wrangler/Workerd restart preserves D1 aggregate and stable signed session');

  await resetBudget();
  const race = await create();
  const responses = await Promise.all([1, 2].map(() => http(`${base}/${race.id}/review`, { method: 'POST', body: { expectedRevision: 1, command: { kind: 'begin' } } })));
  assert.deepEqual(responses.map((entry) => entry.status).sort(), [200, 409]);
  assert.equal(JSON.parse((await expected(`${base}/${race.id}`, 200)).text).reviewEvents.length, 1);
  record('independent HTTP SQL CAS race', { statuses: responses.map((entry) => entry.status), id: race.id });

  await resetBudget();
  const beforeLimits = await count();
  for (const evidence of [{ logs: 'x'.repeat(50001), declaredImageCount: 0 }, { logs: '\n'.repeat(1000), declaredImageCount: 0 }, { logs: 'OOM', declaredImageCount: 17 }]) {
    await expected(base, 400, { method: 'POST', body: { ...cloudSubmission, evidence } });
  }
  await expected(base, 413, { method: 'POST', raw: ' '.repeat(262145), headers: { 'content-length': '262145' } });
  await expected(base, 413, { method: 'POST', chunks: [' '.repeat(131072), ' '.repeat(131073)] });
  await expected(base, 415, { method: 'POST', raw: '{}', headers: { 'content-type': 'text/plain' } });
  await expected(base, 415, { method: 'POST', raw: '{}', headers: { 'content-encoding': 'gzip' } });
  assert.equal(await count(), beforeLimits);
  const maxChars = await create({ ...cloudSubmission, evidence: { logs: 'x'.repeat(50000), declaredImageCount: 0 } });
  assert.equal(maxChars.content.evidence.logs.length, 50000);
  const maxLines = await create({ ...cloudSubmission, evidence: { logs: '\n'.repeat(999), declaredImageCount: 16 } });
  assert.equal(maxLines.content.evidence.logs.split('\n').length, 1000);
  assert.deepEqual(maxLines.content.gaps.map((gap) => gap.id), ['unmatched-evidence', 'images-not-retained']);
  const validRaw = JSON.stringify(cloudSubmission);
  const exactRaw = validRaw + ' '.repeat(262144 - Buffer.byteLength(validRaw));
  await expected(base, 201, { method: 'POST', raw: exactRaw, headers: { 'content-length': '262144' } });
  await expected(base, 201, { method: 'POST', chunks: [exactRaw.slice(0, 131072), exactRaw.slice(131072)] });
  for (const current of [maxChars, maxLines]) {
    const reviewing = await review(current, { kind: 'begin' });
    await expected(`${base}/${current.id}/review`, 422, { method: 'POST', body: { expectedRevision: reviewing.revision, command: cloudCompletion } });
    assert.equal(JSON.parse((await expected(`${base}/${current.id}`, 200)).text).revision, 2);
  }
  record('raw declared/streamed exact 256 KiB and overflow; 50000 chars, 1000 lines, 16 images, gap blocking and unchanged rejected rows');
  await resetBudget();
  const maximum = maximumCloudSubmission();
  const maxCreatedReply = await expected(base, 201, { method: 'POST', body: maximum });
  const maxCreated = JSON.parse(maxCreatedReply.text) as ResponseCase;
  assert.equal(maxCreated.content.evidence.logs.length, 50000);
  assert.equal(maxCreated.content.checks.length, 3);
  assert.deepEqual(maxCreated, createResponseCase(maximum, maxCreated.id, actor, maxCreated.createdAt));
  const maxRead = await expected(`${base}/${maxCreated.id}`, 200);
  const maxBegun = await review(maxCreated, { kind: 'begin' });
  const maxComplete = await review(maxBegun, { kind: 'complete', note: '합성 최대 경계 확인',
    acknowledgements: maxCreated.content.checks.map((check) => ({ checkId: check.id, acknowledged: true })) });
  const timings: Record<string, number> = { create: maxCreatedReply.elapsedMs, read: maxRead.elapsedMs };
  for (const format of ['markdown', 'json', 'hancom-json']) {
    const document = await expected(`${base}/${maxComplete.id}/export?format=${format}`, 200);
    timings[format] = document.elapsedMs;
  }
  await writeFile(path.join(owned, 'maximum-submission.json'), JSON.stringify(maximum));
  const sqlCeiling = await sql(`INSERT INTO response_cases VALUES ('00000000-0000-4000-8000-000000000000', 1,
    json_object('id', '00000000-0000-4000-8000-000000000000', 'revision', 1, 'padding', replace(hex(zeroblob(350000)), '00', '가')));`, persist, true);
  assert.equal(sqlCeiling, null);
  record('near-256KiB multibyte maximum retains all 50000 characters and three complete plans; SQL enforces UTF-8 record ceiling',
    { requestBytes: Buffer.byteLength(JSON.stringify(maximum)), aggregateBytes: Buffer.byteLength(JSON.stringify(maxComplete)), localWallMsNotCloudCpu: timings });

  await resetBudget();
  const future = createResponseCase(cloudSubmission, randomUUID(), actor, '2099-01-01T00:00:00.000Z');
  const futureEvent = applyReviewCommand(createResponseCase(cloudSubmission, randomUUID(), actor, '2026-01-01T00:00:00.000Z'), { kind: 'begin' }, actor, '2099-01-01T00:00:00.000Z');
  await sql(insert(future) + insert(futureEvent));
  for (const current of [future, futureEvent]) {
    await expected(`${base}/${current.id}/review`, 503, { method: 'POST', body: { expectedRevision: current.revision, command: current.revision === 1 ? { kind: 'begin' } : cloudCompletion } });
    assert.deepEqual(JSON.parse((await expected(`${base}/${current.id}`, 200)).text), current);
  }
  record('real HTTP clock rollback rejection at createdAt and prior event with unchanged valid future fixtures');

  const writeFault = await create();
  await sql("CREATE TRIGGER test_fail_update BEFORE UPDATE ON response_cases BEGIN SELECT RAISE(ABORT, 'synthetic write fault'); END;");
  const failedWrite = await expected(`${base}/${writeFault.id}/review`, 503, { method: 'POST', body: { expectedRevision: 1, command: { kind: 'begin' } } });
  assert(!failedWrite.text.includes('synthetic write fault')); assert(failedWrite.text.includes('확인할 수 없습니다'));
  assert.deepEqual(JSON.parse((await expected(`${base}/${writeFault.id}`, 200)).text), writeFault);
  await sql('DROP TRIGGER test_fail_update;');
  record('real D1 write failure is safe/unconfirmed and preserves previous aggregate');

  await resetBudget();
  await expected('/api/auth/session', 403, { method: 'POST', body: { authMode: 'token', credential: 'wrong' } });
  await sql("UPDATE response_rate_budget SET used = 19 WHERE name = 'login-minute';");
  const lastLogins = await Promise.all([1, 2].map(() => http('/api/auth/session', { method: 'POST', body: { authMode: 'token', credential: token } })));
  assert.deepEqual(lastLogins.map((entry) => entry.status).sort(), [200, 429]);
  assert(Number(lastLogins.find((entry) => entry.status === 429)!.headers['retry-after']) > 0);
  await resetBudget(); await create();
  await sql("UPDATE response_rate_budget SET used = 29 WHERE name = 'mutation-minute';");
  const lastMutations = await Promise.all([1, 2].map(() => http(base, { method: 'POST', body: cloudSubmission })));
  assert.deepEqual(lastMutations.map((entry) => entry.status).sort(), [201, 429]);
  for (let index = 0; index < 8; index++) {
    await sql('UPDATE response_rate_budget SET window_start = 0, used = 1;');
    await expected('/api/auth/session', 403, { method: 'POST', body: { authMode: 'token', credential: 'wrong' } });
    await expected(base, 400, { method: 'POST', body: {} });
  }
  const budgetRows = await sql('SELECT name, window_start, used FROM response_rate_budget ORDER BY name;');
  assert.equal(budgetRows![0]!.results.length, 4);
  await sql("UPDATE response_rate_budget SET used = 120 WHERE name = 'login-day'; UPDATE response_rate_budget SET used = 400 WHERE name = 'mutation-day';");
  await expected('/api/auth/session', 429, { method: 'POST', body: { authMode: 'token', credential: token } });
  await expected(base, 429, { method: 'POST', body: cloudSubmission });
  await sql('UPDATE response_rate_budget SET window_start = 4070908800, used = 1;');
  await expected('/api/auth/session', 503, { method: 'POST', body: { authMode: 'token', credential: token } });
  record('independent last-unit quota races, daily/minute caps, four rows across expired windows and rollback rejection', { loginStatuses: lastLogins.map((entry) => entry.status), mutationStatuses: lastMutations.map((entry) => entry.status), rateRows: 4 });

  await resetBudget();
  if (process.argv.includes('--browser')) {
    await verifyResponseBrowser({ origin, output: path.join(owned, 'browser-cloud'), mode: 'cloud', token,
      failWrites: async (enabled) => { await sql(enabled
        ? "CREATE TRIGGER browser_fail_update BEFORE UPDATE ON response_cases BEGIN SELECT RAISE(ABORT, 'synthetic browser fault'); END;"
        : 'DROP TRIGGER browser_fail_update;'); },
    });
    record('isolated real Chrome cloud analysis, token login, review, downloads, reopen, conflict, actual D1 failure and committed/lost-response uncertainty');
    await resetBudget();
  }
  const existingCount = Number(await count());
  let fill = '';
  for (let index = existingCount; index < 99; index++) fill += insert(createResponseCase(cloudSubmission, randomUUID(), actor, '2026-01-01T00:00:00.000Z'));
  await sql(fill);
  const cap = await Promise.all([1, 2].map(() => http(base, { method: 'POST', body: cloudSubmission })));
  assert.deepEqual(cap.map((entry) => entry.status).sort(), [201, 409]);
  assert.equal(cap.find((entry) => entry.status === 409)!.headers['retry-after'], undefined);
  assert.equal(await count(), 100);
  record('independent HTTP 99-to-100 atomic cap race distinct from rate limiting', { statuses: cap.map((entry) => entry.status), count: 100 });

  await expected('/api/auth/session', 403, { method: 'DELETE', origin: null });
  const logout = await expected('/api/auth/session', 200, { method: 'DELETE' });
  assert.match(logout.headers['set-cookie']![0]!, /Max-Age=0/);
  assert.deepEqual(JSON.parse((await expected('/api/auth/session', 200, { cookie: null })).text), { active: false });
  record('same-origin repeat-safe logout clears exact secure cookie');

  await stop();
  await cli(['d1', 'migrations', 'apply', 'RESPONSE_DB', '--local', '--persist-to', faultPersist]);
  await sql('DROP TABLE response_cases; CREATE TABLE response_cases (id TEXT PRIMARY KEY, revision INTEGER, payload TEXT);', faultPersist);
  const faults: { name: string; id: string; revision: number; payload: string }[] = [];
  for (const kind of ['json', 'id', 'revision', 'digest', 'source', 'history', 'actor', 'oversized']) {
    const current = createResponseCase(cloudSubmission, randomUUID(), actor, '2026-01-01T00:00:00.000Z');
    const rowId = current.id;
    if (kind === 'id') current.id = randomUUID();
    if (kind === 'revision') current.revision = 2;
    if (kind === 'digest') current.contentDigest = '0'.repeat(64);
    if (kind === 'source') { current.content.sources[0]!.quote = 'forged'; current.contentDigest = contentHash(current.content); }
    if (kind === 'history') current.state = { kind: 'in-review' };
    if (kind === 'actor') current.createdBy = { kind: 'local-demo' };
    const payload = kind === 'json' ? '{corrupt' : kind === 'oversized' ? JSON.stringify({ ...current, padding: '가'.repeat(350000) }) : JSON.stringify(current);
    faults.push({ name: kind, id: rowId, revision: 1, payload });
  }
  for (const fault of faults) {
    if (fault.name === 'oversized') {
      const small = createResponseCase(cloudSubmission, fault.id, actor, '2026-01-01T00:00:00.000Z');
      await sql(insert(small) + `UPDATE response_cases SET payload = json_set(payload, '$.padding', replace(hex(zeroblob(350000)), '00', '가')) WHERE id = ${sqlValue(fault.id)};`, faultPersist);
    } else await sql(`INSERT INTO response_cases VALUES (${sqlValue(fault.id)}, ${fault.revision}, ${sqlValue(fault.payload)});`, faultPersist);
  }
  await start(faultPersist);
  for (const fault of faults) {
    for (const suffix of ['', '/export?format=markdown', '/export?format=json', '/export?format=hancom-json']) await expected(`${base}/${fault.id}${suffix}`, 500);
    await expected(`${base}/${fault.id}/review`, 500, { method: 'POST', body: { expectedRevision: 1, command: { kind: 'begin' } } });
  }
  assert.equal(await count(faultPersist), faults.length);
  await sql('DROP TABLE response_cases;', faultPersist);
  await expected(`${base}/${draft.id}`, 503);
  record('isolated fault D1 rejects malformed JSON, column disagreement, digest/catalog/history/actor and >1MiB UTF-8 records on all reads/exports/reviews; unavailable storage fails closed');
  await stop();

  await writeFile(varsFile, '');
  await start(persist);
  assert.deepEqual(JSON.parse((await expected('/api/healthz', 200)).text).responseWorkflow, { kind: 'unavailable', reason: 'configuration' });
  await expected('/api/auth/session', 503, { method: 'POST', body: { authMode: 'token', credential: token } });
  await expected(`${base}/${draft.id}`, 503);
  record('missing configuration fails closed and advertises unavailable review');
  if (process.argv.includes('--browser')) {
    await verifyResponseBrowser({ origin, output: path.join(owned, 'browser-configuration'), mode: 'configuration' });
    record('isolated Chrome missing-configuration mode disables review without disabling synthetic analysis');
    await stop();
    const staticConfig = path.join(owned, 'static-vite.config.mjs');
    await writeFile(staticConfig, 'export default ' + JSON.stringify({ build: { outDir: path.join(root, 'dist') } }) + ';');
    await startAuxiliary(['node_modules/vite/bin/vite.js', 'preview', '--config', staticConfig, '--host', '127.0.0.1', '--port', '4173', '--strictPort'], 'Local:');
    await verifyResponseBrowser({ origin: 'http://127.0.0.1:4173', output: path.join(owned, 'browser-static'), mode: 'static' });
    record('isolated Chrome static-only mode keeps reports but disables response storage and auth controls');
    await startAuxiliary(['--import', 'tsx', 'server/index.ts'], 'server-started', {
      LLM_PROVIDER: 'demo', AEGISOPS_OPERATOR_TOKEN: '', AEGISOPS_OPERATOR_SESSION_SECRET: '',
      AEGISOPS_RESPONSE_STORE_PATH: path.join(owned, 'native-cases'), AEGISOPS_SESSION_STORE_PATH: path.join(owned, 'native-sessions.jsonl'),
      AEGISOPS_RUNTIME_STORE_PATH: path.join(owned, 'native-runtime.jsonl'), GCP_ENABLED: 'false', AWS_ENABLED: 'false', DATADOG_ENABLED: 'false',
    });
    await startAuxiliary(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3000', '--strictPort'], 'Local:');
    await verifyResponseBrowser({ origin: 'http://127.0.0.1:3000', output: path.join(owned, 'browser-native'), mode: 'native' });
    record('isolated Chrome unchanged native loopback analysis, local-demo review, all exports and authoritative reopen');
  }
  passed = true;
} finally {
  await stop();
  for (const child of auxiliary) {
    if (child.exitCode !== null) continue;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('close', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
    });
  }
  if (ownsVars) await unlink(varsFile);
  for (const value of [token, secret, cookie]) if (value) assert(!serverLog.includes(value), 'runtime log leaked credential/session');
  await writeFile(path.join(owned, 'server.log'), serverLog);
  await writeFile(path.join(owned, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ result: passed ? 'PASS' : 'FAIL', owned, syntheticOnly: true, runtime: 'Wrangler HTTPS / Workerd / D1 local', remoteCpuProven: false, checks: findings }, null, 2) + '\n');
}
console.log(JSON.stringify({ result: 'PASS', checks: findings.length, output, owned }));
