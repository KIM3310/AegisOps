import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockHealthz,
  mockReplayOverview,
  mockProviderComparison,
  mockReviewPack,
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
      reviewPack: '/api/review-pack',
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
  mockReviewPack: {
    ok: true,
    service: 'aegisops',
    version: 1,
    deployment: 'static-demo' as const,
    reviewPackId: 'review-pack-v1',
    headline: 'Replay-backed incident review pack.',
    operatorJourney: [
      { stage: 'collect', summary: 'Load the strongest preset.', surface: '/demo' },
    ],
    trustBoundary: ['Recorded replay proof only.'],
    reviewSequence: ['Replay proof', 'Provider posture', 'Reviewer handoff'],
    twoMinuteReview: [
      { step: 'Check replay proof', surface: '/api/evals/replays', proof: '100% pass' },
    ],
    proofBundle: {
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
      reviewPack: '/api/review-pack',
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
      reviewPack: '/api/review-pack',
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
  fetchReviewPack: vi.fn().mockResolvedValue(mockReviewPack),
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
vi.mock('../components/IncidentHistory', () => ({ IncidentHistory: () => React.createElement('div') }));
vi.mock('../components/LoadingOverlay', () => ({ LoadingOverlay: () => React.createElement('div') }));
vi.mock('../components/GoogleImport', () => ({ GoogleImport: () => React.createElement('div') }));
vi.mock('../components/DatasetExport', () => ({ DatasetExport: () => React.createElement('div') }));
vi.mock('../components/CommunityHub', () => ({ CommunityHub: () => React.createElement('div') }));
vi.mock('../components/ReplayEvalCard', () => ({ ReplayEvalCard: () => React.createElement('div', null, 'ReplayEvalCard') }));
vi.mock('../components/OperatorReadinessCard', () => ({ OperatorReadinessCard: () => React.createElement('div', null, 'OperatorReadinessCard') }));
vi.mock('../components/ProviderComparisonCard', () => ({ ProviderComparisonCard: () => React.createElement('div', null, 'ProviderComparisonCard') }));
vi.mock('../components/ReviewPackCard', () => ({ ReviewPackCard: () => React.createElement('div', null, 'ReviewPackCard') }));
vi.mock('../components/Toast', () => ({
  ToastContainer: () => React.createElement('div'),
}));

import App from '../App';
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
  });

  it('ships explicit payload guardrail copy in the front-door source', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../App.tsx', `file://${process.cwd()}/__tests__/`), 'utf8')
    );
    expect(source).toContain('Payload guardrail');
    expect(source).toContain('Logs exceed the backend limit, so AegisOps will trim the payload unless you tighten the incident slice first.');
    expect(source).toContain('Trim the log excerpt or load the strongest preset before you claim live-runtime readiness.');
  });

  it('frames the first-click proof path without claiming live runtime evidence', async () => {
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
    expect(text).toContain('First review pass');
    expect(text).toContain('Load Strongest Preset');
    expect(text).toContain('Right now');
    expect(text).toContain('Separate proof from provider posture');
    expect(text).toContain('Provider posture is comparative guidance here, not live runtime telemetry from this session.');
  });
});

describe('ReviewPackCard', () => {
  it('shows fallback posture and next operator step for static-demo packs', async () => {
    const { ReviewPackCard } = await vi.importActual<typeof import('../components/ReviewPackCard')>(
      '../components/ReviewPackCard'
    );
    const html = renderToStaticMarkup(React.createElement(ReviewPackCard, { reviewPack: mockReviewPack }));

    expect(html).toContain('Fallback posture');
    expect(html).toContain('Static demo keeps the reviewer path available');
    expect(html).toContain('Next operator step');
  });
});
