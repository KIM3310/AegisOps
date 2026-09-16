import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { CaseIdSchema, CaseSubmissionSchema, ReviewRequestSchema, type ReviewActor } from '../../shared/responseCase';
import { validateOperatorAccess } from '../lib/operatorAccess';
import { getOperatorSessionCookieName } from '../lib/operatorSession';
import { renderResponseExport, ResponseWorkflowError } from '../lib/responseWorkflow';
import { ResponseWorkflowStore } from '../lib/responseWorkflowStore';

export const RESPONSE_WORKFLOW_MAX_BODY_BYTES = 256 * 1024;
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function createResponseWorkflowsRouter(store = new ResponseWorkflowStore()): express.Router {
  const router = express.Router();
  const mutationLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { message: '검토 요청이 많습니다. 잠시 후 다시 시도하세요.' } } });
  router.use((req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    void (async () => {
      const access = await validateOperatorAccess(req);
      if (!access.ok) throw new ResponseWorkflowError(403, '운영자 로그인이 필요합니다. 자격 증명 또는 역할을 확인하세요.');
      let actor: ReviewActor;
      if (access.authMode === 'none') {
        if (!loopbackAddresses.has(req.socket.remoteAddress || '') || !loopbackHosts.has(req.hostname.toLowerCase())) {
          throw new ResponseWorkflowError(403, '키 없는 합성 데모는 loopback 로컬 연결에서만 사용할 수 있습니다.');
        }
        actor = { kind: 'local-demo' };
      } else if (access.authMode === 'token') actor = { kind: 'shared-token' };
      else if (access.authMode === 'oidc' && access.subject) actor = { kind: 'oidc', subject: access.subject };
      else throw new ResponseWorkflowError(403, '검증된 운영자 식별자가 필요합니다.');
      res.locals.responseActor = actor;
      if (req.method === 'POST') {
        const origin = req.get('origin');
        const hasCookie = (req.get('cookie') || '').split(';').some((part) => part.trim().startsWith(`${getOperatorSessionCookieName()}=`));
        if (req.get('sec-fetch-site') === 'cross-site' || (hasCookie && !origin)
          || (origin && origin !== `${req.protocol}://${req.get('host')}`)) {
          throw new ResponseWorkflowError(403, '동일 출처에서만 검토를 저장할 수 있습니다.');
        }
      }
      next();
    })().catch(next);
  });
  router.use(express.json({ limit: RESPONSE_WORKFLOW_MAX_BODY_BYTES }));
  router.post('/', mutationLimit, (req, res, next) => {
    void (async () => {
      const input = CaseSubmissionSchema.parse(req.body);
      const result = await store.create(input, res.locals.responseActor);
      res.status(201).json(result);
    })().catch(next);
  });
  router.get('/:id', (req, res, next) => {
    void (async () => { res.json(await store.read(CaseIdSchema.parse(req.params.id))); })().catch(next);
  });
  router.post('/:id/review', mutationLimit, (req, res, next) => {
    void (async () => {
      const id = CaseIdSchema.parse(req.params.id);
      const request = ReviewRequestSchema.parse(req.body);
      res.json(await store.review(id, request, res.locals.responseActor));
    })().catch(next);
  });
  router.get('/:id/export', (req, res, next) => {
    void (async () => {
      const id = CaseIdSchema.parse(req.params.id);
      const query = z.strictObject({ format: z.enum(['markdown', 'json', 'hancom-json']).default('markdown') }).parse(req.query);
      const current = await store.read(id);
      const extension = query.format === 'markdown' ? 'md' : 'json';
      res.setHeader('content-disposition', `attachment; filename="response-${id}-${query.format}.${extension}"`);
      res.type(query.format === 'markdown' ? 'text/markdown' : 'application/json');
      res.send(renderResponseExport(current, query.format, new Date().toISOString()));
    })().catch(next);
  });
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof z.ZodError ? 400 : error instanceof ResponseWorkflowError ? error.status
      : error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large' ? 413 : 500;
    const message = error instanceof z.ZodError ? '검토 입력 형식 또는 버전이 올바르지 않습니다.'
      : error instanceof ResponseWorkflowError ? error.message : '검토를 안전하게 읽거나 저장하지 못했습니다. 성공한 검토로 처리하지 않았습니다.';
    res.status(status).json({ error: { message } });
  });
  return router;
}
