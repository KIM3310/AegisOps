
import React from 'react';
import { Shield, BrainCircuit } from 'lucide-react';
import type { ResponseWorkflowCapability } from '../shared/responseCapability';

interface DeploymentBannersProps {
  isStaticDemo: boolean | undefined;
  isOllamaMode: boolean | undefined;
  responseWorkflow?: ResponseWorkflowCapability | null;
}

export function DeploymentBanners({ isStaticDemo, isOllamaMode, responseWorkflow }: DeploymentBannersProps) {
  return (
    <>
      {isStaticDemo && (
        <div className="rounded-lg border border-border bg-bg-card/90 p-4 space-y-2">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-accent" />
            {responseWorkflow?.kind === 'cloud-response' ? '브라우저 합성 분석 · 클라우드 대응 검토' : 'Static demo deployment'}
          </div>
          <p className="text-2xs text-text-muted">
            {responseWorkflow?.kind === 'cloud-response'
              ? '분석은 브라우저의 합성 예시입니다. 대응 검토만 토큰 로그인 후 공유 D1 작업 공간에 저장합니다. 합성 데이터만 사용하세요. 실시간 모델과 런타임 키 설정은 지원하지 않습니다. 요청은 같은 출처 API로 전송될 수 있습니다.'
              : '이 페이지는 브라우저 합성 분석과 로컬 보고서 기록을 지원합니다. 대응 검토 저장은 사용할 수 없습니다. 실시간 모델과 런타임 키 설정에는 별도로 구성한 API가 필요합니다.'}
          </p>
        </div>
      )}

      {isOllamaMode && (
        <div className="rounded-lg border border-border bg-bg-card/90 p-4 space-y-2">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <BrainCircuit className="w-3.5 h-3.5 text-accent" />
            Ollama Local Mode
          </div>
          <p className="text-2xs text-text-muted">
            로컬 Ollama 모델로 동작 중입니다. 외부 API 키 없이 오프라인 데모가 가능합니다.
          </p>
        </div>
      )}
    </>
  );
}
