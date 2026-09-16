import { z } from 'zod';

const entrySchema = z.strictObject({
  sourceId: z.string(), version: z.literal('1.0.0'), sectionId: z.string(),
  title: z.string(), quote: z.string(), authority: z.literal('synthetic-demo'), sourcePath: z.string(),
  pattern: z.enum(['latency', 'pressure', 'security']),
  instruction: z.string(), verify: z.string(),
  risk: z.enum(['read-only-check', 'requires-change-approval']), caution: z.string(),
});

export const SAMPLE_MANUALS = Object.freeze(z.array(entrySchema).parse([
  {
    sourceId: 'demo-operations', version: '1.0.0', sectionId: 'latency-queue',
    title: '합성 운영 점검 예시: 지연 및 대기열', authority: 'synthetic-demo',
    sourcePath: 'knowledge/sampleManuals.ts#latency-queue', pattern: 'latency',
    quote: '지연 또는 대기열 포화가 관측되면 같은 시간대의 요청량, 응답 지연, 대기열 길이를 읽기 전용으로 비교한다. 원인을 단정하지 않으며 설정 변경은 별도 승인 절차를 따른다.',
    instruction: '근거 시각의 요청량, 응답 지연과 대기열 길이를 기존 대시보드에서 비교할 계획을 검토하세요.',
    verify: '확인할 지표, 시간 구간과 담당자를 인계 메모에 기록하세요. 실제 확인 결과는 별도로 수집해야 합니다.',
    risk: 'read-only-check', caution: '읽기 전용 확인 계획입니다. 재시작, 우회 또는 설정 변경을 실행하지 않습니다.',
  },
  {
    sourceId: 'demo-operations', version: '1.0.0', sectionId: 'resource-pressure',
    title: '합성 운영 점검 예시: 메모리 및 저장소', authority: 'synthetic-demo',
    sourcePath: 'knowledge/sampleManuals.ts#resource-pressure', pattern: 'pressure',
    quote: '메모리 부족이나 저장소 포화가 관측되면 사용량 추이와 오류 시각을 비교한다. 파일 삭제, 증설, 재시작은 영향 평가와 변경 승인 없이는 수행하지 않는다.',
    instruction: '메모리·저장소 사용량 추이와 오류 시각의 비교 계획 및 별도 변경 승인 필요성을 검토하세요.',
    verify: '영향 범위, 남은 용량 및 확인 담당자를 기록하고 변경 전 승인 필요성을 인계하세요.',
    risk: 'requires-change-approval', caution: '삭제·증설·재시작은 이 검토의 대상 작업이 아닙니다. 별도 변경 승인이 필요합니다.',
  },
  {
    sourceId: 'demo-security', version: '1.0.0', sectionId: 'auth-threat',
    title: '합성 보안 점검 예시: 인증 및 위협 이벤트', authority: 'synthetic-demo',
    sourcePath: 'knowledge/sampleManuals.ts#auth-threat', pattern: 'security',
    quote: '인증 실패 또는 보안 탐지 이벤트는 원본 시각, 탐지 규칙, 대상과 과거 관측 조치를 확인한다. 탐지는 침해 확정이 아니며 계정 차단과 정책 변경에는 별도 승인이 필요하다.',
    instruction: '탐지 시각, 규칙, 대상과 인증 기록을 대조할 계획을 검토하세요. 탐지만으로 침해를 확정하지 마세요.',
    verify: '원본 진위와 개인정보 마스킹 여부, 추가 확인 담당자를 인계 메모에 기록하세요.',
    risk: 'read-only-check', caution: '입력 action은 과거 관측값입니다. 계정 차단이나 외부 보안 연동을 실행하지 않습니다.',
  },
]).map((entry) => Object.freeze(entry)));

export const PUBLIC_SECTOR_SAMPLE_LOGS = '[synthetic-demo] 2026-01-15T09:00:00+09:00 service=demo-api p95_latency=2400ms queue_depth=180\n[synthetic-demo] 2026-01-15T09:01:00+09:00 service=demo-api queue saturation observed';
