// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { D1ResponseAuthority } from '../edge/responseAuthority';
import { createResponseCase, applyReviewCommand, contentHash } from '../server/lib/responseWorkflow';
import { cloudSubmission, cloudCompletion } from './fixtures/cloudResponse';

const id = '06cbd1a9-2df5-440a-982b-09105aee3a91';
const actor = { kind: 'shared-token' } as const;
let sqlite: DatabaseSync;
let authority: D1ResponseAuthority;
function binding(db: DatabaseSync): D1Database {
  return { prepare(sql: string) {
    const statement = db.prepare(sql);
    let values: (string | number | null)[] = [];
    const prepared = {
      bind(...input: (string | number | null)[]) { values = input; return prepared; },
      async first() { return statement.get(...values) ?? null; },
      async run() { const result = statement.run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
    return prepared;
  } } as unknown as D1Database;
}
function store(value: ReturnType<typeof createResponseCase>) {
  sqlite.prepare('INSERT INTO response_cases (id, revision, payload) VALUES (?, ?, ?)').run(value.id, value.revision, JSON.stringify(value));
}
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_response_workspace.sql', import.meta.url), 'utf8'));
  authority = new D1ResponseAuthority(binding(sqlite));
});
afterEach(() => sqlite.close());

describe('D1 response authority with actual SQLite statements', () => {
  it('creates a shared-token case and exports only the current validated aggregate', async () => {
    const created = await authority.create(cloudSubmission);
    expect(created).toMatchObject({ revision: 1, state: { kind: 'draft' }, createdBy: actor });
    expect(created.content.evidence.logs).toBe('normal\nservice=demo p95_latency=2400ms queue_depth=180');
    expect(created.content.sources[0]?.contentHash).toBe('cf34172f84e9cf23ef4f14e591cfef4948e7cc8771063cc9c8a6141b57753aed');
    expect(await authority.read(created.id)).toEqual(created);
    const begun = await authority.review(created.id, { expectedRevision: 1, command: { kind: 'begin' } });
    const reviewed = await authority.review(created.id, { expectedRevision: 2, command: cloudCompletion });
    expect(begun.state.kind).toBe('in-review');
    expect(reviewed).toMatchObject({ revision: 3, state: { kind: 'reviewed' } });
    expect(JSON.parse(await authority.export(created.id, 'json')).responseCase).toEqual(reviewed);
    expect(await authority.export(created.id, 'markdown')).toContain('검토 저장소는 위변조 방지나 기관별 격리를 제공하지 않습니다.');
    expect(JSON.parse(await authority.export(created.id, 'hancom-json')).templateValidated).toBe(false);
  });

  it('serializes independent revisions through SQL and returns one success', async () => {
    const created = await authority.create(cloudSubmission);
    const other = new D1ResponseAuthority(binding(sqlite));
    const result = await Promise.allSettled([authority, other].map((current) => current.review(created.id, { expectedRevision: 1, command: { kind: 'begin' } })));
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const failure = result.find((item) => item.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason.status).toBe(409);
    expect((await authority.read(created.id)).reviewEvents).toHaveLength(1);
  });

  it('admits exactly one at the 99 to 100 boundary, not a timed rate rejection', async () => {
    for (let i = 1; i <= 99; i++) store(createResponseCase(cloudSubmission, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, actor, '2026-01-01T00:00:00.000Z'));
    const result = await Promise.allSettled([authority, new D1ResponseAuthority(binding(sqlite))].map((current) => current.create(cloudSubmission)));
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const failure = result.find((item) => item.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason.status).toBe(409);
    expect(failure?.status === 'rejected' && failure.reason.retryAfter).toBeUndefined();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM response_cases').get()?.n).toBe(100);
  });

  it('does not clamp a regressing clock or overwrite a valid future record', async () => {
    const future = createResponseCase(cloudSubmission, id, actor, '2099-01-01T00:00:00.000Z');
    store(future);
    await expect(authority.review(id, { expectedRevision: 1, command: { kind: 'begin' } })).rejects.toMatchObject({ status: 503 });
    expect(await authority.read(id)).toEqual(future);
    const begun = applyReviewCommand(future, { kind: 'begin' }, actor, '2099-01-02T00:00:00.000Z');
    sqlite.prepare('UPDATE response_cases SET revision = ?, payload = ? WHERE id = ?').run(2, JSON.stringify(begun), id);
    await expect(authority.review(id, { expectedRevision: 2, command: cloudCompletion })).rejects.toMatchObject({ status: 503 });
    expect(await authority.read(id)).toEqual(begun);
  });

  it.each(['digest', 'catalog', 'history', 'actor'])('rejects stored %s corruption on read, export, and review', async (kind) => {
    const current = createResponseCase(cloudSubmission, id, actor, '2026-01-01T00:00:00.000Z');
    if (kind === 'digest') current.contentDigest = '0'.repeat(64);
    if (kind === 'catalog') { current.content.sources[0]!.quote = 'forged'; current.contentDigest = contentHash(current.content); }
    if (kind === 'history') { current.state = { kind: 'in-review' }; }
    if (kind === 'actor') current.createdBy = { kind: 'local-demo' };
    store(current);
    await expect(authority.read(id)).rejects.toMatchObject({ status: 500 });
    await expect(authority.export(id, 'json')).rejects.toMatchObject({ status: 500 });
    await expect(authority.review(id, { expectedRevision: 1, command: { kind: 'begin' } })).rejects.toMatchObject({ status: 500 });
    expect(JSON.parse(String(sqlite.prepare('SELECT payload FROM response_cases WHERE id = ?').get(id)?.payload))).toEqual(current);
  });

  it('fails closed on a write failure without a success value or a changed record', async () => {
    const created = await authority.create(cloudSubmission);
    sqlite.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON response_cases BEGIN SELECT RAISE(ABORT, 'synthetic fault'); END;");
    await expect(authority.review(created.id, { expectedRevision: 1, command: { kind: 'begin' } })).rejects.toMatchObject({ status: 503 });
    expect(await authority.read(created.id)).toEqual(created);
  });

  it('enforces non-NULL SQL identity/revision and UTF-8 byte checks', () => {
    const insert = sqlite.prepare('INSERT INTO response_cases (id, revision, payload) VALUES (?, ?, ?)');
    for (const payload of ['{}', 'null', 'corrupt', JSON.stringify({ id, revision: null }), JSON.stringify({ id: 'other', revision: 1 }), JSON.stringify({ id, revision: 2 })]) {
      expect(() => insert.run(id, 1, payload)).toThrow();
    }
    expect(() => insert.run(id, 1, JSON.stringify({ id, revision: 1, extra: '가'.repeat(350000) }))).toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM response_cases').get()?.n).toBe(0);
  });

  it('keeps four fixed rows and refuses a future rate window instead of resetting it', async () => {
    await authority.consumeLoginAttempt();
    await authority.create(cloudSubmission);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM response_rate_budget').get()?.n).toBe(4);
    sqlite.prepare('UPDATE response_rate_budget SET window_start = ?, used = 1').run(4070908800);
    await expect(authority.consumeLoginAttempt()).rejects.toMatchObject({ status: 503 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM response_rate_budget').get()?.n).toBe(4);
    expect(sqlite.prepare("SELECT window_start FROM response_rate_budget WHERE name = 'login-day'").get()?.window_start).toBe(4070908800);
    expect(() => sqlite.prepare('INSERT INTO response_rate_budget VALUES (?, 0, 1)').run('visitor-1')).toThrow();
  });

  it('admits only the last quota unit across independent authorities', async () => {
    await authority.consumeLoginAttempt();
    sqlite.exec("UPDATE response_rate_budget SET used = 19 WHERE name = 'login-minute'");
    const result = await Promise.allSettled([authority, new D1ResponseAuthority(binding(sqlite))].map((current) => current.consumeLoginAttempt()));
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const failure = result.find((item) => item.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason.status).toBe(429);
    expect(sqlite.prepare("SELECT used FROM response_rate_budget WHERE name = 'login-minute'").get()?.used).toBe(20);
  });
});
