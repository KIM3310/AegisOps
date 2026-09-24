import { useCallback, useEffect, useRef, useState } from 'react';
import { CaseIdSchema, type CaseSubmission, type ResponseCase, type ReviewCommand } from '../shared/responseCase';
import { ResponseWorkflowHttpError, ResponseWorkflowService, type CloudSession, type ResponseExportFormat } from '../services/ResponseWorkflowService';
import type { ResponseWorkflowCapability } from '../shared/responseCapability';

const LAST_CASE_KEY = 'aegisops:last-response-case-id';
function readLastId(): string | null {
  try { const parsed = CaseIdSchema.safeParse(localStorage.getItem(LAST_CASE_KEY)); return parsed.success ? parsed.data : null; }
  catch { return null; }
}

type WorkflowView = { identity: string; responseCase: ResponseCase | null; busy: boolean; error: string | null; authNeeded: boolean };

type SessionView = { kind: 'checking' } | { kind: 'inactive' }
  | { kind: 'active'; session: Extract<CloudSession, { active: true }> }
  | { kind: 'error'; message: string };

export function useResponseWorkflow(submission: CaseSubmission | null, capability?: ResponseWorkflowCapability | null) {
  const isCloud = capability?.kind === 'cloud-response';
  const sessionRequest = useRef<AbortController | null>(null);
  const [session, setSession] = useState<SessionView>({ kind: 'checking' });
  const identity = JSON.stringify(submission);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const active = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const [view, setView] = useState<WorkflowView>({ identity, responseCase: null, busy: false, error: null, authNeeded: false });
  const [lastCaseId, setLastCaseId] = useState(readLastId);

  const refreshSession = useCallback(async (logout = false) => {
    if (!isCloud) return;
    sessionRequest.current?.abort();
    const controller = new AbortController();
    sessionRequest.current = controller;
    setSession({ kind: 'checking' });
    try {
      if (logout) await ResponseWorkflowService.logout(controller.signal);
      const result: CloudSession = logout ? { active: false } : await ResponseWorkflowService.session(controller.signal);
      if (controller.signal.aborted) return;
      setSession(result.active ? { kind: 'active', session: result } : { kind: 'inactive' });
      if (result.active) setView((previous) => ({ ...previous, authNeeded: false }));
    } catch (error) {
      if (!controller.signal.aborted) setSession({ kind: 'error', message: `검토 세션 확인 실패. ${error instanceof Error ? error.message : '연결을 확인하세요.'}` });
    }
  }, [isCloud]);

  useEffect(() => {
    void refreshSession();
    return () => sessionRequest.current?.abort();
  }, [refreshSession]);

  useEffect(() => {
    setView({ identity, responseCase: null, busy: false, error: null, authNeeded: false });
    return () => { active.current?.abort(); sequence.current += 1; };
  }, [identity]);

  const visible = view.identity === identity ? view : { identity, responseCase: null, busy: false, error: null, authNeeded: false };
  const available = capability !== null && capability?.kind !== 'unavailable'
    && (!isCloud || (session.kind === 'active' && !visible.authNeeded));

  async function run(operation: (signal: AbortSignal, isCurrent: () => boolean) => Promise<ResponseCase | void>, conflictId?: string) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const requestSequence = ++sequence.current;
    const isCurrent = () => !controller.signal.aborted && currentIdentity.current === identity && sequence.current === requestSequence;
    setView((previous) => ({ ...previous, identity, busy: true, error: null, authNeeded: false }));
    try {
      const result = await operation(controller.signal, isCurrent);
      if (!isCurrent()) return;
      if (result) {
        let storageWarning: string | null = null;
        try { localStorage.setItem(LAST_CASE_KEY, result.id); }
        catch { storageWarning = '브라우저에 최근 ID를 저장하지 못했습니다. 검토 ID를 별도로 보관하세요. 서버 검토는 저장되었습니다.'; }
        setLastCaseId(result.id);
        setView({ identity, responseCase: result, busy: false, error: storageWarning, authNeeded: false });
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (isCloud && error instanceof ResponseWorkflowHttpError && error.status === 403) setSession({ kind: 'inactive' });
      if (error instanceof ResponseWorkflowHttpError && error.status === 409 && conflictId) {
        setView({ identity, responseCase: null, busy: true, error: null, authNeeded: false });
        try {
          const fresh = await ResponseWorkflowService.read(conflictId, controller.signal);
          if (isCurrent()) setView({ identity, responseCase: fresh, busy: false,
            error: '다른 검토가 먼저 저장되었습니다. 서버의 최신 상태를 다시 불러왔습니다. 내용을 다시 확인하세요.', authNeeded: false });
        } catch (reloadError) {
          if (isCurrent() && isCloud && reloadError instanceof ResponseWorkflowHttpError && reloadError.status === 403) setSession({ kind: 'inactive' });
          if (isCurrent()) setView({ identity, responseCase: null, busy: false,
            error: `충돌 후 새로고침 실패: ${reloadError instanceof Error ? reloadError.message : '연결 실패'}`,
            authNeeded: reloadError instanceof ResponseWorkflowHttpError && reloadError.status === 403 });
        }
      } else {
        setView((previous) => ({ ...previous, error: error instanceof Error ? error.message : '검토 요청 실패',
          authNeeded: error instanceof ResponseWorkflowHttpError && error.status === 403 }));
      }
    } finally {
      if (isCurrent()) setView((previous) => ({ ...previous, busy: false }));
    }
  }

  return {
    ...visible, lastCaseId, available, session: isCloud ? session : null,
    refreshSession: () => refreshSession(),
    logout: () => refreshSession(true),
    create: () => available && submission ? run((signal) => ResponseWorkflowService.create(submission, signal)) : Promise.resolve(),
    reopen: (id: string) => {
      if (!available || (submission && visible.responseCase?.id !== id)) return Promise.resolve();
      setView((previous) => ({ ...previous, responseCase: null }));
      return run((signal) => ResponseWorkflowService.read(id, signal));
    },
    review: (command: ReviewCommand) => {
      const current = visible.responseCase;
      return available && current ? run((signal) => ResponseWorkflowService.review(current.id, { expectedRevision: current.revision, command }, signal), current.id) : Promise.resolve();
    },
    download: (format: ResponseExportFormat) => {
      const current = visible.responseCase;
      return available && current ? run(async (signal, isCurrent) => {
        const blob = await ResponseWorkflowService.export(current.id, format, signal);
        if (!isCurrent()) return;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `response-${current.id}-${format}.${format === 'markdown' ? 'md' : 'json'}`;
        anchor.click();
        URL.revokeObjectURL(url);
      }) : Promise.resolve();
    },
  };
}
