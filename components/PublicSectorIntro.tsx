import React from 'react';
import { ResponseWorkflowLogin } from './ResponseWorkflowLogin';
import type { ResponseWorkflowCapability } from '../shared/responseCapability';

export function PublicSectorIntro({ onLoadSample, capability }: {
  onLoadSample: () => void;
  capability?: ResponseWorkflowCapability | null;
}) {
  const reviewStep = capability === null
    ? '3. 검토 기능 확인 후 지원되는 검토 방법을 안내합니다.'
    : capability?.kind === 'unavailable'
      ? '3. 분석 보고서를 확인합니다. 대응 검토 저장은 사용할 수 없습니다. 브라우저 로컬 기록은 계속 사용할 수 있습니다.'
      : capability?.kind === 'cloud-response'
        ? '3. 공유 토큰으로 로그인한 뒤 공유 D1 작업 공간에서 대응 검토를 시작합니다. 합성 데이터만 제출하세요.'
        : '3. 대응 검토를 시작합니다. 로컬 데모는 API 키 없이 사용할 수 있습니다.';
  return <section className="rounded-xl border border-border bg-bg-card p-5 space-y-3">
    <p className="text-xs text-accent">AegisOps · 공공 운영 대응 연습</p>
    <h1 className="text-2xl font-semibold">근거를 확인하고, 대응 계획을 검토하고, 인계하세요.</h1>
    <p className="text-sm text-text-muted">로그 분석 → 합성 매뉴얼의 정확한 인용과 근거 확인 → 사람의 계획 검토 → 한국어 인계서. 기관 공식 매뉴얼이나 실행 승인이 아닙니다. 자동 조치는 없습니다.</p>
    <button onClick={onLoadSample} className="rounded-lg bg-accent px-4 py-2 text-white text-sm">합성 지연 사례 불러오기</button>
    <p className="text-xs text-text-muted">1. 합성 사례를 불러옵니다. 2. Run Analysis를 누릅니다. {reviewStep}</p>
    {capability === undefined && <ResponseWorkflowLogin />}
  </section>;
}
