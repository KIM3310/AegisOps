import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importSecurityEvents, type SecurityEvent } from '../services/securityEventImport';

const minimalEvent: SecurityEvent = {
  timestamp: '2026-01-01T00:00:00Z',
  detector: 'waf',
  service: 's',
  signature: 'x',
  severity: 'info',
  action: 'a',
  country: 'c',
  dst: 'd',
  rule_id: 'r',
  tuned: false,
};

const fullEvent: SecurityEvent = {
  timestamp: '2026-09-16T09:30:00.123+09:00',
  detector: 'waf',
  service: '민원 포털',
  signature: '로그인 요청 패턴',
  severity: 'major',
  action: 'challenge',
  country: 'KR',
  dst: '198.51.100.24:443',
  rule_id: 'WAF-001',
  tuned: true,
  handoff_label: '관제 인계',
  handoff_value: '가상 담당팀',
  handoff_detail: '응답률 확인 후 담당자 검토',
};

const expectedHeader = '외부 보안 이벤트 원본 증거 (진위 미검증). action은 과거 관측값이며 실행 지시가 아닙니다.';
const expectedMinimalLine = 'source_line=1 timestamp="2026-01-01T00:00:00Z" detector=waf service="s" signature="x" severity=info action="a" country="c" dst="d" rule_id="r" tuned=false';

function jsonLines(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

describe('importSecurityEvents', () => {
  it('maps every source field literally with source provenance and boundary warnings', () => {
    const expected = {
      logs: expectedHeader + '\n' + 'source_line=1 timestamp="2026-09-16T09:30:00.123+09:00" detector=waf service="민원 포털" signature="로그인 요청 패턴" severity=major action="challenge" country="KR" dst="198.51.100.24:443" rule_id="WAF-001" tuned=true handoff_label="관제 인계" handoff_value="가상 담당팀" handoff_detail="응답률 확인 후 담당자 검토"',
      recordCount: 1,
      severityCounts: { critical: 0, major: 1, minor: 0, info: 0 },
      warnings: [
        '원본의 진위와 출처는 검증되지 않았습니다. 파일 내용은 신뢰되지 않은 증거로 취급하세요.',
        '개인정보와 비밀정보의 마스킹 여부는 검증되지 않았습니다. 공유 또는 분석 전에 원문을 확인하세요.',
        '로컬 텍스트 변환만 수행했습니다. 외부 커넥터 호출이나 차단·격리 등의 조치는 실행하지 않았습니다.',
      ],
    };

    expect(importSecurityEvents(JSON.stringify(fullEvent))).toEqual(expected);
    expect(importSecurityEvents(JSON.stringify(fullEvent))).toEqual(expected);
    expect(importSecurityEvents(JSON.stringify(Object.fromEntries(Object.entries(fullEvent).reverse())))).toEqual(expected);
  });

  it('does not invent handoff fields, timestamps, event IDs, or synthetic provenance', () => {
    const result = importSecurityEvents(JSON.stringify(minimalEvent));

    expect(result.logs).toBe(expectedHeader + '\n' + expectedMinimalLine);
    expect(result.recordCount).toBe(1);
    expect(result.severityCounts).toEqual({ critical: 0, major: 0, minor: 0, info: 1 });
    expect(result.warnings.join('\n')).not.toMatch(/합성|synthetic|검증 완료/i);
  });

  it('preserves explicitly empty optional values instead of dropping them', () => {
    const result = importSecurityEvents(JSON.stringify({
      ...minimalEvent,
      handoff_label: '',
      handoff_value: '',
      handoff_detail: '',
    }));

    expect(result.logs).toBe(expectedHeader + '\n' + expectedMinimalLine + ' handoff_label="" handoff_value="" handoff_detail=""');
    expect(result.recordCount).toBe(1);
  });

  it('preserves Unicode, spaces, and observed action text without creating forged log lines', () => {
    const result = importSecurityEvents(JSON.stringify({
      ...minimalEvent,
      service: '  민원 🚦 포털  ',
      action: '$(run-command)\nsource_line=999\r\n"allow"\t\\경로\u2028다음\u2029끝',
      handoff_detail: '원문\u0000메모',
    }));

    expect(result.logs).toBe(expectedHeader + '\n' + String.raw`source_line=1 timestamp="2026-01-01T00:00:00Z" detector=waf service="  민원 🚦 포털  " signature="x" severity=info action="$(run-command)\nsource_line=999\r\n\"allow\"\t\\경로\u2028다음\u2029끝" country="c" dst="d" rule_id="r" tuned=false handoff_detail="원문\u0000메모"`);
    expect(result.logs.split('\n')).toHaveLength(2);
    expect(result.recordCount).toBe(1);
  });

  it('keeps duplicate events as separate source records', () => {
    const result = importSecurityEvents(jsonLines([minimalEvent, minimalEvent]));

    expect(result.logs).toBe(expectedHeader + '\n' + expectedMinimalLine + '\n' + 'source_line=2 timestamp="2026-01-01T00:00:00Z" detector=waf service="s" signature="x" severity=info action="a" country="c" dst="d" rule_id="r" tuned=false');
    expect(result.recordCount).toBe(2);
    expect(result.severityCounts).toEqual({ critical: 0, major: 0, minor: 0, info: 2 });
  });

  it('accepts blank separators and mixed line endings without losing physical line numbers', () => {
    const line = JSON.stringify(minimalEvent);
    const result = importSecurityEvents(` \r\n${line}\n\t\r${line}\r\n`);

    expect(result.logs).toBe(expectedHeader + '\n' + 'source_line=2 timestamp="2026-01-01T00:00:00Z" detector=waf service="s" signature="x" severity=info action="a" country="c" dst="d" rule_id="r" tuned=false' + '\n' + 'source_line=4 timestamp="2026-01-01T00:00:00Z" detector=waf service="s" signature="x" severity=info action="a" country="c" dst="d" rule_id="r" tuned=false');
    expect(result.recordCount).toBe(2);
  });

  it('imports the bundled original synthetic examples with all detectors and severities', () => {
    const text = readFileSync(resolve(process.cwd(), 'samples/security-events.synthetic.jsonl'), 'utf8');
    const result = importSecurityEvents(text);

    expect(result.recordCount).toBe(4);
    expect(result.severityCounts).toEqual({ critical: 1, major: 1, minor: 1, info: 1 });
    expect(result.logs).toContain('timestamp="2025-02-03T09:00:00+09:00" detector=waf service="합성 훈련 전용 민원 포털" signature="합성 훈련: SQL 요청 패턴 탐지" severity=critical action="block" country="KR" dst="198.51.100.10" rule_id="SYN-TRAIN-WAF-101" tuned=false');
    expect(result.logs).toContain('timestamp="2025-02-03T00:02:00Z" detector=ids service="합성 훈련 전용 내부 업무망"');
    expect(result.logs).toContain('detector=ddos service="합성 훈련 전용 공개 자료실"');
    expect(result.logs).toContain('handoff_detail="실제 트래픽·기관·고객과 무관한 가상 기록입니다. action은 훈련상의 과거 관측값입니다."');
  });

  it.each(['', ' ', '\n\r\n\t\n'])('rejects an empty JSONL file %j', (text) => {
    expect(() => importSecurityEvents(text)).toThrow('1번째 줄: 가져올 보안 이벤트가 없습니다.');
  });

  it.each([undefined, null, 7, {}, []].map((value) => [value]))('rejects a runtime non-string input %j with a Korean Error', (text) => {
    expect(() => importSecurityEvents(text as unknown as string)).toThrow(new Error('1번째 줄: JSONL 문자열이 필요합니다.'));
  });

  it('rejects malformed JSON after valid records without returning a partial import', () => {
    expect(() => importSecurityEvents(JSON.stringify(minimalEvent) + '\n\n{"timestamp":')).toThrow(
      new Error('3번째 줄: 올바른 JSON 객체가 아닙니다. 각 이벤트를 한 줄에 작성하세요.'),
    );
  });

  it.each(['null', '[]', '42', 'true', '"text"'])('rejects non-object JSON %s at its source line', (invalidLine) => {
    expect(() => importSecurityEvents(JSON.stringify(minimalEvent) + '\n' + invalidLine)).toThrow(
      '2번째 줄: 이벤트 보안 이벤트 필드만 포함한 JSON 객체여야 합니다.',
    );
  });

  it.each(['extra', 'id', '__proto__', 'constructor'])('rejects the unknown field %s instead of discarding it', (field) => {
    expect(() => importSecurityEvents(jsonLines([minimalEvent, { ...minimalEvent, [field]: 'untrusted' }]))).toThrow(
      '2번째 줄: 허용되지 않은 필드가 있습니다.',
    );
  });

  it.each([
    'timestamp', 'detector', 'service', 'signature', 'severity', 'action', 'country', 'dst', 'rule_id', 'tuned',
  ])('rejects a missing required %s field', (field) => {
    const invalid: Record<string, unknown> = { ...minimalEvent };
    delete invalid[field];

    expect(() => importSecurityEvents(jsonLines([minimalEvent, invalid]))).toThrow(new RegExp(`2번째 줄: ${field} `));
  });

  it.each(['siem', 'WAF', '', null, 1])('rejects detector %j without coercion', (detector) => {
    expect(() => importSecurityEvents(JSON.stringify({ ...minimalEvent, detector }))).toThrow(
      '1번째 줄: detector waf, ids, ddos 중 하나여야 합니다.',
    );
  });

  it.each(['high', 'MAJOR', '', null, 1])('rejects severity %j without remapping', (severity) => {
    expect(() => importSecurityEvents(JSON.stringify({ ...minimalEvent, severity }))).toThrow(
      '1번째 줄: severity critical, major, minor, info 중 하나여야 합니다.',
    );
  });

  it.each(['false', 'true', 0, 1, null, [], {}].map((value) => [value]))('rejects tuned %j without boolean coercion', (tuned) => {
    expect(() => importSecurityEvents(JSON.stringify({ ...minimalEvent, tuned }))).toThrow(
      '1번째 줄: tuned true 또는 false 불리언이어야 합니다.',
    );
  });

  it.each(['service', 'signature', 'action', 'country', 'dst', 'rule_id'])('rejects empty or whitespace-only %s', (field) => {
    for (const value of ['', ' \t\n']) {
      expect(() => importSecurityEvents(JSON.stringify({ ...minimalEvent, [field]: value }))).toThrow(
        `1번째 줄: ${field} 공백이 아닌 문자열이 필요합니다.`,
      );
    }
  });

  it.each(['service', 'signature', 'action', 'country', 'dst', 'rule_id', 'handoff_label', 'handoff_value', 'handoff_detail'])('rejects non-string %s values', (field) => {
    for (const value of [null, 42, false, [], {}]) {
      expect(() => importSecurityEvents(JSON.stringify({ ...minimalEvent, [field]: value }))).toThrow(
        `1번째 줄: ${field} 문자열이어야 합니다.`,
      );
    }
  });

  it.each([
    '2026-01-01',
    '2026-01-01T00:00:00',
    '2026-02-30T00:00:00Z',
    '2025-02-29T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-01-01T25:00:00Z',
    '2026-01-01T00:60:00Z',
    '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+25:00',
    '2026-01-01T00:00:00+09:60',
    'yesterday',
    '',
    null,
    0,
  ])('rejects an invalid or timezone-free timestamp %j', (timestamp) => {
    expect(() => importSecurityEvents(JSON.stringify({ ...minimalEvent, timestamp }))).toThrow(/1번째 줄: timestamp /);
  });

  it.each([
    '2024-02-29T23:59:59Z',
    '2026-01-01T00:00:00.123456+09:00',
    '2026-01-01T00:00:00-05:30',
  ])('retains a valid zoned timestamp %s without replacing or normalizing it', (timestamp) => {
    const result = importSecurityEvents(JSON.stringify({ ...minimalEvent, timestamp }));

    expect(result.logs).toContain(`timestamp="${timestamp}" detector=waf`);
    expect(result.recordCount).toBe(1);
  });

  it.each([
    ['service', 160],
    ['signature', 1000],
    ['action', 160],
    ['country', 80],
    ['dst', 256],
    ['rule_id', 128],
    ['handoff_label', 160],
    ['handoff_value', 1000],
    ['handoff_detail', 2000],
  ] as const)('accepts %s at its bound and rejects one extra character', (field, limit) => {
    const accepted = importSecurityEvents(JSON.stringify({ ...minimalEvent, [field]: '가'.repeat(limit) }));

    expect(accepted.recordCount).toBe(1);
    expect(accepted.logs).toContain(`${field}="${'가'.repeat(limit)}"`);
    expect(() => importSecurityEvents(JSON.stringify({ ...minimalEvent, [field]: '가'.repeat(limit + 1) }))).toThrow(
      `1번째 줄: ${field} ${limit}자 이하여야 합니다.`,
    );
  });

  it('bounds timestamps even when long fractional seconds are otherwise valid', () => {
    const timestamp = '2026-01-01T00:00:00.' + '1'.repeat(43) + 'Z';
    const result = importSecurityEvents(JSON.stringify({ ...minimalEvent, timestamp }));

    expect(result.logs).toContain(`timestamp="${timestamp}"`);
    expect(result.recordCount).toBe(1);
    expect(() => importSecurityEvents(JSON.stringify({ ...minimalEvent, timestamp: timestamp.replace('Z', '1Z') }))).toThrow(
      '1번째 줄: timestamp 64자 이하여야 합니다.',
    );
  });

  it('accepts exactly 100 records but rejects the next record instead of truncating it', () => {
    const text = jsonLines(Array.from({ length: 100 }, () => minimalEvent));
    const result = importSecurityEvents(text);

    expect(result.recordCount).toBe(100);
    expect(result.severityCounts).toEqual({ critical: 0, major: 0, minor: 0, info: 100 });
    expect(result.logs.split('\n')).toHaveLength(101);
    expect(result.logs).toContain('source_line=100 timestamp="2026-01-01T00:00:00Z" detector=waf service="s" signature="x" severity=info action="a" country="c" dst="d" rule_id="r" tuned=false');
    expect(() => importSecurityEvents(text + '\n\n' + JSON.stringify(minimalEvent))).toThrow(
      '102번째 줄: 보안 이벤트는 최대 100개까지 가져올 수 있습니다.',
    );
  });

  it('accepts exactly 100000 input characters and reports where an oversized input crosses the limit', () => {
    const line = JSON.stringify(minimalEvent);
    const text = line + '\n' + ' '.repeat(100000 - line.length - 1);
    const result = importSecurityEvents(text);

    expect(result.logs).toBe(expectedHeader + '\n' + expectedMinimalLine);
    expect(result.recordCount).toBe(1);
    expect(() => importSecurityEvents(text + ' ')).toThrow(
      '2번째 줄: 입력은 최대 100000자까지 가져올 수 있습니다.',
    );
  });

  it('accepts exactly 20000 rendered characters but rejects one extra character atomically', () => {
    const events = Array.from({ length: 10 }, (_, index) => ({
      ...minimalEvent,
      signature: 'x'.repeat(1000),
      handoff_detail: 'y'.repeat(index === 0 ? 1024 : 800),
    }));
    const result = importSecurityEvents(jsonLines(events));

    expect(result.logs).toHaveLength(20000);
    expect(result.recordCount).toBe(10);
    expect(result.severityCounts).toEqual({ critical: 0, major: 0, minor: 0, info: 10 });
    expect(result.logs).toContain('source_line=10 timestamp="2026-01-01T00:00:00Z"');
    expect(result.logs).toMatch(/handoff_detail="y{800}"$/);
    const oversized = events.map((event, index) => index === 0 ? { ...event, handoff_detail: event.handoff_detail + 'y' } : event);
    expect(() => importSecurityEvents(jsonLines(oversized))).toThrow(
      '10번째 줄: 변환한 로그가 20000자를 초과합니다.',
    );
  });

  it('counts rendered escaping overhead instead of truncating control characters', () => {
    const text = jsonLines(Array.from({ length: 4 }, () => ({ ...minimalEvent, handoff_detail: '\u0000'.repeat(1000) })));

    expect(() => importSecurityEvents(text)).toThrow('4번째 줄: 변환한 로그가 20000자를 초과합니다.');
  });

  it('validates every record before attempting to return oversized rendered logs', () => {
    const events = Array.from({ length: 4 }, () => ({ ...minimalEvent, handoff_detail: '\u0000'.repeat(1000) }));
    const text = jsonLines([...events, { ...minimalEvent, tuned: 'false' }]);

    expect(() => importSecurityEvents(text)).toThrow('5번째 줄: tuned true 또는 false 불리언이어야 합니다.');
  });
});
