import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaseSubmissionSchema } from '../shared/responseCase';
import { createResponseCase } from '../server/lib/responseWorkflow';
import { ResponseWorkflowService } from '../services/ResponseWorkflowService';

const sample = CaseSubmissionSchema.parse(JSON.parse(readFileSync('samples/response-workflow.synthetic.json', 'utf8')));
afterEach(() => vi.unstubAllGlobals());

describe('client workflow input boundary', () => {
  it.each([
    ['50001 characters', 'x'.repeat(50001)],
    ['1001 short lines', Array(1001).fill('x').join('\n')],
  ])('rejects %s before network with an actionable re-analysis message', async (_name, logs) => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('invalid snapshot must not be sent'));
    vi.stubGlobal('fetch', fetchMock);
    const submission = { ...sample, evidence: { ...sample.evidence, logs } };
    await expect(ResponseWorkflowService.create(submission, new AbortController().signal)).rejects.toMatchObject({
      status: 400, message: expect.stringContaining('50,000자·1,000줄'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(submission.evidence.logs).toBe(logs);
  });

  it.each([
    ['50000 characters', 'x'.repeat(50000)],
    ['1000 short lines', Array(1000).fill('x').join('\n')],
  ])('submits %s without silently trimming evidence', async (_name, logs) => {
    const submission = { ...sample, evidence: { ...sample.evidence, logs } };
    const saved = createResponseCase(submission, '123e4567-e89b-42d3-a456-426614174000', { kind: 'local-demo' }, '2026-01-15T00:00:00.000Z');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await ResponseWorkflowService.create(submission, new AbortController().signal);
    expect(result).toEqual(saved);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(submission.evidence.logs).toBe(logs);
    expect(fetchMock).toHaveBeenCalledWith('/api/response-workflows', expect.objectContaining({
      method: 'POST', body: JSON.stringify(submission),
    }));
  });
});
