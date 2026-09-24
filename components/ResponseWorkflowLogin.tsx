import React, { useEffect, useRef, useState } from 'react';
import { ResponseWorkflowService } from '../services/ResponseWorkflowService';

export function ResponseWorkflowLogin({ initiallyOpen = false, tokenOnly = false, onAuthenticated }: {
  initiallyOpen?: boolean;
  tokenOnly?: boolean;
  onAuthenticated?: () => Promise<void>;
}) {
  const [authMode, setAuthMode] = useState<'token' | 'oidc'>('token');
  const [credential, setCredential] = useState('');
  const [roles, setRoles] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  return <details open={initiallyOpen || undefined} className="rounded-lg border border-border p-3 text-sm">
    <summary className="cursor-pointer">운영자 로그인 (인증 사용 서버)</summary>
    <form className="mt-3 space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      controller.current?.abort();
      const pending = new AbortController(); controller.current = pending;
      setBusy(true); setMessage('');
      let submittedCredential = credential; setCredential('');
      try {
        await ResponseWorkflowService.login(tokenOnly ? 'token' : authMode, submittedCredential, tokenOnly ? [] : roles.split(',').map((role) => role.trim()).filter(Boolean), pending.signal);
        submittedCredential = '';
        if (!pending.signal.aborted) {
          setMessage('로그인되었습니다. 검토 열기 또는 저장을 다시 시도하세요. 입력 토큰은 localStorage·sessionStorage·URL에 저장하지 않습니다. 인증에는 HttpOnly 쿠키를 사용합니다.');
          await onAuthenticated?.();
        }
      } catch (error) { if (!pending.signal.aborted) setMessage(error instanceof Error ? error.message : '로그인 실패'); }
      finally { submittedCredential = ''; if (!pending.signal.aborted) setBusy(false); }
    }}>
      <p>{tokenOnly ? '공유 토큰으로 합성 검토 작업 공간에 로그인하세요. 개인 승인이나 기관별 격리를 제공하지 않습니다. 입력 토큰은 브라우저 저장소나 URL에 보관하지 않습니다.' : '서버 관리자가 발급한 토큰 또는 OIDC ID 토큰을 입력하세요. 기본 loopback 합성 데모는 로그인이 필요 없습니다.'}</p>
      {!tokenOnly && <label className="block">인증 방식 <select value={authMode} onChange={(event) => setAuthMode(event.target.value === 'oidc' ? 'oidc' : 'token')} className="bg-bg border border-border p-2 rounded">
        <option value="token">공유 토큰</option><option value="oidc">OIDC</option>
      </select></label>}
      <label className="block">운영자 자격 증명 <input type="password" autoComplete="off" required value={credential} onChange={(event) => setCredential(event.target.value)} className="bg-bg border border-border p-2 rounded w-full" /></label>
      {!tokenOnly && <label className="block">역할 (공유 토큰에 필요한 경우, 쉼표 구분) <input value={roles} onChange={(event) => setRoles(event.target.value)} className="bg-bg border border-border p-2 rounded w-full" /></label>}
      <button disabled={busy || !credential.trim()} className="border border-accent rounded px-3 py-2 disabled:opacity-50">{busy ? '로그인 중' : '로그인'}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
