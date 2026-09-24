import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, chmod, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CaseIdSchema, ReviewRequestSchema, type ResponseCase, type ReviewActor } from '../../shared/responseCase';
import { applyReviewCommand, createResponseCase, ResponseWorkflowError, validateStoredResponseCase } from './responseWorkflow';

const operations = new Map<string, Promise<unknown>>();
const MAX_RECORD_BYTES = 1024 * 1024;

export class ResponseWorkflowStore {
  readonly directory: string;
  constructor(directory = process.env.AEGISOPS_RESPONSE_STORE_PATH || '.runtime/response-cases') {
    this.directory = path.resolve(directory);
  }

  private filename(id: string): string {
    return path.join(this.directory, `${CaseIdSchema.parse(id)}.json`);
  }

  private async serialized<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const key = this.filename(id);
    const previous = operations.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    operations.set(key, pending);
    try { return await pending; }
    finally { if (operations.get(key) === pending) operations.delete(key); }
  }

  private async write(current: ResponseCase): Promise<void> {
    try { validateStoredResponseCase(current); }
    catch { throw new ResponseWorkflowError(500, '저장할 검토의 형식과 이력을 검증하지 못했습니다. 기존 검토는 변경하지 않았습니다.'); }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await chmod(this.directory, 0o700);
    const serialized = JSON.stringify(current);
    if (Buffer.byteLength(serialized) > MAX_RECORD_BYTES) throw new Error('case record too large');
    const temporary = path.join(this.directory, `.${current.id}.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(serialized, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, this.filename(current.id));
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  async create(input: unknown, actor: ReviewActor): Promise<ResponseCase> {
    const current = createResponseCase(input, randomUUID(), actor, new Date().toISOString());
    await this.serialized(current.id, () => this.write(current));
    return current;
  }

  async read(id: string): Promise<ResponseCase> {
    const filename = this.filename(id);
    let file;
    try { file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new ResponseWorkflowError(404, '저장된 검토를 찾을 수 없습니다.');
      }
      throw new ResponseWorkflowError(500, '검토 저장소를 읽을 수 없습니다.');
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) throw new Error('invalid case file');
      const current = validateStoredResponseCase(JSON.parse(await file.readFile('utf8')));
      if (current.id !== id) throw new Error('case ID mismatch');
      return current;
    } catch {
      throw new ResponseWorkflowError(500, '저장된 검토의 형식, 출처 또는 무결성을 확인할 수 없습니다.');
    } finally { await file.close(); }
  }

  async review(id: string, input: unknown, actor: ReviewActor): Promise<ResponseCase> {
    const request = ReviewRequestSchema.parse(input);
    return this.serialized(id, async () => {
      const current = await this.read(id);
      if (request.expectedRevision !== current.revision) {
        throw new ResponseWorkflowError(409, '다른 검토가 먼저 저장되었습니다. 최신 상태를 다시 불러오세요.');
      }
      const updated = applyReviewCommand(current, request.command, actor, new Date().toISOString());
      await this.write(updated);
      return updated;
    });
  }
}
