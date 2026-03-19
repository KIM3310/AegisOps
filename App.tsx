
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, History, FileText, Image as ImageIcon, Upload, X, AlertCircle, Loader2, Download, Table2, Zap, Sparkles, RefreshCw, Edit3, Globe, BrainCircuit, KeyRound } from 'lucide-react';
import type { IncidentReport, SavedIncident, AnalysisStatus, ReplayEvalOverview } from './types';
import {
  analyzeIncident,
  fetchHealthz,
  fetchProviderComparison,
  fetchReplayEvalOverview,
  fetchGeminiApiKeyStatus,
  fetchSummaryPack,
  fetchServiceMeta,
  fetchReportSchema,
  saveGeminiApiKey,
  clearGeminiApiKey,
  type HealthzResponse,
  type ApiKeySource,
  type ProviderComparisonResponse,
  type SummaryPackResponse,
  type ServiceMetaResponse,
  type ReportSchemaResponse,
} from './services/geminiService';
import { StorageService } from './services/StorageService';
import {
  buildTeachableMachineLogLines,
  isTeachableMachineConfigured,
  predictWithTeachableMachine,
  type TmImagePrediction,
} from './services/teachableMachineService';
import { ReportCard } from './components/ReportCard';
import { IncidentHistory } from './components/IncidentHistory';
import { LoadingOverlay } from './components/LoadingOverlay';
import { GoogleImport } from './components/GoogleImport';
import { DatasetExport } from './components/DatasetExport';
import { CommunityHub } from './components/CommunityHub';
import { ReplayEvalCard } from './components/ReplayEvalCard';
import { OperatorReadinessCard } from './components/OperatorReadinessCard';
import { ProviderComparisonCard } from './components/ProviderComparisonCard';
import { SummaryPackCard } from './components/SummaryPackCard';
import { ToastContainer, ToastMessage } from './components/Toast';
import {
  buildReviewShareUrl,
  buildReviewUrlSearch,
  parseReviewUrlState,
  replaceReviewUrlSearch,
  slugifyPresetName,
} from './utils/urlState';

interface ImageFile {
  file: File;
  preview: string;
}

interface ApiImageInput {
  mimeType: string;
  data: string;
}

const DEMO_IMG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAALUlEQVR42u3RAQ0AAAgDIJ/6N5WCB9R0oJ1O1+l0nU7X6XSdTtfpdJ1O1+l0XfsAE12D4Z5+1R4AAAAASUVORK5CYII=";

const SAMPLE_PRESETS = [
  {
    name: 'LLM Latency Spike',
    logs: `[2025-01-15T14:30:00Z] INFO: LLM API response time: 150ms
[2025-01-15T14:30:15Z] WARN: Response time increased: 850ms - approaching SLO threshold
[2025-01-15T14:30:30Z] ERROR: Response time: 3500ms - SLO BREACH DETECTED
[2025-01-15T14:30:45Z] ALERT: Circuit breaker OPEN for llm-service
[2025-01-15T14:31:00Z] ERROR: Request queue depth: 5000 (limit: 1000)
[2025-01-15T14:31:15Z] WARN: Memory pressure detected on inference nodes
[2025-01-15T14:31:30Z] INFO: Auto-scaling triggered: 10 -> 25 replicas
[2025-01-15T14:33:00Z] INFO: New replicas online, load balancing active
[2025-01-15T14:35:00Z] INFO: Circuit breaker CLOSED, latency recovered: 200ms`,
    hasImage: true
  },
  {
    name: 'Redis Cluster Crash',
    logs: `[2025-01-15T09:15:00Z] WARN: Redis node redis-master-01 memory usage: 92%
[2025-01-15T09:17:00Z] WARN: Memory usage critical: 98%
[2025-01-15T09:18:00Z] ERROR: Redis node redis-master-01 OOM killed by kernel
[2025-01-15T09:18:05Z] ALERT: Cluster state changed to FAIL - quorum lost
[2025-01-15T09:18:10Z] ERROR: Cache miss rate: 100%
[2025-01-15T09:18:15Z] ERROR: Database connection pool exhausted
[2025-01-15T09:18:30Z] INFO: Automatic failover initiated
[2025-01-15T09:20:00Z] INFO: redis-replica-02 promoted to master
[2025-01-15T09:22:00Z] INFO: Cluster failover complete
[2025-01-15T09:25:00Z] INFO: Cache hit rate recovered: 94%`,
    hasImage: true
  },
];

const REVIEW_LENSES = {
  quickstart: {
    label: 'Quick Start',
    eyebrow: 'Quick start lens',
    headline: 'Show the strongest evidence path without digging through code.',
    description:
      'Lead with the strongest preset, confirm replay quality, then close with a compact export summary.',
    cards: [
      ['01 · Strongest preset', 'Start from a representative incident so the walkthrough lands fast.'],
      ['02 · Replay proof', 'Use pass rate and severity accuracy before talking about provider quality.'],
      ['03 · Export summary', 'Send one compact handoff instead of narrating every panel live.'],
    ],
    actions: [
      { label: 'Load Strongest Preset', type: 'load-preset' },
      { label: 'Copy Review Checklist', type: 'checklist' },
      { label: 'Copy Export Summary', type: 'bundle' },
    ],
  },
  commander: {
    label: 'Commander',
    eyebrow: 'Incident commander lens',
    headline: 'Keep escalation, provider posture, and replay evidence in one deck.',
    description:
      'Use this lens when the audience cares about escalation quality, provider tradeoffs, and the next operator move.',
    cards: [
      ['01 · Incident claim', 'Summarize the current incident with severity, bucket, and replay posture.'],
      ['02 · Provider tradeoff', 'Compare static demo, backend runtime, and provider options before escalating.'],
      ['03 · Escalation brief', 'End with a copyable brief that already contains the fast routes.'],
    ],
    actions: [
      { label: 'Copy Incident Claim', type: 'claim' },
      { label: 'Copy Escalation Brief', type: 'escalation' },
      { label: 'Copy Review Routes', type: 'routes' },
    ],
  },
  platform: {
    label: 'Platform',
    eyebrow: 'Platform lens',
    headline: 'Frame the service as an operator-safe incident system, not just a demo.',
    description:
      'Use this path when evaluating about runtime posture, payload limits, and how the service scales beyond the preset.',
    cards: [
      ['01 · Runtime posture', 'Anchor the conversation in deployment mode, provider state, and schema contract.'],
      ['02 · Payload budget', 'Show where logs and screenshots hit the safety limits before live runtime claims.'],
      ['03 · Review link', 'Keep a shareable state link so the same evidence path can be replayed later.'],
    ],
    actions: [
      { label: 'Copy Payload Budget', type: 'payload' },
      { label: 'Copy Review Link', type: 'link' },
      { label: 'Copy Review Routes', type: 'routes' },
    ],
  },
} as const;

export default function App() {
  const initialReviewUrlState =
    typeof window === 'undefined' ? {} : parseReviewUrlState(window.location.search);
  const [logs, setLogs] = useState('');
  const [images, setImages] = useState<ImageFile[]>([]);
  const [savedIncidents, setSavedIncidents] = useState<SavedIncident[]>(() => StorageService.getIncidents());

  const [report, setReport] = useState<IncidentReport | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [apiHealth, setApiHealth] = useState<HealthzResponse | null>(null);
  const [summaryPack, setSummaryPack] = useState<SummaryPackResponse | null>(null);
  const [serviceMeta, setServiceMeta] = useState<ServiceMetaResponse | null>(null);
  const [reportSchema, setReportSchema] = useState<ReportSchemaResponse | null>(null);
  const [providerComparison, setProviderComparison] = useState<ProviderComparisonResponse | null>(null);
  const [providerComparisonError, setProviderComparisonError] = useState<string | null>(null);
  const [providerComparisonLoading, setProviderComparisonLoading] = useState(true);
  const [replayOverview, setReplayOverview] = useState<ReplayEvalOverview | null>(null);
  const [replayEvalError, setReplayEvalError] = useState<string | null>(null);
  const [replayEvalLoading, setReplayEvalLoading] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [apiKeySource, setApiKeySource] = useState<ApiKeySource>('none');
  const [showApiKeyPanel, setShowApiKeyPanel] = useState(false);
  const [enableGrounding, setEnableGrounding] = useState(
    () => initialReviewUrlState.grounding ?? false
  );
  const tmConfigured = isTeachableMachineConfigured();
  const isOllamaMode = apiHealth?.provider === 'ollama';
  const isStaticDemo = apiHealth?.deployment === 'static-demo';
  const ttsAvailable = apiHealth?.mode === 'live' && apiHealth?.provider === 'gemini';
  const [enableTmVision, setEnableTmVision] = useState(
    () => initialReviewUrlState.tm ?? tmConfigured
  );
  const [tmStatus, setTmStatus] = useState<'IDLE' | 'RUNNING' | 'READY' | 'ERROR'>('IDLE');
  const [tmError, setTmError] = useState<string | null>(null);
  const [tmSignals, setTmSignals] = useState<TmImagePrediction[]>([]);
  
  // Modals & UI State
  const [showHistory, setShowHistory] = useState(
    () => initialReviewUrlState.history ?? false
  );
  const [showGoogleImport, setShowGoogleImport] = useState(false);
  const [showDatasetExport, setShowDatasetExport] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    () => initialReviewUrlState.incident ?? null
  );
  const [selectedPresetSlug, setSelectedPresetSlug] = useState<string | null>(
    () => initialReviewUrlState.preset ?? null
  );
  const [reviewLens, setReviewLens] = useState<'quickstart' | 'commander' | 'platform'>('quickstart');
  const [reviewStateHydrated, setReviewStateHydrated] = useState(false);

  const imagesRef = useRef(images);
  const initialReviewStateRef = useRef(initialReviewUrlState);
  const appliedInitialReviewState = useRef(false);
  const reviewRoutes = summaryPack
    ? Object.entries(summaryPack.links).filter(([, href]) => typeof href === 'string' && href.length > 0)
    : [];
  const runtimePosture = apiHealth
    ? `${apiHealth.mode === 'live' ? 'Live backend' : 'Demo backend'} · ${(apiHealth.provider || 'unknown').toUpperCase()}`
    : 'Loading backend posture';
  const strongestPreset =
    SAMPLE_PRESETS.find((preset) => preset.name === 'LLM Latency Spike') ?? SAMPLE_PRESETS[0] ?? null;
  const proofSummary = replayOverview
    ? `${replayOverview.summary.passRate}% replay pass · ${replayOverview.summary.severityAccuracy}% severity accuracy`
    : replayEvalLoading
      ? 'Loading replay proof'
      : 'Replay proof unavailable';
  const providerNarrative = providerComparison?.summary.headline ?? 'Compare provider posture only after the replay-backed incident story is clear.';
  const runtimeEvidenceNote = isStaticDemo
    ? 'This Pages build uses replay-backed browser proof. Provider posture is comparative guidance here, not live runtime telemetry from this session.'
    : apiHealth?.mode === 'live'
      ? 'Live backend routes are available, but the front door still starts with replay evidence before any provider claim.'
      : 'Demo backend routes are available for rehearsal. Treat provider posture as intent framing until a live provider run is exercised.';
  const maxLogChars = apiHealth?.limits?.maxLogChars ?? 12000;
  const maxImages = apiHealth?.limits?.maxImages ?? 16;
  const logCharsUsed = logs.length;
  const logCharsRemaining = Math.max(maxLogChars - logCharsUsed, 0);
  const logsNearBudget = logCharsUsed >= Math.floor(maxLogChars * 0.8);
  const logsOverBudget = logCharsUsed > maxLogChars;
  const imagesWithinBudget = Math.min(images.length, maxImages);
  const extraImages = Math.max(images.length - maxImages, 0);
  const payloadGuardrail = logsOverBudget
    ? {
        title: "Payload guardrail",
        detail:
          "Logs exceed the backend limit, so AegisOps will trim the payload unless you tighten the incident slice first.",
        next:
          "Trim the log excerpt or load the strongest preset before you claim live-runtime readiness.",
      }
    : extraImages > 0
      ? {
          title: "Payload guardrail",
          detail: `Only the first ${maxImages} image${maxImages === 1 ? "" : "s"} will be analyzed in this request.`,
          next:
            "Remove extra screenshots or keep the current strongest proof image set before analyze.",
        }
      : null;
  const reviewStateChips = [
    selectedPresetSlug ? `Preset ${selectedPresetSlug}` : null,
    selectedIncidentId ? `Incident ${selectedIncidentId.slice(-8)}` : null,
    enableGrounding ? 'Grounding ON' : 'Grounding OFF',
    enableTmVision ? 'TM Vision ON' : 'TM Vision OFF',
    showHistory ? 'History open' : null,
  ].filter((value): value is string => Boolean(value));
  const activeReviewLens = REVIEW_LENSES[reviewLens];
  const reviewLensNextAction = activeReviewLens.actions[0];
  const reviewLensNextStep = activeReviewLens.cards[0];
  const frontDoorDecisionSupport = {
    goNow: strongestPreset
      ? `Load ${strongestPreset.name} so the first click opens on a replay-backed incident instead of an empty runtime claim.`
      : 'Load one concrete incident preset before you discuss runtime posture.',
    holdLine: isStaticDemo
      ? 'Hold live-runtime claims until the conversation explicitly moves from replay proof into provider posture.'
      : apiHealth?.mode === 'live'
        ? 'Hold provider claims until one replay-backed incident and one live route both read cleanly.'
        : 'Hold runtime claims until the incident evidence path is concrete enough to survive handoff.',
    exitWith: `${activeReviewLens.actions[activeReviewLens.actions.length - 1]?.label ?? 'Copy Export Summary'} once the ${activeReviewLens.label.toLowerCase()} framing reads clearly.`,
  };
  
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, []); 

  useEffect(() => {
    let mounted = true;
    fetchHealthz()
      .then((h) => { if (mounted) setApiHealth(h); })
      .catch(() => { if (mounted) setApiHealth(null); });
    fetchServiceMeta()
      .then((meta) => { if (mounted) setServiceMeta(meta); })
      .catch(() => { if (mounted) setServiceMeta(null); });
    fetchSummaryPack()
      .then((pack) => { if (mounted) setSummaryPack(pack); })
      .catch(() => { if (mounted) setSummaryPack(null); });
    fetchReportSchema()
      .then((schema) => { if (mounted) setReportSchema(schema); })
      .catch(() => { if (mounted) setReportSchema(null); });
    return () => { mounted = false; };
  }, []);

  const loadReplayOverview = useCallback(async () => {
    setReplayEvalLoading(true);
    setReplayEvalError(null);
    try {
      const overview = await fetchReplayEvalOverview();
      setReplayOverview(overview);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load replay evals.';
      setReplayEvalError(message);
    } finally {
      setReplayEvalLoading(false);
    }
  }, []);

  const loadProviderComparison = useCallback(async () => {
    setProviderComparisonLoading(true);
    setProviderComparisonError(null);
    try {
      const comparison = await fetchProviderComparison();
      setProviderComparison(comparison);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load provider comparison.';
      setProviderComparisonError(message);
    } finally {
      setProviderComparisonLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReplayOverview();
  }, [loadReplayOverview]);

  useEffect(() => {
    void loadProviderComparison();
  }, [loadProviderComparison]);

  useEffect(() => {
    let mounted = true;
    fetchGeminiApiKeyStatus()
      .then((status) => {
        if (!mounted) return;
        setApiKeyMasked(status.masked || null);
        setApiKeySource(status.source || 'none');
      })
      .catch(() => {
        if (!mounted) return;
        setApiKeyMasked(null);
        setApiKeySource('none');
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!apiHealth) return;
    if (typeof initialReviewStateRef.current.grounding === 'boolean') return;
    setEnableGrounding((prev) => prev || apiHealth.defaults?.grounding || false);
  }, [apiHealth]);

  const nextToastId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2, 11);
  };

  const addToast = (type: ToastMessage['type'], message: string) => {
    const id = nextToastId();
    setToasts((prev) => [...prev, { id, type, message }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const copyTextToClipboard = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast('success', successMessage);
    } catch {
      addToast('error', 'Clipboard copy failed');
    }
  };

  const copyLinesToClipboard = async (lines: string[], successMessage: string) => {
    await copyTextToClipboard(lines.join('\n'), successMessage);
  };

  useEffect(() => {
    if (appliedInitialReviewState.current) return;
    const initialState = initialReviewStateRef.current;
    if (!initialState) {
      appliedInitialReviewState.current = true;
      setReviewStateHydrated(true);
      return;
    }

    if (initialState.history) {
      setShowHistory(true);
    }

    if (initialState.incident) {
      const incident = savedIncidents.find((item) => item.id === initialState.incident);
      if (incident) {
        setSelectedIncidentId(incident.id);
        setSelectedPresetSlug(null);
        setLogs(incident.inputLogs || '');
        setImages([]);
        setReport(incident.report);
        setStatus('COMPLETE');
        setError(null);
      }
    } else if (initialState.preset) {
      const preset = SAMPLE_PRESETS.find(
        (item) => slugifyPresetName(item.name) === initialState.preset
      );
      if (preset) {
        setSelectedPresetSlug(slugifyPresetName(preset.name));
        setSelectedIncidentId(null);
        setLogs(preset.logs);
        if (preset.hasImage) {
          const byteCharacters = atob(DEMO_IMG_BASE64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'image/png' });
          const file = new File([blob], 'monitoring_dashboard.png', { type: 'image/png' });
          setImages([{ file, preview: URL.createObjectURL(file) }]);
        } else {
          setImages([]);
        }
      }
    }

    appliedInitialReviewState.current = true;
    setReviewStateHydrated(true);
  }, [savedIncidents]);

  useEffect(() => {
    if (!reviewStateHydrated) return;
    replaceReviewUrlSearch(
      buildReviewUrlSearch({
        preset: selectedPresetSlug ?? undefined,
        incident: selectedIncidentId ?? undefined,
        grounding: enableGrounding,
        tm: enableTmVision,
        history: showHistory,
      })
    );
  }, [
    enableGrounding,
    enableTmVision,
    reviewStateHydrated,
    selectedIncidentId,
    selectedPresetSlug,
    showHistory,
  ]);

  const handleSaveApiKey = async () => {
    const candidate = apiKeyInput.trim();
    if (!candidate) {
      addToast('error', 'Enter a Gemini API key first.');
      return;
    }
    if (isStaticDemo) {
      addToast('error', 'Runtime API key controls are unavailable in the static demo. Run the local API to use BYOK.');
      return;
    }

    setApiKeyBusy(true);
    try {
      const status = await saveGeminiApiKey(candidate);
      setApiKeyMasked(status.masked || null);
      setApiKeySource(status.source || 'runtime');
      setApiKeyInput('');
      const health = await fetchHealthz().catch(() => null);
      setApiHealth(health);
      addToast('success', 'Gemini API key saved to backend runtime.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save API key.';
      addToast('error', message);
    } finally {
      setApiKeyBusy(false);
    }
  };

  const handleClearApiKey = async () => {
    if (isStaticDemo) {
      addToast('error', 'Runtime API key controls are unavailable in the static demo. Run the local API to use BYOK.');
      return;
    }
    setApiKeyBusy(true);
    try {
      const status = await clearGeminiApiKey();
      setApiKeyMasked(status.masked || null);
      setApiKeySource(status.source || 'none');
      const health = await fetchHealthz().catch(() => null);
      setApiHealth(health);
      addToast('info', status.configured ? 'Runtime API key removed. Falling back to server key.' : 'Runtime API key removed. Demo mode active.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear API key.';
      addToast('error', message);
    } finally {
      setApiKeyBusy(false);
    }
  };

  const processAndAddImages = (files: File[]) => {
    const newImages = files.map(file => ({
      file,
      preview: URL.createObjectURL(file)
    }));
    const nextImageCount = imagesRef.current.length + newImages.length;
    setImages(prev => [...prev, ...newImages]);
    setSelectedIncidentId(null);
    setSelectedPresetSlug(null);
    if (nextImageCount > maxImages) {
      addToast('info', `Only the first ${maxImages} images will be analyzed (payload safeguard).`);
    }
    return newImages.length;
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const textFiles: File[] = [];
      const imageFiles: File[] = [];

      Array.from(e.dataTransfer.files).forEach((file: File) => {
        if (file.type.startsWith('image/')) {
          imageFiles.push(file);
        } else if (file.type === 'text/plain' || file.name.endsWith('.log') || file.name.endsWith('.txt')) {
          textFiles.push(file);
        }
      });

      if (imageFiles.length > 0) {
        const imgCount = processAndAddImages(imageFiles);
        addToast('info', `${imgCount} screenshots added`);
      }

      if (textFiles.length > 0) {
        try {
          const contents = await Promise.all(
            textFiles.map(file => new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (event) => resolve((event.target?.result as string) || '');
              reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
              reader.readAsText(file);
            }))
          );
          
          const mergedLogs = contents.join('\n\n');
          setLogs(prev => prev ? `${prev}\n\n${mergedLogs}` : mergedLogs);
          setSelectedIncidentId(null);
          setSelectedPresetSlug(null);
          addToast('info', `${textFiles.length} logs added`);
        } catch (err) {
          console.error("File read error:", err);
          addToast('error', 'Failed to read log files');
        }
      }
    }
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const count = processAndAddImages(Array.from(e.target.files));
      setSelectedIncidentId(null);
      setSelectedPresetSlug(null);
      addToast('info', `${count} screenshots added`);
    }
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== index);
    });
    setSelectedIncidentId(null);
    setSelectedPresetSlug(null);
  };

  const loadPreset = (preset: (typeof SAMPLE_PRESETS)[0]) => {
    setLogs(preset.logs);
    setSelectedPresetSlug(slugifyPresetName(preset.name));
    setSelectedIncidentId(null);
    setShowHistory(false);
    images.forEach(img => URL.revokeObjectURL(img.preview));

    if (preset.hasImage) {
        const byteCharacters = atob(DEMO_IMG_BASE64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {type: 'image/png'});
        const file = new File([blob], "monitoring_dashboard.png", { type: 'image/png' });
        
        const newImages = [{ file, preview: URL.createObjectURL(file) }];
        setImages(newImages);
    } else {
        setImages([]);
    }

    setError(null);
    setTmSignals([]);
    setTmStatus('IDLE');
    setTmError(null);
    addToast('info', `Preset "${preset.name}" loaded with screenshots`);
  };

  const copyReviewChecklist = async () => {
    const lines = [
      'AegisOps export checklist',
      `Runtime: ${runtimePosture}`,
      `Deployment: ${apiHealth?.deployment ?? summaryPack?.deployment ?? 'unknown'}`,
      `Report schema: ${reportSchema?.schemaId ?? 'unavailable'}`,
      `Replay pass rate: ${summaryPack ? `${summaryPack.evidenceBundle.replayPassRate}%` : 'unavailable'}`,
      `Severity accuracy: ${summaryPack ? `${summaryPack.evidenceBundle.severityAccuracy}%` : 'unavailable'}`,
      '',
      'Review flow',
      ...(summaryPack?.twoMinuteReview?.map((item) => `- ${item.step}: ${item.surface} (${item.proof})`) ?? [
        '- Summary pack unavailable. Start with /api/healthz, /api/summary-pack, and replay evals.',
      ]),
      '',
      'Fast links',
      ...(reviewRoutes.length > 0
        ? reviewRoutes.map(([label, href]) => `- ${label}: ${href}`)
        : ['- Review routes unavailable.']),
    ];

    await copyLinesToClipboard(lines, 'Export checklist copied');
  };

  const copyReviewRoutes = async () => {
    const lines = [
      'AegisOps fast review routes',
      ...(reviewRoutes.length > 0
        ? reviewRoutes.map(([label, href]) => `- ${label}: ${href}`)
        : ['- Review routes unavailable. Start with /api/healthz, /api/meta, and /api/summary-pack.']),
    ];

    await copyLinesToClipboard(lines, 'Review routes copied');
  };

  const copyReviewStateLink = async () => {
    const shareUrl = buildReviewShareUrl(
      buildReviewUrlSearch({
        preset: selectedPresetSlug ?? undefined,
        incident: selectedIncidentId ?? undefined,
        grounding: enableGrounding,
        tm: enableTmVision,
        history: showHistory,
      })
    );

    await copyTextToClipboard(shareUrl, 'Review state link copied');
  };

  const copyReviewerBundle = async () => {
    const lines = [
      'AegisOps export summary',
      `Runtime: ${runtimePosture}`,
      `Deployment: ${apiHealth?.deployment ?? summaryPack?.deployment ?? 'unknown'}`,
      `Schema: ${reportSchema?.schemaId ?? 'unavailable'}`,
      '',
      'Current review state',
      ...reviewStateChips.map((chip) => `- ${chip}`),
      '',
      'Fast links',
      ...(reviewRoutes.length > 0
        ? reviewRoutes.map(([label, href]) => `- ${label}: ${href}`)
        : ['- Review routes unavailable.']),
      '',
      'Proof assets',
      ...(summaryPack?.proofAssets?.length
        ? summaryPack.proofAssets.map((item) => `- ${item.label} [${item.kind}]: ${item.path}`)
        : ['- Proof assets unavailable.']),
    ];

    await copyLinesToClipboard(lines, 'Export summary copied');
  };

  const copyEvidenceSnapshot = async () => {
    const lines = [
      'AegisOps evidence snapshot',
      `Replay pass rate: ${summaryPack ? `${summaryPack.evidenceBundle.replayPassRate}%` : 'unavailable'}`,
      `Severity accuracy: ${summaryPack ? `${summaryPack.evidenceBundle.severityAccuracy}%` : 'unavailable'}`,
      `Rubric checks: ${summaryPack?.evidenceBundle.totalChecks ?? 'unavailable'}`,
      `Runtime modes: ${summaryPack?.evidenceBundle.runtimeModes?.join(', ') ?? 'unavailable'}`,
      `Export formats: ${summaryPack?.evidenceBundle.exportFormats?.join(', ') ?? 'unavailable'}`,
      '',
      'Supporting assets',
      ...(summaryPack?.proofAssets?.length
        ? summaryPack.proofAssets.map((item) => `- ${item.label} [${item.kind}]: ${item.path}`)
        : ['- Supporting assets unavailable. Open /api/summary-pack first.']),
    ];

    await copyLinesToClipboard(lines, 'Evidence snapshot copied');
  };

  const copyPayloadBudgetSnapshot = async () => {
    const lines = [
      'AegisOps payload budget snapshot',
      `Logs used: ${logCharsUsed.toLocaleString()}/${maxLogChars.toLocaleString()}`,
      `Images used: ${imagesWithinBudget}/${maxImages}`,
      `Extra images trimmed: ${extraImages}`,
      `Grounding: ${enableGrounding ? 'on' : 'off'}`,
      `TM Vision: ${enableTmVision ? 'on' : 'off'}`,
      `Preset: ${selectedPresetSlug ?? 'none'}`,
      `Incident: ${selectedIncidentId ?? 'none'}`,
    ];

    await copyLinesToClipboard(lines, 'Payload budget snapshot copied');
  };

  const loadStrongestPreset = () => {
    if (!strongestPreset) {
      addToast('error', 'No preset is available');
      return;
    }
    loadPreset(strongestPreset);
  };

  const copyStrongestPreset = async () => {
    if (!strongestPreset) {
      addToast('error', 'No preset is available');
      return;
    }

    const lines = [
      'AegisOps strongest preset',
      `Preset: ${strongestPreset.name}`,
      `Screenshots: ${strongestPreset.hasImage ? 'included' : 'not included'}`,
      '',
      'Fast links',
      ...(reviewRoutes.length > 0
        ? reviewRoutes.map(([label, href]) => `- ${label}: ${href}`)
        : ['- Review routes unavailable. Start with /api/healthz, /api/meta, and /api/summary-pack.']),
      '',
      'Log excerpt',
      strongestPreset.logs,
    ];

    await copyLinesToClipboard(lines, 'Strongest preset copied');
  };

  const copyIncidentClaim = async () => {
    const strongestJourney = summaryPack?.operatorJourney?.[0];
    const lines = [
      'AegisOps incident claim snapshot',
      `Headline: ${summaryPack?.headline ?? 'summary pack unavailable'}`,
      `Runtime: ${runtimePosture}`,
      `Deployment: ${apiHealth?.deployment ?? summaryPack?.deployment ?? 'unknown'}`,
      `Replay pass rate: ${summaryPack ? `${summaryPack.evidenceBundle.replayPassRate}%` : 'unavailable'}`,
      `Severity accuracy: ${summaryPack ? `${summaryPack.evidenceBundle.severityAccuracy}%` : 'unavailable'}`,
      `Schema: ${reportSchema?.schemaId ?? 'unavailable'}`,
      `Preset: ${strongestPreset?.name ?? 'unavailable'}`,
      '',
      'Strongest operator proof',
      strongestJourney
        ? `- ${strongestJourney.surface}: ${strongestJourney.summary}`
        : '- Operator journey unavailable.',
      '',
      'Export posture',
      `- Formats: ${summaryPack?.evidenceBundle.exportFormats?.join(', ') ?? 'unavailable'}`,
      `- Runtime modes: ${summaryPack?.evidenceBundle.runtimeModes?.join(', ') ?? 'unavailable'}`,
    ];

    await copyLinesToClipboard(lines, 'Incident claim copied');
  };

  const copyEscalationBrief = async () => {
    const shareUrl = buildReviewShareUrl(
      buildReviewUrlSearch({
        preset: selectedPresetSlug ?? undefined,
        incident: selectedIncidentId ?? undefined,
        grounding: enableGrounding,
        tm: enableTmVision,
        history: showHistory,
      })
    );
    const strongestJourney = summaryPack?.operatorJourney?.[0];
    const topActions =
      report?.actionItems?.slice(0, 3).map((item, index) => {
        const ownerText = item.owner ? ` · ${item.owner}` : '';
        return `${index + 1}. [${item.priority}] ${item.task}${ownerText}`;
      }) ?? [];
    const topCause = report?.rootCauses?.[0] ?? null;
    const impact = report?.impact;
    const lines = [
      'AegisOps escalation brief',
      `Runtime: ${runtimePosture}`,
      `Deployment: ${apiHealth?.deployment ?? summaryPack?.deployment ?? 'unknown'}`,
      `Incident: ${report?.title ?? 'not analyzed yet'}`,
      `Severity: ${report?.severity ?? 'unavailable'}`,
      `Summary: ${report?.summary ?? 'Load a preset or analyze logs/screenshots before escalating.'}`,
      `Users affected: ${impact?.estimatedUsersAffected ?? 'unavailable'}`,
      `Duration: ${impact?.duration ?? 'unavailable'}`,
      `Peak latency: ${impact?.peakLatency ?? 'unavailable'}`,
      `Peak error rate: ${impact?.peakErrorRate ?? 'unavailable'}`,
      `Top root cause: ${topCause ?? 'unavailable'}`,
      '',
      'Immediate actions',
      ...(topActions.length > 0
        ? topActions
        : ['1. Review current evidence, confirm severity, and assign the first mitigation owner.']),
      '',
      'Reviewer context',
      ...(strongestJourney
        ? [`- ${strongestJourney.surface}: ${strongestJourney.summary}`]
        : ['- Summary pack unavailable. Start with /api/healthz, /api/meta, and /api/summary-pack.']),
      ...reviewRoutes.slice(0, 4).map(([label, href]) => `- ${label}: ${href}`),
      '',
      `Share link: ${shareUrl}`,
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      addToast('success', 'Escalation brief copied');
    } catch {
      addToast('error', 'Clipboard copy failed');
    }
  };

  const runReviewLensAction = async (type: string) => {
    if (type === 'load-preset') {
      loadStrongestPreset();
      return;
    }
    if (type === 'checklist') {
      await copyReviewChecklist();
      return;
    }
    if (type === 'bundle') {
      await copyReviewerBundle();
      return;
    }
    if (type === 'claim') {
      await copyIncidentClaim();
      return;
    }
    if (type === 'escalation') {
      await copyEscalationBrief();
      return;
    }
    if (type === 'payload') {
      await copyPayloadBudgetSnapshot();
      return;
    }
    if (type === 'link') {
      await copyReviewStateLink();
      return;
    }
    if (type === 'routes') {
      await copyReviewRoutes();
    }
  };

  const handleImportLogs = (importedLogs: string) => {
    setLogs((prev) => (prev ? `${prev}\n\n${importedLogs}` : importedLogs));
    setSelectedIncidentId(null);
    setSelectedPresetSlug(null);
    addToast('success', 'Logs imported successfully');
  };

  const handleImportImages = (importedImages: File[]) => {
    processAndAddImages(importedImages);
    setSelectedIncidentId(null);
    setSelectedPresetSlug(null);
    addToast('success', 'Images imported successfully');
  };

  const handleAnalyze = async () => {
    if (!logs.trim() && images.length === 0) {
      setError('Please provide logs or screenshots to begin analysis.');
      return;
    }

    const startTime = Date.now();
    setStatus('UPLOADING');
    setError(null);
    setAnalysisProgress(0);
    setReport(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    let progressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      const imagesToAnalyze = images.slice(0, maxImages);
      if (images.length > maxImages) {
        addToast('info', `Analyzing first ${maxImages} images only (payload safeguard).`);
      }

      const base64Images = await Promise.all(
        imagesToAnalyze.map(
          (imgItem) =>
            new Promise<ApiImageInput>((resolve, reject) => {
              const reader = new FileReader();
              const timeout = setTimeout(() => reject(new Error('Image read timeout')), 5000);
              reader.onload = () => { 
                clearTimeout(timeout);
                const result = String(reader.result || "");
                const data = result.includes(",") ? (result.split(",")[1] ?? "") : result;
                resolve({ mimeType: imgItem.file.type || "image/png", data });
              };
              reader.onerror = () => { clearTimeout(timeout); reject(new Error("Failed to read image")); };
              reader.readAsDataURL(imgItem.file);
            }).catch(() => ({ mimeType: imgItem.file.type || "image/png", data: "" }))
        )
      );

      const validImages = base64Images.filter(img => img.data !== "");

      if (validImages.length < imagesToAnalyze.length) {
          addToast('error', `${imagesToAnalyze.length - validImages.length} images failed to upload. Analyzing with remaining files.`);
      }

      let effectiveLogs = logs;
      setTmError(null);
      setTmSignals([]);
      setTmStatus('IDLE');
      if (enableTmVision && tmConfigured && imagesToAnalyze.length > 0) {
        setTmStatus('RUNNING');
        try {
          const tmPredictions = await predictWithTeachableMachine(
            imagesToAnalyze.map((item) => item.file),
            { topK: 3, minProbability: 0.1 }
          );
          setTmSignals(tmPredictions);

          const tmLines = buildTeachableMachineLogLines(tmPredictions, {
            minProbability: 0.55,
            maxLines: 12,
          });
          if (tmLines.length > 0) {
            const sectionHeader = `[TM] visual classifier signals (${new Date().toISOString()})`;
            effectiveLogs = [logs.trim(), sectionHeader, ...tmLines].filter(Boolean).join('\n');
            addToast('info', `Teachable Machine added ${tmLines.length} visual signals.`);
          } else {
            addToast('info', 'Teachable Machine found no high-confidence signals.');
          }
          setTmStatus('READY');
        } catch (tmErr) {
          setTmStatus('ERROR');
          const tmMessage = tmErr instanceof Error ? tmErr.message : 'TM inference failed';
          setTmError(tmMessage);
          addToast('error', 'Teachable Machine failed. Continuing without visual signals.');
        }
      }

      if (effectiveLogs.length > maxLogChars) {
        effectiveLogs = effectiveLogs.slice(0, maxLogChars);
        addToast('info', `Logs were trimmed to ${maxLogChars.toLocaleString()} chars to match the backend payload budget.`);
      }

      progressInterval = setInterval(() => {
        setAnalysisProgress((prev) => Math.min(prev + Math.random() * 12, 90));
      }, 500);

      setStatus('ANALYZING');
      if (apiHealth?.mode === 'demo' && enableGrounding) {
        addToast('info', 'Grounding is enabled, but demo mode will not fetch web sources.');
      }
      const result = await analyzeIncident(effectiveLogs, validImages, { enableGrounding });

      if (progressInterval) clearInterval(progressInterval);
      setAnalysisProgress(100);

      const analysisTime = Date.now() - startTime;
      const saved = StorageService.saveIncident(result, effectiveLogs, images.length, analysisTime);
      setSavedIncidents((prev) => [saved, ...prev]);
      setSelectedIncidentId(saved.id);

      setReport(result);
      setStatus('COMPLETE');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      addToast('success', 'Analysis complete');
    } catch (err) {
      if (progressInterval) clearInterval(progressInterval);
      setStatus('ERROR');
      setReport(null);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      addToast('error', 'Analysis failed');
    }
  };

  const handleStartNew = () => {
    images.forEach(img => URL.revokeObjectURL(img.preview));
    
    setLogs('');
    setImages([]);
    setSelectedIncidentId(null);
    setSelectedPresetSlug(null);
    setShowHistory(false);
    setReport(null);
    setStatus('IDLE');
    setError(null);
    setAnalysisProgress(0);
    setTmSignals([]);
    setTmStatus('IDLE');
    setTmError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditInputs = () => {
    setSelectedIncidentId(null);
    setReport(null);
    setStatus('IDLE');
    setError(null);
    setAnalysisProgress(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleReAnalyze = () => {
    setReport(null);
    handleAnalyze();
  };

  const handleLoadIncident = (incident: SavedIncident) => {
    if (incident && incident.report) {
        images.forEach(img => URL.revokeObjectURL(img.preview));
        setImages([]);
        setSelectedIncidentId(incident.id);
        setSelectedPresetSlug(null);
        setShowHistory(false);
        setReport(incident.report);
        setLogs(incident.inputLogs || '');
        setStatus('COMPLETE');
        setError(null);
        setAnalysisProgress(0);
        setTmSignals([]);
        setTmStatus('IDLE');
        setTmError(null);
        setShowHistory(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        addToast('info', 'Incident loaded from history');
    }
  };

  const handleDeleteIncident = (id: string) => {
    StorageService.deleteIncident(id);
    setSavedIncidents((prev) => prev.filter((inc) => inc.id !== id));
    if (selectedIncidentId === id) {
      setSelectedIncidentId(null);
    }
    addToast('info', 'Incident deleted');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (status === 'IDLE' && (logs.trim() || images.length > 0)) {
          handleAnalyze();
        }
        return;
      }

      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTypingTarget =
        Boolean(target?.isContentEditable) ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select';
      if (isTypingTarget || e.altKey || (!e.shiftKey && (e.metaKey || e.ctrlKey))) {
        return;
      }
      if (!e.shiftKey) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'l') {
        e.preventDefault();
        void copyReviewStateLink();
      } else if (key === 'r') {
        e.preventDefault();
        void copyReviewRoutes();
      } else if (key === 'k') {
        e.preventDefault();
        void copyReviewChecklist();
      } else if (key === 'e') {
        e.preventDefault();
        void copyEvidenceSnapshot();
      } else if (key === 'b') {
        e.preventDefault();
        void copyReviewerBundle();
      } else if (key === 'm') {
        e.preventDefault();
        void copyPayloadBudgetSnapshot();
      } else if (key === 'x') {
        e.preventDefault();
        void copyEscalationBrief();
      } else if (key === 'p') {
        e.preventDefault();
        loadStrongestPreset();
      } else if (key === 'h') {
        e.preventDefault();
        setShowHistory((prev) => !prev);
      } else if (key === '?') {
        e.preventDefault();
        addToast('info', 'Hotkeys: ⌘Enter analyze · L link · R routes · K checklist · E evidence · B bundle · M payload budget · X escalation brief · P preset · H history');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    apiHealth?.deployment,
    copyEvidenceSnapshot,
    copyReviewChecklist,
    copyReviewRoutes,
    copyReviewStateLink,
    copyEscalationBrief,
    copyPayloadBudgetSnapshot,
    copyReviewerBundle,
    images.length,
    logs,
    reportSchema?.schemaId,
    summaryPack,
    reviewRoutes,
    reviewStateChips,
    runtimePosture,
    status,
  ]);

  return (
    <div className="min-h-screen bg-bg selection:bg-accent/30 selection:text-white relative overflow-hidden">
      {/* Aurora Background Effect: fixed로 변경하여 스크롤 시에도 배경 유지 */}
      <div className="fixed top-0 left-0 w-full h-[500px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent/20 via-bg/0 to-bg/0 pointer-events-none z-0" />
      
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {(status === 'UPLOADING' || status === 'ANALYZING') && (
        <LoadingOverlay progress={analysisProgress} status={status} />
      )}

      <header className="sticky top-0 z-40 bg-bg/80 backdrop-blur-md border-b border-border transition-all overflow-x-auto" role="banner">
        <div className="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between min-w-0">
          <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={handleStartNew} role="button">
            <Shield className="w-5 h-5 text-accent fill-accent/10" aria-hidden="true" />
            <span className="text-sm font-semibold tracking-tight">AegisOps</span>
            <span className="text-[9px] px-1.5 py-0.5 bg-accent/10 text-accent rounded-full font-medium border border-accent/20">
              {apiHealth ? (isStaticDemo ? 'Static demo' : apiHealth.mode === 'demo' ? 'Demo mode' : apiHealth.models.analyze) : 'Loading'}
            </span>
          </div>
          <div className="flex items-center gap-1.5" role="navigation">
            <button
              onClick={() => {
                if (isStaticDemo) {
                  addToast('info', 'Web grounding needs the local API or live backend. The Pages demo uses recorded local analysis only.');
                  return;
                }
                setEnableGrounding((p) => {
                  const next = !p;
                  if (next) addToast('info', 'Web grounding enabled. Treat results as hints and verify citations.');
                  else addToast('info', 'Web grounding disabled (default).');
                  return next;
                });
              }}
              disabled={isStaticDemo}
              className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors disabled:opacity-60 disabled:hover:text-text-muted disabled:hover:bg-transparent"
              aria-label="Toggle web grounding"
              title={
                isStaticDemo
                  ? 'Grounding requires the local API or a live backend.'
                  : 'When enabled, the model may use public web sources and attach citations.'
              }
            >
              <Globe className="w-3.5 h-3.5" />
              Grounding
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${enableGrounding ? 'bg-sev3/10 text-sev3 border-sev3/20' : 'bg-bg-card text-text-dim border-border'}`}>
                {enableGrounding ? 'ON' : 'OFF'}
              </span>
            </button>
            <button
              onClick={() => {
                if (!tmConfigured) {
                  addToast('error', 'Set VITE_TM_MODEL_URL to enable Teachable Machine.');
                  return;
                }
                setEnableTmVision((prev) => {
                  const next = !prev;
                  addToast('info', next ? 'Teachable Machine visual signals enabled.' : 'Teachable Machine visual signals disabled.');
                  return next;
                });
              }}
              className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors"
              aria-label="Toggle teachable machine visual signals"
              title="Optional local image classification before LLM analysis."
            >
              <BrainCircuit className="w-3.5 h-3.5" />
              TM Vision
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${enableTmVision ? 'bg-sev2/10 text-sev2 border-sev2/20' : 'bg-bg-card text-text-dim border-border'}`}>
                {enableTmVision ? 'ON' : 'OFF'}
              </span>
            </button>
            {!isOllamaMode && !isStaticDemo && (
              <button
                onClick={() => setShowApiKeyPanel((prev) => !prev)}
                className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors"
                aria-label="Toggle API key panel"
                title="Set Gemini API key at runtime without editing .env"
              >
                <KeyRound className="w-3.5 h-3.5" />
                API Key
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${apiHealth?.mode === 'live' ? 'bg-sev3/10 text-sev3 border-sev3/20' : 'bg-bg-card text-text-dim border-border'}`}>
                  {apiHealth?.mode === 'live' ? 'LIVE' : 'DEMO'}
                </span>
              </button>
            )}
            <button onClick={() => setShowGoogleImport(true)} className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors">
              <Download className="w-3.5 h-3.5" />Import
            </button>
            <button onClick={() => setShowDatasetExport(true)} className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors">
              <Table2 className="w-3.5 h-3.5" />Dataset
            </button>
            <button onClick={() => setShowHistory(true)} className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors">
              <History className="w-3.5 h-3.5" />
              {savedIncidents.length > 0 && <span className="bg-accent/20 text-accent px-1.5 rounded-full text-[10px] font-bold min-w-[1.25rem] text-center">{savedIncidents.length}</span>}
            </button>
            <button onClick={copyReviewStateLink} className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors">
              <FileText className="w-3.5 h-3.5" />
              Copy Review Link
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 relative z-10" role="main">
        {!report && status !== 'COMPLETE' ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
            <section className="rounded-2xl border border-border bg-bg-card/95 p-5 sm:p-6 shadow-sm space-y-5">
              <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-accent">Incident theater front door</div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                      Walk a believable incident before you talk about runtime.
                      <Sparkles className="w-4 h-4 text-accent animate-pulse" />
                    </h1>
                    <p className="text-sm text-text-muted max-w-2xl leading-6">
                      Start with a replay-backed incident claim, show exactly what is proven in this build, then use provider posture and escalation tools to guide the next conversation.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="text-[10px] px-2 py-1 rounded-full border bg-accent/10 text-accent border-accent/20">
                      {runtimePosture}
                    </span>
                    <span className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
                      {proofSummary}
                    </span>
                    <span className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
                      Schema {reportSchema?.schemaId ?? 'loading'}
                    </span>
                    {strongestPreset && (
                      <span className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
                        First click {strongestPreset.name}
                      </span>
                    )}
                  </div>

                  <div className="rounded-xl border border-border bg-bg/80 px-4 py-3 space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">What this front door proves</div>
                    <p className="text-sm text-text font-medium">{providerNarrative}</p>
                    <p className="text-2xs text-text-muted leading-5">{runtimeEvidenceNote}</p>
                  </div>

                  <div className="rounded-xl border border-border bg-bg/80 px-4 py-3 space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Right now</div>
                    <p className="text-sm text-text font-medium">{reviewLensNextAction?.label ?? 'Load Strongest Preset'}</p>
                    <p className="text-2xs text-text-muted leading-5">
                      {reviewLensNextStep?.[1] ?? 'Start from one concrete incident so the walkthrough lands before provider discussion branches.'}
                    </p>
                  </div>

                  <div className="rounded-xl border border-border bg-bg/80 px-4 py-3 space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Decision support</div>
                    <p className="text-2xs text-text-muted leading-5">Go now · {frontDoorDecisionSupport.goNow}</p>
                    <p className="text-2xs text-text-muted leading-5">Hold line · {frontDoorDecisionSupport.holdLine}</p>
                    <p className="text-2xs text-text-muted leading-5">Exit with · {frontDoorDecisionSupport.exitWith}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={loadStrongestPreset}
                      className="h-9 px-4 rounded-md border border-accent/30 bg-accent/10 hover:bg-accent/15 text-sm font-medium text-accent"
                    >
                      Load Strongest Preset
                    </button>
                    <button
                      onClick={copyReviewChecklist}
                      className="h-9 px-4 rounded-md border border-border bg-bg hover:bg-bg-hover text-sm text-text-muted hover:text-text"
                    >
                      Copy Review Checklist
                    </button>
                    <button
                      onClick={copyReviewRoutes}
                      className="h-9 px-4 rounded-md border border-border bg-bg hover:bg-bg-hover text-sm text-text-muted hover:text-text"
                    >
                      Copy Review Routes
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-bg/80 p-4 space-y-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">First review pass</div>
                  <div className="space-y-2">
                    <article className="rounded-lg border border-border bg-bg-card/70 px-3 py-3">
                      <div className="text-xs font-semibold text-text">01 · Land the incident story</div>
                      <p className="text-2xs text-text-muted mt-2 leading-5">
                        Load {strongestPreset?.name ?? 'the strongest preset'} so the first click opens on a concrete failure, screenshot, and operator-safe summary.
                      </p>
                    </article>
                    <article className="rounded-lg border border-border bg-bg-card/70 px-3 py-3">
                      <div className="text-xs font-semibold text-text">02 · Separate proof from provider posture</div>
                      <p className="text-2xs text-text-muted mt-2 leading-5">
                        Use replay pass rate and severity accuracy as the proof lane, then use provider comparison to explain deployment tradeoffs without implying live measurements.
                      </p>
                    </article>
                    <article className="rounded-lg border border-border bg-bg-card/70 px-3 py-3">
                      <div className="text-xs font-semibold text-text">03 · Exit with the right handoff</div>
                      <p className="text-2xs text-text-muted mt-2 leading-5">
                        Choose the {REVIEW_LENSES[reviewLens].label.toLowerCase()} framing, then end with a checklist, bundle, or escalation brief instead of narrating every panel live.
                      </p>
                    </article>
                  </div>
                </div>
              </div>

              <div className="border-t border-border/80 pt-5 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-accent" />
                      Reviewer / operator framing
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {Object.entries(REVIEW_LENSES).map(([key, lens]) => (
                        <button
                          key={key}
                          onClick={() => setReviewLens(key as 'quickstart' | 'commander' | 'platform')}
                          className={`h-7 px-3 rounded-full border text-[11px] font-semibold transition-colors ${
                            reviewLens === key
                              ? 'border-accent/40 bg-accent/10 text-accent'
                              : 'border-border bg-bg text-text-dim hover:text-text hover:bg-bg-hover'
                          }`}
                        >
                          {lens.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-accent">{activeReviewLens.eyebrow}</p>
                    <p className="text-sm text-text max-w-2xl font-medium">{activeReviewLens.headline}</p>
                    <p className="text-2xs text-text-muted max-w-2xl">
                      {activeReviewLens.description}
                    </p>
                    <div className="rounded-lg border border-border bg-bg/80 px-3 py-3 max-w-xl">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Right now</div>
                      <div className="text-xs font-semibold text-text mt-2">{reviewLensNextAction.label}</div>
                      <p className="text-2xs text-text-muted mt-2 leading-5">
                        {reviewLensNextStep[1]}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeReviewLens.actions.map((action) => (
                      <button
                        key={`${reviewLens}-${action.label}`}
                        onClick={() => void runReviewLensAction(action.type)}
                        className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {activeReviewLens.cards.map(([title, body]) => (
                    <article key={`${reviewLens}-${title}`} className="rounded-lg border border-border bg-bg/80 px-3 py-3">
                      <div className="text-xs font-semibold text-text">{title}</div>
                      <p className="text-2xs text-text-muted mt-2 leading-5">{body}</p>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <ReplayEvalCard
              overview={replayOverview}
              loading={replayEvalLoading}
              error={replayEvalError}
              onRefresh={loadReplayOverview}
            />

            <ProviderComparisonCard
              comparison={providerComparison}
              loading={providerComparisonLoading}
              error={providerComparisonError}
            />

            <SummaryPackCard summaryPack={summaryPack} />

            <OperatorReadinessCard
              health={apiHealth}
              meta={serviceMeta}
              schema={reportSchema}
              replayOverview={replayOverview}
              replayLoading={replayEvalLoading}
              replayError={replayEvalError}
              logs={logs}
              imageCount={images.length}
              enableGrounding={enableGrounding}
              enableTmVision={enableTmVision}
              tmConfigured={tmConfigured}
              tmStatus={tmStatus}
              apiKeySource={apiKeySource}
              onRefreshReplay={loadReplayOverview}
            />

            <div className="rounded-lg border border-border bg-bg-card/90 p-4 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-accent" />
                    Operator Dashboard
                  </div>
                  <p className="text-2xs text-text-muted max-w-2xl">
                    입력 전에 runtime posture, review flow, fast links, preset repro path를 한 번에 정리합니다.
                  </p>
                </div>
                <button
                  onClick={copyReviewChecklist}
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                >
                  Copy Review Checklist
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={copyReviewRoutes}
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                >
                  Copy Review Routes
                </button>
                <button
                  onClick={copyEvidenceSnapshot}
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                >
                  Copy Evidence Snapshot
                </button>
                <button
                  onClick={loadStrongestPreset}
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                >
                  Load Strongest Preset
                </button>
                <button
                  onClick={copyStrongestPreset}
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                >
                  Copy Strongest Preset
                </button>
                <button
                  onClick={copyIncidentClaim}
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                >
                  Copy Incident Claim
                </button>
                <button
                  onClick={copyReviewStateLink}
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                >
                  Copy Review Link
                </button>
                <button
                  onClick={copyReviewerBundle}
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                >
                  Copy Export Summary
                </button>
                <button
                  onClick={copyPayloadBudgetSnapshot}
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                >
                  Copy Payload Budget
                </button>
                <button
                  onClick={copyEscalationBrief}
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
                >
                  Copy Escalation Brief
                </button>
              </div>

              <p className="text-[11px] text-text-dim">
                Hotkeys: <span className="text-text">⌘Enter</span> analyze · <span className="text-text">L</span> link · <span className="text-text">R</span> routes · <span className="text-text">K</span> checklist · <span className="text-text">E</span> evidence · <span className="text-text">B</span> bundle · <span className="text-text">M</span> payload budget · <span className="text-text">X</span> escalation brief · <span className="text-text">P</span> preset · <span className="text-text">H</span> history
              </p>

              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] px-2 py-1 rounded-full border bg-accent/10 text-accent border-accent/20">
                  {runtimePosture}
                </span>
                <span className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
                  Schema {reportSchema?.schemaId ?? 'loading'}
                </span>
                <span className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
                  Replay {replayOverview ? `${replayOverview.summary.passRate}% pass` : 'loading'}
                </span>
                {reviewStateChips.map((chip) => (
                  <span key={chip} className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
                    {chip}
                  </span>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-bg/80 p-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Review flow</div>
                  <div className="space-y-2">
                    {(summaryPack?.twoMinuteReview?.length ? summaryPack.twoMinuteReview : [
                      { step: 'Load summary pack', surface: '/api/summary-pack', proof: 'review route unavailable' },
                    ]).map((item) => (
                      <div key={`${item.step}-${item.surface}`} className="rounded-md border border-border bg-bg-card/70 px-3 py-2">
                        <div className="text-xs font-medium text-text">{item.step}</div>
                        <div className="text-2xs text-text-muted mt-1">{item.surface}</div>
                        <div className="text-2xs text-accent mt-1">{item.proof}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-bg/80 p-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Fast review routes</div>
                  <div className="flex flex-wrap gap-2">
                    {reviewRoutes.length > 0 ? (
                      reviewRoutes.map(([label, href]) => (
                        <a
                          key={label}
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text inline-flex items-center"
                        >
                          Open {label}
                        </a>
                      ))
                    ) : (
                      <div className="text-2xs text-text-muted">Review routes are still loading.</div>
                    )}
                  </div>
                  <div className="text-2xs text-text-muted">
                    Presets stay in the same deck so operators can reproduce a strong run without hunting through the page.
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {SAMPLE_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => loadPreset(preset)}
                    className="h-7 px-3 text-xs text-text-muted hover:text-text bg-bg hover:bg-bg-hover border border-border hover:border-border-light rounded-full transition-all"
                  >
                    Load Preset: {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {isStaticDemo && (
              <div className="rounded-lg border border-border bg-bg-card/90 p-4 space-y-2">
                <div className="text-xs font-semibold flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-accent" />
                  Static demo deployment
                </div>
                <p className="text-2xs text-text-muted">
                  This Pages build runs the replay suite and deterministic local incident review in the browser. Start the local Express API to use Gemini BYOK, runtime key controls, and backend routes.
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

            {!isOllamaMode && !isStaticDemo && (showApiKeyPanel || apiHealth?.mode !== 'live') && (
              <div className="rounded-lg border border-border bg-bg-card/90 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-accent" />
                      Gemini API Key
                    </div>
                    <p className="text-2xs text-text-muted mt-1">
                      키는 백엔드 런타임 메모리에만 저장되며 서버 재시작 시 초기화됩니다.
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-1 rounded-full border ${apiHealth?.mode === 'live' ? 'bg-sev3/10 text-sev3 border-sev3/20' : 'bg-sev1/10 text-sev1 border-sev1/20'}`}>
                    {apiHealth?.mode === 'live' ? `LIVE (${apiKeySource.toUpperCase()})` : 'DEMO'}
                  </span>
                </div>
                {apiKeyMasked && (
                  <div className="text-2xs text-text-muted">
                    Active key: <span className="text-text">{apiKeyMasked}</span>
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Enter Gemini API key (e.g. AIza...)"
                    className="flex-1 h-9 px-3 rounded-md bg-bg border border-border text-xs focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                  <button
                    onClick={handleSaveApiKey}
                    disabled={apiKeyBusy}
                    className="h-9 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium disabled:opacity-60"
                  >
                    {apiKeyBusy ? 'Saving...' : 'Save Key'}
                  </button>
                  <button
                    onClick={handleClearApiKey}
                    disabled={apiKeyBusy}
                    className="h-9 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text disabled:opacity-60"
                  >
                    Clear Runtime Key
                  </button>
                </div>
              </div>
            )}

            {/* Drag & Drop Zone Wrapper */}
            <div 
              className={`relative grid md:grid-cols-2 gap-4 p-1 rounded-xl transition-all duration-300 ${isDragging ? 'ring-2 ring-accent/50 bg-accent/5 scale-[1.01]' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {isDragging && (
                 <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-[2px] rounded-xl pointer-events-none">
                    <div className="text-accent font-medium flex flex-col items-center gap-3 animate-bounce">
                        <Upload className="w-8 h-8" />
                        <span>Drop files to analyze</span>
                    </div>
                 </div>
              )}

              <div className="bg-bg-card border border-border rounded-lg p-4 flex flex-col h-[280px] shadow-sm hover:border-border-light transition-colors group">
                <div className="flex items-center justify-between mb-3">
                  <label htmlFor="log-input" className="flex items-center gap-2 text-xs font-medium text-text-muted cursor-pointer group-hover:text-text transition-colors">
                    <FileText className="w-4 h-4" />System Logs
                  </label>
                  <span className="text-[10px] text-text-dim px-2 py-0.5 bg-bg rounded-full border border-border">
                    {logs.split('\n').filter(Boolean).length} lines
                  </span>
                </div>
                <textarea
                  id="log-input"
                  value={logs}
                  onChange={(e) => {
                    setLogs(e.target.value);
                    setSelectedIncidentId(null);
                    setSelectedPresetSlug(null);
                  }}
                  placeholder="Paste raw logs here..."
                  className="flex-1 w-full p-3 bg-bg border border-border rounded-md text-xs font-mono text-text placeholder-text-dim/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 transition-all leading-relaxed"
                  spellCheck={false}
                />
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className={`${logsOverBudget ? 'text-sev1' : logsNearBudget ? 'text-sev2' : 'text-text-dim'}`}>
                    {logCharsUsed.toLocaleString()} / {maxLogChars.toLocaleString()} chars
                  </span>
                  <span className="text-text-dim">
                    {logCharsRemaining.toLocaleString()} chars remaining
                  </span>
                </div>
                {logsOverBudget ? (
                  <p className="mt-1 text-[10px] text-sev1">
                    Analyze will trim logs to the backend limit before upload.
                  </p>
                ) : logsNearBudget ? (
                  <p className="mt-1 text-[10px] text-sev2">
                    Near the payload limit. Extra context may be trimmed after Teachable Machine signals are appended.
                  </p>
                ) : null}
              </div>

              <div className="bg-bg-card border border-border rounded-lg p-4 flex flex-col h-[280px] shadow-sm hover:border-border-light transition-colors group">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-text-muted group-hover:text-text transition-colors">
                    <ImageIcon className="w-4 h-4" />Screenshots
                  </div>
                  <span className="text-[10px] text-text-dim px-2 py-0.5 bg-bg rounded-full border border-border">
                    {images.length} files
                  </span>
                </div>
                
                <div className="flex-1 flex flex-col">
                  {images.length > 0 ? (
                    <div className="flex-1 p-2 bg-bg border border-border rounded-md mb-2 overflow-y-auto grid grid-cols-3 gap-2 content-start">
                      {images.map((imgItem, idx) => (
                        <div key={idx} className="relative group/img aspect-square rounded overflow-hidden border border-border bg-black">
                          <img src={imgItem.preview} alt="" className="w-full h-full object-cover opacity-80 group-hover/img:opacity-100 transition-opacity" />
                          <button onClick={() => removeImage(idx)} aria-label="Remove screenshot" className="absolute top-1 right-1 w-5 h-5 bg-black/60 hover:bg-red-500/90 text-white rounded-full flex items-center justify-center opacity-0 group-hover/img:opacity-100 focus:opacity-100 transition-all">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    <label className="aspect-square rounded border border-dashed border-border flex items-center justify-center cursor-pointer hover:bg-bg-hover hover:border-text-dim transition-colors text-text-dim" aria-label="Add more screenshots">
                      <Upload className="w-4 h-4" aria-hidden="true" />
                      <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" aria-label="Upload screenshots" />
                    </label>
                  </div>
                  ) : (
                    <label className="flex-1 flex flex-col items-center justify-center border border-dashed border-border rounded-md cursor-pointer hover:border-text-dim hover:bg-bg-hover/50 transition-all text-text-dim">
                      <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                        <Upload className="w-5 h-5 opacity-50" />
                      </div>
                      <span className="text-xs font-medium">Click or Drag images</span>
                      <span className="text-[10px] opacity-60 mt-1">Supports PNG, JPG</span>
                      <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                    </label>
                  )}
                  <div className="mt-2 flex items-center justify-between text-[10px]">
                    <span className={`${extraImages > 0 ? 'text-sev2' : 'text-text-dim'}`}>
                      {imagesWithinBudget} / {maxImages} images will be analyzed
                    </span>
                    <span className="text-text-dim">
                      {extraImages > 0 ? `${extraImages} extra files ignored` : 'Within image budget'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {payloadGuardrail && (
              <div className="rounded-lg border border-sev2/20 bg-sev2/5 px-4 py-3 space-y-1">
                <div className="text-[11px] uppercase tracking-[0.18em] text-sev2">{payloadGuardrail.title}</div>
                <p className="text-sm text-text font-medium">{payloadGuardrail.detail}</p>
                <p className="text-2xs text-text-muted leading-5">{payloadGuardrail.next}</p>
              </div>
            )}

            {error && (
              <div role="alert" aria-live="assertive" className="flex items-start gap-3 p-4 bg-sev1/5 border border-sev1/20 rounded-lg text-xs text-sev1 animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 leading-relaxed">{error}</div>
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={(!logs.trim() && images.length === 0) || status !== 'IDLE'}
              aria-busy={status !== 'IDLE'}
              aria-label={status === 'IDLE' ? 'Run incident analysis' : 'Analysis in progress'}
              className={`w-full h-11 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all shadow-sm ${
                (logs.trim() || images.length > 0) && status === 'IDLE' ? 'bg-accent hover:bg-accent-hover text-white shadow-[0_0_20px_rgba(139,92,246,0.2)] hover:shadow-[0_0_25px_rgba(139,92,246,0.3)] hover:scale-[1.01] active:scale-[0.99]' : 'bg-bg-card text-text-dim border border-border cursor-not-allowed opacity-50'
              }`}
            >
              {status === 'IDLE' ? <><Zap className="w-4 h-4 fill-white/20" aria-hidden="true" />Run Analysis</> : <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Processing...</>}
            </button>
            {enableGrounding && (
              <div className="text-2xs text-sev3/90 border border-sev3/20 bg-sev3/5 rounded-lg px-3 py-2 leading-relaxed">
                Web grounding is enabled. Only trust claims that include references, and treat web results as hints (not source of truth).
              </div>
            )}
            {tmConfigured && (
              <div className="text-2xs border border-border bg-bg-card/60 rounded-lg px-3 py-2 leading-relaxed">
                <div className="font-medium text-text mb-1">
                  Teachable Machine status: <span className="text-accent">{tmStatus}</span>
                </div>
                <div className="text-text-muted">
                  {enableTmVision
                    ? 'Image uploads are pre-scored locally and high-confidence labels are appended to analysis context.'
                    : 'TM Vision is disabled. Enable it from the top bar when model URL is configured.'}
                </div>
                {tmError && <div className="text-sev1 mt-1">TM error: {tmError}</div>}
                {tmSignals.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {tmSignals.slice(0, 3).map((row) => (
                      <div key={row.fileName} className="text-text-muted">
                        <span className="text-text">{row.fileName}:</span>{' '}
                        {row.predictions
                          .map((p) => `${p.className} ${(p.probability * 100).toFixed(0)}%`)
                          .join(', ')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="text-center text-[10px] text-text-dim">
                Shortcut: <kbd className="font-mono bg-bg-card px-1 py-0.5 rounded border border-border">Cmd/Ctrl + Enter</kbd>
            </div>
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
            <div className="flex items-center gap-2 sticky top-14 z-30 py-2 bg-bg/90 backdrop-blur md:static md:bg-transparent md:backdrop-blur-none">
              <button onClick={handleStartNew} className="h-8 px-3 text-xs text-text-muted hover:text-text bg-bg-card hover:bg-bg-hover border border-border rounded-full flex items-center gap-1.5 transition-colors shadow-sm"><X className="w-3.5 h-3.5" />Start New</button>
              <button onClick={handleEditInputs} className="h-8 px-3 text-xs text-text-muted hover:text-text bg-bg-card hover:bg-bg-hover border border-border rounded-full flex items-center gap-1.5 transition-colors shadow-sm"><Edit3 className="w-3.5 h-3.5" />Edit Inputs</button>
              <div className="flex-1" />
              <button onClick={handleReAnalyze} className="h-8 px-3 text-xs text-text-muted hover:text-text bg-bg-card hover:bg-bg-hover border border-border rounded-full flex items-center gap-1.5 transition-colors shadow-sm"><RefreshCw className="w-3.5 h-3.5" />Re-analyze</button>
            </div>
            <ReportCard report={report!} enableGrounding={enableGrounding} ttsAvailable={ttsAvailable} />
          </div>
        )}
      </main>

      <CommunityHub />

      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowHistory(false)}>
          <div className="w-full max-w-lg max-h-[70vh] overflow-hidden bg-bg-card border border-border rounded-xl shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-border bg-bg-card flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2"><History className="w-4 h-4 text-accent" /> Incident History</span>
              <button onClick={() => setShowHistory(false)} className="p-1 hover:bg-bg-hover rounded-full transition-colors"><X className="w-4 h-4 text-text-muted" /></button>
            </div>
            <div className="p-2 overflow-y-auto max-h-[60vh] scrollbar-thin">
                <IncidentHistory incidents={savedIncidents} onSelect={handleLoadIncident} onDelete={handleDeleteIncident} />
            </div>
          </div>
        </div>
      )}

      {showGoogleImport && <GoogleImport onImportLogs={handleImportLogs} onImportImages={handleImportImages} onClose={() => setShowGoogleImport(false)} />}
      {showDatasetExport && <DatasetExport incidents={savedIncidents} onClose={() => setShowDatasetExport(false)} />}
    </div>
  );
}
