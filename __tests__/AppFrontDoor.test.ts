import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockHealthz,
  mockReplayOverview,
  mockProviderComparison,
  mockSummaryPack,
  mockServiceMeta,
  mockReportSchema,
} = vi.hoisted(() => ({
  mockHealthz: {
    ok: true,
    service: 'aegisops-static-demo',
    deployment: 'static-demo' as const,
    mode: 'demo' as const,
    provider: 'demo' as const,
    keySource: 'none' as const,
    keyConfigured: false,
    limits: { maxImages: 16, maxLogChars: 50000 },
    defaults: { grounding: false },
    models: { analyze: 'Recorded demo', tts: 'Unavailable' },
    links: {
      summaryPack: '/api/summary-pack',
      replayEvals: '/api/evals/replays',
      providerComparison: '/api/evals/providers',
      meta: '/api/meta',
      reportSchema: '/api/schema/report',
    },
  },
  mockReplayOverview: {
    ok: true,
    suiteId: 'incident-replay-v1',
    generatedAt: '2026-03-12T00:00:00.000Z',
    summary: {
      totalCases: 4,
      totalChecks: 32,
      passedChecks: 32,
      passRate: 100,
      casesPassingAll: 4,
      severityAccuracy: 100,
    },
    buckets: [],
    cases: [],
  },
  mockProviderComparison: {
    ok: true,
    service: 'aegisops-provider-comparison' as const,
    version: 1 as const,
    generatedAt: '2026-03-12T00:00:00.000Z',
    compareAgainst: 'static-demo' as const,
    summary: {
      currentProvider: 'static-demo' as const,
      currentMode: 'static-demo' as const,
      headline: 'Start with replay proof in the static demo, then switch to Gemini or Ollama only when you need live-provider evidence.',
      replayBaselinePassRate: 100,
      replaySeverityAccuracy: 100,
    },
    providers: [],
    links: {
      providerComparison: '/api/evals/providers',
      replaySummary: '/api/evals/replays/summary',
      runtimeScorecard: '/api/runtime/scorecard',
      meta: '/api/meta',
      healthz: '/api/healthz',
    },
  },
  mockSummaryPack: {
    ok: true,
    service: 'aegisops',
    version: 1,
    deployment: 'static-demo' as const,
    summaryPackId: 'summary-pack-v1',
    headline: 'Replay-backed incident summary pack.',
    operatorJourney: [
      { stage: 'collect', summary: 'Load the strongest preset.', surface: '/demo' },
    ],
    trustBoundary: ['Recorded replay proof only.'],
    architectureSequence: ['Replay proof', 'Provider posture', 'Operator handoff'],
    twoMinuteArchitecture: [
      { step: 'Check replay proof', surface: '/api/evals/replays', proof: '100% pass' },
    ],
    evidenceBundle: {
      replayPassRate: 100,
      severityAccuracy: 100,
      totalChecks: 32,
      runtimeModes: ['static-demo'],
      exportFormats: ['json', 'markdown'],
      requiredFields: ['title', 'summary'],
    },
    proofAssets: [
      { label: 'README', path: 'README.md', kind: 'doc' },
    ],
    links: {
      healthz: '/api/healthz',
      summaryPack: '/api/summary-pack',
      replayEvals: '/api/evals/replays',
      reportSchema: '/api/schema/report',
      readme: 'https://example.com/readme',
      demo: 'https://example.com/demo',
      video: 'https://example.com/video',
    },
  },
  mockServiceMeta: {
    ok: true,
    service: 'aegisops-service-meta',
    version: 1,
    deployment: 'static-demo' as const,
    product: {
      name: 'AegisOps',
      category: 'incident copilot',
      headline: 'Turn logs into a reviewable incident story.',
    },
    workflow: ['collect', 'reason', 'decide'],
    runtimeModes: [],
    replaySuite: {
      suiteId: 'incident-replay-v1',
      totalCases: 4,
      totalChecks: 32,
      passRate: 100,
      severityAccuracy: 100,
    },
    reportContract: {
      schemaId: 'incident-report-v1',
      requiredFields: ['title', 'summary'],
      exportFormats: ['json', 'markdown'],
    },
    operatorChecklist: [],
    models: { analyze: 'Recorded demo', tts: 'Unavailable' },
    links: {
      healthz: '/api/healthz',
      summaryPack: '/api/summary-pack',
      replayEvals: '/api/evals/replays',
      providerComparison: '/api/evals/providers',
      reportSchema: '/api/schema/report',
      readme: 'https://example.com/readme',
      demo: 'https://example.com/demo',
      video: 'https://example.com/video',
    },
  },
  mockReportSchema: {
    ok: true,
    schemaId: 'incident-report-v1',
    version: 1,
    description: 'Incident report schema.',
    requiredFields: ['title', 'summary'],
    optionalFields: [],
    exportFormats: ['json', 'markdown'],
    fieldGuide: [],
    inputLimits: { maxImages: 16, maxLogChars: 50000, maxQuestionChars: 4000, maxTtsChars: 0 },
    operatorRules: ['Do not overclaim live runtime evidence.'],
  },
}));

vi.mock('../services/geminiService', () => ({
  analyzeIncident: vi.fn(),
  fetchHealthz: vi.fn().mockResolvedValue(mockHealthz),
  fetchProviderComparison: vi.fn().mockResolvedValue(mockProviderComparison),
  fetchReplayEvalOverview: vi.fn().mockResolvedValue(mockReplayOverview),
  fetchGeminiApiKeyStatus: vi.fn().mockResolvedValue({
    ok: true,
    mode: 'demo',
    deployment: 'static-demo',
    provider: 'demo',
    source: 'none',
    configured: false,
    persisted: false,
  }),
  fetchSummaryPack: vi.fn().mockResolvedValue(mockSummaryPack),
  fetchServiceMeta: vi.fn().mockResolvedValue(mockServiceMeta),
  fetchReportSchema: vi.fn().mockResolvedValue(mockReportSchema),
  saveGeminiApiKey: vi.fn(),
  clearGeminiApiKey: vi.fn(),
}));

vi.mock('../services/StorageService', () => ({
  StorageService: {
    getIncidents: vi.fn(() => []),
    saveIncident: vi.fn(),
    deleteIncident: vi.fn(),
  },
}));

vi.mock('../services/teachableMachineService', () => ({
  buildTeachableMachineLogLines: vi.fn(() => []),
  isTeachableMachineConfigured: vi.fn(() => false),
  predictWithTeachableMachine: vi.fn(),
}));

vi.mock('../components/ReportCard', () => ({ ReportCard: () => React.createElement('div') }));
vi.mock('../components/IncidentHistory', async () => vi.importActual('../components/IncidentHistory'));
vi.mock('../components/LoadingOverlay', () => ({ LoadingOverlay: () => React.createElement('div') }));
vi.mock('../components/GoogleImport', () => ({ GoogleImport: () => React.createElement('div') }));
vi.mock('../components/DatasetExport', () => ({ DatasetExport: () => React.createElement('div') }));
vi.mock('../components/CommunityHub', () => ({ CommunityHub: () => React.createElement('div') }));
vi.mock('../components/ReplayEvalCard', () => ({ ReplayEvalCard: () => React.createElement('div', null, 'ReplayEvalCard') }));
vi.mock('../components/OperatorReadinessCard', () => ({ OperatorReadinessCard: () => React.createElement('div', null, 'OperatorReadinessCard') }));
vi.mock('../components/ProviderComparisonCard', () => ({ ProviderComparisonCard: () => React.createElement('div', null, 'ProviderComparisonCard') }));
vi.mock('../components/SummaryPackCard', () => ({ SummaryPackCard: () => React.createElement('div', null, 'SummaryPackCard') }));
vi.mock('../components/Toast', () => ({
  ToastContainer: () => React.createElement('div'),
}));

import App from '../App';
import { analyzeIncident } from '../services/geminiService';
import { StorageService } from '../services/StorageService';
import { createResponseCase } from '../server/lib/responseWorkflow';
import { CaseSubmissionSchema } from '../shared/responseCase';
import type { IncidentReport, SavedIncident } from '../types';
import { useAppState } from '../hooks/useAppState';
describe('App front door', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    mockHealthz.limits.maxLogChars = 50000;
    mockHealthz.limits.maxImages = 16;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('puts the Korean sample, input and review before optional legacy panels and reaches a source-bound draft', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    const sampleReport: IncidentReport = { title: '합성 지연 분석', summary: '대기열 지표 확인 필요', severity: 'SEV2', rootCauses: [], timeline: [], actionItems: [], mitigationSteps: [], tags: [] };
    vi.mocked(analyzeIncident).mockResolvedValue(sampleReport);
    vi.mocked(StorageService.saveIncident).mockImplementation((report, inputLogs, imageCount) => ({ id: 'sample-incident', report, inputLogs, imageCount, createdAt: '2026-01-15T00:00:00.000Z' }));
    vi.stubGlobal('fetch', vi.fn(async (_input, options?: RequestInit) => new Response(JSON.stringify(createResponseCase(
      CaseSubmissionSchema.parse(JSON.parse(String(options?.body))), '06cbd1a9-2df5-440a-982b-09105aee3a91', { kind: 'local-demo' }, '2026-01-15T00:00:00.000Z',
    )), { status: 201, headers: { 'content-type': 'application/json' } })));
    await act(async () => root.render(React.createElement(App)));
    const clickButton = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label);
      if (!button) throw new Error(`missing ${label}`);
      await act(async () => button.click());
    };
    const optional = Array.from(container.querySelectorAll('summary')).find((item) => item.textContent?.includes('선택 기능'))?.closest('details');
    expect(optional?.open).toBe(false);
    expect(container.querySelector('main h1')?.textContent).toBe('근거를 확인하고, 대응 계획을 검토하고, 인계하세요.');
    await clickButton('합성 지연 사례 불러오기');
    expect(container.querySelector<HTMLTextAreaElement>('#log-input')?.value).toContain('[synthetic-demo]');
    expect(container.querySelector<HTMLTextAreaElement>('#log-input')?.value).toContain('queue_depth=180');
    await clickButton('Run Analysis');
    expect(container.textContent).toContain('대응 검토 시작');
    await clickButton('대응 검토 시작');
    expect(container.textContent).toContain('초안 · 실행 승인 아님 · revision 1');
    expect(container.textContent).toContain('정확한 출처 인용');
    expect(container.textContent).toContain('이미지 0개 선언, 이미지 보관 없음');
  });

  it('saves the bounded declared screenshot count when 17 files are selected and preserves the workflow image gap', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:synthetic-screenshot'; } static revokeObjectURL() {} });
    const report: IncidentReport = { title: '합성 이미지 분석', summary: '선택한 이미지 확인 필요', severity: 'SEV2', rootCauses: [], timeline: [], actionItems: [], mitigationSteps: [], tags: [] };
    vi.mocked(analyzeIncident).mockResolvedValue(report);
    let saved: SavedIncident | null = null;
    let savedDone: () => void = () => { throw new Error('save completion not initialized'); };
    const savedPromise = new Promise<void>((resolve) => { savedDone = resolve; });
    vi.mocked(StorageService.saveIncident).mockImplementation((savedReport, inputLogs, imageCount) => {
      saved = { id: 'bounded-images', report: savedReport, inputLogs, imageCount, createdAt: '2026-01-15T00:00:00.000Z' };
      savedDone();
      return saved;
    });
    const submissions: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options?: RequestInit) => {
      const body: unknown = JSON.parse(String(options?.body)); submissions.push(body);
      return new Response(JSON.stringify(createResponseCase(CaseSubmissionSchema.parse(body), '06cbd1a9-2df5-440a-982b-09105aee3a91', { kind: 'local-demo' }, '2026-01-15T00:00:00.000Z')), { status: 201, headers: { 'content-type': 'application/json' } });
    }));
    await act(async () => root.render(React.createElement(App)));
    const imageInput = container.querySelector<HTMLInputElement>('input[accept="image/*"]');
    if (!imageInput) throw new Error('screenshot input missing');
    Object.defineProperty(imageInput, 'files', { configurable: true, value: Array.from({ length: 17 }, (_, index) => new File(['synthetic-image'], `image-${index}.png`, { type: 'image/png' })) });
    await act(async () => imageInput.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.textContent).toContain('17 files');
    expect(container.textContent).toContain('1 extra files ignored');
    const runAnalysis = container.querySelector<HTMLButtonElement>('[aria-label="Run incident analysis"]');
    if (!runAnalysis) throw new Error('analysis button missing');
    await act(async () => { runAnalysis.click(); await savedPromise; });
    expect(vi.mocked(analyzeIncident).mock.lastCall?.[1]).toHaveLength(16);
    expect(saved).toMatchObject({ imageCount: 16 });
    const startReview = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '대응 검토 시작');
    if (!startReview) throw new Error('review start missing');
    await act(async () => startReview.click());
    expect(submissions[0]).toMatchObject({ evidence: { declaredImageCount: 16 } });
    expect(CaseSubmissionSchema.safeParse(submissions[0]).success).toBe(true);
    expect(container.textContent).toContain('이미지 16개 선언, 이미지 보관 없음');
    expect(container.textContent).toContain('이미지는 이 검토에 보관되지 않습니다.');
    expect(container.textContent).toContain('차단 근거 공백');
  });

  it.each(['logs', 'images'] as const)('invalidates a completed report before imported %s can become new evidence', async (kind) => {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:synthetic-import'; } static revokeObjectURL() {} });
    const incident: SavedIncident = { id: 'image-backed-history', createdAt: '2026-01-15T00:00:00.000Z', inputLogs: 'original queue_depth=180', imageCount: 2,
      report: { title: '원래 이미지 보고서', summary: '이미지 근거 포함', severity: 'SEV2', rootCauses: [], timeline: [], actionItems: [], mitigationSteps: [], tags: [] } };
    function Probe() {
      const state = useAppState();
      return React.createElement('div', null,
        React.createElement('button', { onClick: () => state.handleLoadIncident(incident) }, '저장 보고서 열기'),
        React.createElement('button', { onClick: () => kind === 'logs' ? state.handleImportLogs('new imported logs') : state.handleImportImages([new File(['image'], 'new.png', { type: 'image/png' })]) }, '새 근거 가져오기'),
        React.createElement('output', null, JSON.stringify({ reportTitle: state.report?.title ?? null, status: state.status, selectedIncidentId: state.selectedIncidentId, logs: state.logs, imageCount: state.images.length })));
    }
    await act(async () => root.render(React.createElement(Probe)));
    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label);
      if (!button) throw new Error('missing context action');
      await act(async () => button.click());
    };
    await click('저장 보고서 열기');
    expect(JSON.parse(container.querySelector('output')?.textContent || '{}')).toMatchObject({ reportTitle: '원래 이미지 보고서', status: 'COMPLETE', imageCount: 0 });
    await click('새 근거 가져오기');
    const state = JSON.parse(container.querySelector('output')?.textContent || '{}');
    expect(state).toMatchObject({ reportTitle: null, status: 'IDLE', selectedIncidentId: null });
    if (kind === 'logs') expect(state.logs).toBe('original queue_depth=180\n\nnew imported logs');
    else expect(state.imageCount).toBe(1);
  });

  it('cannot recreate an image-backed report as text-only after deleting its selected saved snapshot', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    const incident: SavedIncident = { id: 'image-backed-history', createdAt: '2026-01-15T00:00:00.000Z', inputLogs: 'original queue_depth=180', imageCount: 2,
      report: { title: '원래 이미지 보고서', summary: '이미지 근거 포함', severity: 'SEV2', rootCauses: [], timeline: [], actionItems: [], mitigationSteps: [], tags: [] } };
    vi.mocked(StorageService.getIncidents).mockReturnValueOnce([incident]);
    window.history.replaceState({}, '', '?incident=image-backed-history');
    const posted: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options?: RequestInit) => {
      const body = CaseSubmissionSchema.parse(JSON.parse(String(options?.body))); posted.push(body);
      return new Response(JSON.stringify(createResponseCase(body, '06cbd1a9-2df5-440a-982b-09105aee3a91', { kind: 'local-demo' }, '2026-01-15T00:00:00.000Z')), { status: 201, headers: { 'content-type': 'application/json' } });
    }));
    await act(async () => root.render(React.createElement(App)));
    const start = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '대응 검토 시작');
    if (!start) throw new Error('review start missing');
    await act(async () => start.click());
    expect(posted[0]).toMatchObject({ evidence: { logs: 'original queue_depth=180', declaredImageCount: 2 } });
    expect(container.textContent).toContain('차단 근거 공백');
    const historyButton = container.querySelector<HTMLButtonElement>('[aria-label="Open incident history"]');
    if (!historyButton) throw new Error('history missing');
    await act(async () => historyButton.click());
    const deletion = container.querySelector<HTMLButtonElement>('[aria-label="Delete incident 원래 이미지 보고서"]');
    if (!deletion) throw new Error('delete missing');
    await act(async () => deletion.click());
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Run incident analysis"]')?.disabled).toBe(false);
    expect(Array.from(container.querySelectorAll('button')).some((item) => item.textContent === '대응 검토 시작')).toBe(false);
    expect(posted).toHaveLength(1);
  });

  it('imports a local threat file and shows parser errors without partially replacing logs', async () => {
    await act(async () => root.render(React.createElement(App)));
    const fileInput = container.querySelector<HTMLInputElement>('input[accept*=".jsonl"]');
    if (!fileInput) throw new Error('threat input missing');
    const event = { timestamp: '2026-01-15T09:00:00+09:00', detector: 'ids', service: 'uploaded-example', signature: 'suspicious login', severity: 'major', action: 'observed-only', country: 'KR', dst: '192.0.2.1', rule_id: 'test-rule', tuned: false };
    const upload = async (text: string) => {
      const file = new File([text], 'events.jsonl', { type: 'application/x-ndjson' });
      Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
      await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })));
    };
    await upload(JSON.stringify(event));
    const logs = container.querySelector<HTMLTextAreaElement>('#log-input')?.value;
    expect(logs).toContain('service="uploaded-example"');
    expect(logs).toContain('action="observed-only"');
    expect(container.textContent).toContain('1건 가져옴. critical 0, major 1, minor 0, info 0.');
    expect(container.textContent).toContain('업로드한 파일은 합성 데이터로 간주하지 않습니다.');
    await upload(JSON.stringify(event) + '\n{"bad":true}');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('2번째 줄');
    expect(container.querySelector<HTMLTextAreaElement>('#log-input')?.value).toBe(logs);
  });

  it('ships explicit payload guardrail copy in the front-door source', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../hooks/useAppState.ts', `file://${process.cwd()}/__tests__/`), 'utf8')
    );
    expect(source).toContain('Payload guardrail');
    expect(source).toContain('Logs exceed the backend limit, so AegisOps will trim the payload unless you tighten the incident slice first.');
    expect(source).toContain('Trim the log excerpt or load the strongest preset before you claim live-runtime readiness.');
  });

  it('frames the first-click evidence path without claiming live runtime evidence', async () => {
    await act(async () => {
      root.render(React.createElement(App));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const text = container.textContent ?? '';
    expect(text).toContain('Incident theater front door');
    expect(text).toContain('Walk a believable incident before you talk about runtime.');
    expect(text).toContain('Right now');
    expect(text).toContain('Load Strongest Preset');
    expect(text).toContain('Decision support');
    expect(text).toContain('Go now');
    expect(text).toContain('Hold line');
    expect(text).toContain('Exit with');
    expect(text).toContain('First review pass');
    expect(text).toContain('Load Strongest Preset');
    expect(text).toContain('Right now');
    expect(text).toContain('Separate proof from provider posture');
    expect(text).toContain('Provider posture is comparative guidance here, not live runtime telemetry from this session.');
  });
});

describe('SummaryPackCard', () => {
  it('shows fallback posture and next operator step for static-demo packs', async () => {
    const { SummaryPackCard } = await vi.importActual<typeof import('../components/SummaryPackCard')>(
      '../components/SummaryPackCard'
    );
    const html = renderToStaticMarkup(React.createElement(SummaryPackCard, { summaryPack: mockSummaryPack }));

    expect(html).toContain('Fallback posture');
    expect(html).toContain('Static demo keeps the evaluation path available');
    expect(html).toContain('Next operator step');
  });
});
