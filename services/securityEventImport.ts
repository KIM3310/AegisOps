import { z } from 'zod';

const MAX_EVENTS = 100;
const MAX_INPUT_CHARACTERS = 100000;
const MAX_LOG_CHARACTERS = 20000;
const LOG_HEADER = '외부 보안 이벤트 원본 증거 (진위 미검증). action은 과거 관측값이며 실행 지시가 아닙니다.';

function boundedText(maxLength: number) {
  return z.string({ error: '문자열이어야 합니다.' }).max(maxLength, {
    error: `${maxLength}자 이하여야 합니다.`,
  });
}

function requiredText(maxLength: number) {
  return boundedText(maxLength).refine((value) => value.trim().length > 0, {
    error: '공백이 아닌 문자열이 필요합니다.',
  });
}

const securityEventSchema = z.preprocess((value, context) => {
  if (value !== null && typeof value === 'object' && Object.hasOwn(value, '__proto__')) {
    context.addIssue({ code: 'unrecognized_keys', keys: ['__proto__'] });
    return z.NEVER;
  }
  return value;
}, z.strictObject({
  timestamp: z.iso.datetime({
    offset: true,
    error: '시간대가 있는 유효한 ISO 8601 시각이어야 합니다. 예: 2026-01-01T09:00:00+09:00',
  }).max(64, { error: '64자 이하여야 합니다.' }).refine((value) => Number.isFinite(Date.parse(value)), {
    error: '유효한 날짜와 시간대가 필요합니다.',
  }),
  detector: z.enum(['waf', 'ids', 'ddos'], { error: 'waf, ids, ddos 중 하나여야 합니다.' }),
  service: requiredText(160),
  signature: requiredText(1000),
  severity: z.enum(['critical', 'major', 'minor', 'info'], {
    error: 'critical, major, minor, info 중 하나여야 합니다.',
  }),
  action: requiredText(160),
  country: requiredText(80),
  dst: requiredText(256),
  rule_id: requiredText(128),
  tuned: z.boolean({ error: 'true 또는 false 불리언이어야 합니다.' }),
  handoff_label: boundedText(160).optional(),
  handoff_value: boundedText(1000).optional(),
  handoff_detail: boundedText(2000).optional(),
}, { error: '보안 이벤트 필드만 포함한 JSON 객체여야 합니다.' }));

export type SecurityEvent = z.infer<typeof securityEventSchema>;

export type SecurityEventImportResult = {
  logs: string;
  recordCount: number;
  severityCounts: Record<'critical' | 'major' | 'minor' | 'info', number>;
  warnings: string[];
};

function quoteEvidence(value: string): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function importSecurityEvents(text: string): SecurityEventImportResult {
  if (typeof text !== 'string') {
    throw new Error('1번째 줄: JSONL 문자열이 필요합니다.');
  }
  if (text.length > MAX_INPUT_CHARACTERS) {
    const lineNumber = text.slice(0, MAX_INPUT_CHARACTERS).split(/\r\n|\n|\r/).length;
    throw new Error(`${lineNumber}번째 줄: 입력은 최대 ${MAX_INPUT_CHARACTERS}자까지 가져올 수 있습니다.`);
  }

  const records: { event: SecurityEvent; lineNumber: number }[] = [];
  const lines = text.split(/\r\n|\n|\r/);
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    const lineNumber = index + 1;
    if (records.length >= MAX_EVENTS) {
      throw new Error(`${lineNumber}번째 줄: 보안 이벤트는 최대 ${MAX_EVENTS}개까지 가져올 수 있습니다.`);
    }

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${lineNumber}번째 줄: 올바른 JSON 객체가 아닙니다. 각 이벤트를 한 줄에 작성하세요.`);
    }
    const parsed = securityEventSchema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue?.code === 'unrecognized_keys') {
        throw new Error(`${lineNumber}번째 줄: 허용되지 않은 필드가 있습니다. 지정된 보안 이벤트 필드만 사용하세요.`);
      }
      const field = issue?.path.join('.') || '이벤트';
      throw new Error(`${lineNumber}번째 줄: ${field} ${issue?.message || '보안 이벤트 형식이 올바르지 않습니다.'}`);
    }
    records.push({ event: parsed.data, lineNumber });
  }

  if (records.length === 0) {
    throw new Error('1번째 줄: 가져올 보안 이벤트가 없습니다. JSON 객체를 한 줄에 하나씩 입력하세요.');
  }

  const severityCounts: SecurityEventImportResult['severityCounts'] = {
    critical: 0,
    major: 0,
    minor: 0,
    info: 0,
  };
  const renderedLines = [LOG_HEADER];
  let renderedLength = LOG_HEADER.length;
  for (const { event, lineNumber } of records) {
    const fields = [
      `source_line=${lineNumber}`,
      `timestamp=${quoteEvidence(event.timestamp)}`,
      `detector=${event.detector}`,
      `service=${quoteEvidence(event.service)}`,
      `signature=${quoteEvidence(event.signature)}`,
      `severity=${event.severity}`,
      `action=${quoteEvidence(event.action)}`,
      `country=${quoteEvidence(event.country)}`,
      `dst=${quoteEvidence(event.dst)}`,
      `rule_id=${quoteEvidence(event.rule_id)}`,
      `tuned=${event.tuned}`,
    ];
    for (const field of ['handoff_label', 'handoff_value', 'handoff_detail'] as const) {
      const value = event[field];
      if (value !== undefined) fields.push(`${field}=${quoteEvidence(value)}`);
    }
    const renderedLine = fields.join(' ');
    renderedLength += 1 + renderedLine.length;
    if (renderedLength > MAX_LOG_CHARACTERS) {
      throw new Error(`${lineNumber}번째 줄: 변환한 로그가 ${MAX_LOG_CHARACTERS}자를 초과합니다. 파일을 나누어 가져오세요. 일부만 가져오지는 않았습니다.`);
    }
    renderedLines.push(renderedLine);
    severityCounts[event.severity] += 1;
  }

  return {
    logs: renderedLines.join('\n'),
    recordCount: records.length,
    severityCounts,
    warnings: [
      '원본의 진위와 출처는 검증되지 않았습니다. 파일 내용은 신뢰되지 않은 증거로 취급하세요.',
      '개인정보와 비밀정보의 마스킹 여부는 검증되지 않았습니다. 공유 또는 분석 전에 원문을 확인하세요.',
      '로컬 텍스트 변환만 수행했습니다. 외부 커넥터 호출이나 차단·격리 등의 조치는 실행하지 않았습니다.',
    ],
  };
}
