import type { D1Database, D1Result } from '@cloudflare/workers-types';
import { randomUUID } from 'node:crypto';
import { CaseIdSchema, ReviewRequestSchema, type ResponseCase } from '../shared/responseCase';
import { applyReviewCommand, createResponseCase, renderResponseExport, ResponseWorkflowError, validateStoredResponseCase } from '../server/lib/responseWorkflow';

type ExportFormat = Parameters<typeof renderResponseExport>[1];
type CaseRow = { id: string; revision: number; payload: string };
const MAX_RECORD_BYTES = 1024 * 1024;
const actor = { kind: 'shared-token' } as const;
const budgets = {
  login: [{ name: 'login-day', width: 86400, cap: 120 }, { name: 'login-minute', width: 60, cap: 20 }],
  mutation: [{ name: 'mutation-day', width: 86400, cap: 400 }, { name: 'mutation-minute', width: 60, cap: 30 }],
} as const;

export class WorkspaceError extends ResponseWorkflowError {
  constructor(status: number, message: string, public readonly retryAfter?: number) { super(status, message); }
}

const unavailable = () => new WorkspaceError(503, '검토 저장소에서 결과를 확인할 수 없습니다. 최신 검토를 다시 열어 확인하세요. 자동으로 다시 제출하지 마세요.');
const corrupt = () => new WorkspaceError(500, '저장된 검토의 형식, 출처 또는 무결성을 확인할 수 없습니다.');
const conflict = () => new WorkspaceError(409, '다른 검토가 먼저 저장되었습니다. 최신 상태를 다시 불러오세요.');

function encode(current: ResponseCase): string {
  try { validateStoredResponseCase(current); }
  catch { throw corrupt(); }
  const payload = JSON.stringify(current);
  if (new TextEncoder().encode(payload).byteLength > MAX_RECORD_BYTES) {
    throw new WorkspaceError(413, '검토 스냅샷이 저장 한도 1 MiB를 초과합니다. 원문을 자동으로 자르지 않았습니다.');
  }
  return payload;
}

function changes(result: D1Result): number {
  if (!result.success || !Number.isInteger(result.meta.changes) || result.meta.changes < 0 || result.meta.changes > 1) throw unavailable();
  return result.meta.changes;
}

export class D1ResponseAuthority {
  constructor(private readonly database: D1Database) {}

  private async consume(kind: keyof typeof budgets): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    for (const budget of budgets[kind]) {
      const start = Math.floor(now / budget.width) * budget.width;
      let admitted: number;
      try {
        admitted = changes(await this.database.prepare(`
          INSERT INTO response_rate_budget (name, window_start, used) VALUES (?1, ?2, 1)
          ON CONFLICT(name) DO UPDATE SET window_start = excluded.window_start,
            used = CASE WHEN response_rate_budget.window_start = excluded.window_start
              THEN response_rate_budget.used + 1 ELSE 1 END
          WHERE response_rate_budget.window_start < excluded.window_start
            OR (response_rate_budget.window_start = excluded.window_start AND response_rate_budget.used < ?3)
        `).bind(budget.name, start, budget.cap).run());
      } catch { throw unavailable(); }
      if (admitted === 0) {
        let row: { window_start: number } | null;
        try { row = await this.database.prepare('SELECT window_start FROM response_rate_budget WHERE name = ?').bind(budget.name).first(); }
        catch { throw unavailable(); }
        if (!row || !Number.isSafeInteger(row.window_start) || row.window_start > start) throw unavailable();
        throw new WorkspaceError(429, '공유 데모의 요청 한도에 도달했습니다. 표시된 대기 시간 후 직접 다시 시도하세요.', start + budget.width - now);
      }
    }
  }

  async consumeLoginAttempt(): Promise<void> { await this.consume('login'); }

  async create(input: unknown): Promise<ResponseCase> {
    await this.consume('mutation');
    const current = createResponseCase(input, randomUUID(), actor, new Date().toISOString());
    const payload = encode(current);
    let inserted: number;
    try {
      inserted = changes(await this.database.prepare(`
        INSERT INTO response_cases (id, revision, payload)
        SELECT ?1, ?2, ?3 WHERE (SELECT COUNT(*) FROM response_cases) < 100
      `).bind(current.id, current.revision, payload).run());
    } catch { throw unavailable(); }
    if (inserted === 0) throw new WorkspaceError(409, '공유 검토 공간이 100건으로 가득 찼습니다. 시간이 지나도 공간은 비워지지 않습니다. 소유자의 명시적 초기화가 필요합니다.');
    return current;
  }

  async read(id: string): Promise<ResponseCase> {
    CaseIdSchema.parse(id);
    let row: CaseRow | null;
    try { row = await this.database.prepare('SELECT id, revision, payload FROM response_cases WHERE id = ?').bind(id).first<CaseRow>(); }
    catch { throw unavailable(); }
    if (!row) throw new WorkspaceError(404, '저장된 검토를 찾을 수 없습니다.');
    try {
      if (typeof row.payload !== 'string' || new TextEncoder().encode(row.payload).byteLength > MAX_RECORD_BYTES) throw corrupt();
      const current = validateStoredResponseCase(JSON.parse(row.payload));
      if (row.id !== id || current.id !== id || row.revision !== current.revision || current.createdBy.kind !== 'shared-token'
        || current.reviewEvents.some((event) => event.actor.kind !== 'shared-token')) throw corrupt();
      return current;
    } catch { throw corrupt(); }
  }

  async review(id: string, input: unknown): Promise<ResponseCase> {
    await this.consume('mutation');
    const request = ReviewRequestSchema.parse(input);
    const current = await this.read(id);
    if (request.expectedRevision !== current.revision) throw conflict();
    const at = new Date().toISOString();
    if (Date.parse(at) < Date.parse(current.createdAt) || Date.parse(at) < Date.parse(current.reviewEvents.at(-1)?.at ?? current.createdAt)) {
      throw new WorkspaceError(503, '서버 시각이 저장된 검토보다 이전입니다. 검토를 변경하지 않았습니다. 소유자의 시각 확인이 필요합니다.');
    }
    const updated = applyReviewCommand(current, request.command, actor, at);
    const payload = encode(updated);
    let updatedRows: number;
    try {
      updatedRows = changes(await this.database.prepare('UPDATE response_cases SET revision = ?, payload = ? WHERE id = ? AND revision = ?')
        .bind(updated.revision, payload, id, current.revision).run());
    } catch { throw unavailable(); }
    if (updatedRows === 0) throw conflict();
    return updated;
  }

  async export(id: string, format: ExportFormat): Promise<string> {
    return renderResponseExport(await this.read(id), format, new Date().toISOString());
  }
}
