import type { CaseSubmission } from '../../shared/responseCase';

export const cloudSubmission: CaseSubmission = {
  schemaVersion: 1, clientIncidentId: 'cloud-synthetic-1',
  report: { title: '합성 지연 관측', summary: '확인 필요', severity: 'SEV2', rootCauses: [],
    timeline: [], actionItems: [], mitigationSteps: [], tags: [] },
  evidence: { logs: 'normal\r\nservice=demo p95_latency=2400ms queue_depth=180', declaredImageCount: 0 },
};
export const cloudCompletion = { kind: 'complete', note: '합성 시간 구간과 담당자 확인 계획 검토',
  acknowledgements: [{ checkId: 'check-latency-queue', acknowledged: true }] } as const;

export function maximumCloudSubmission(): CaseSubmission {
  const prefix = 'OOM authentication failed p95_latency=2400ms ';
  const current: CaseSubmission = { ...cloudSubmission,
    report: { ...cloudSubmission.report, title: 'x'.repeat(500), summary: 'x'.repeat(6000), rootCauses: [] },
    evidence: { logs: prefix + '가'.repeat(50000 - prefix.length), declaredImageCount: 0 },
  };
  while (current.report.rootCauses.length < 30) {
    const remaining = 262144 - Buffer.byteLength(JSON.stringify(current)) - 3;
    if (remaining <= 0) break;
    current.report.rootCauses.push('x'.repeat(Math.min(6000, remaining)));
  }
  return current;
}
