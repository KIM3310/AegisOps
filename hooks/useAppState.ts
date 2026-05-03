
import { useState, useEffect, useCallback, useRef } from 'react';
import type { IncidentReport, SavedIncident, AnalysisStatus, ReplayEvalOverview } from '../types';
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
} from '../services/geminiService';
import { StorageService } from '../services/StorageService';
import {
  buildTeachableMachineLogLines,
  isTeachableMachineConfigured,
  predictWithTeachableMachine,
  type TmImagePrediction,
} from '../services/teachableMachineService';
import type { ToastMessage } from '../components/Toast';
import {
  buildReviewShareUrl,
  buildReviewUrlSearch,
  parseReviewUrlState,
  replaceReviewUrlSearch,
  slugifyPresetName,
} from '../utils/urlState';
import {
  DEMO_IMG_BASE64,
  SAMPLE_PRESETS,
  REVIEW_LENSES,
  type ImageFile,
  type ApiImageInput,
  type ReviewLensKey,
} from '../constants';

export function useAppState() {
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
  const [reviewLens, setReviewLens] = useState<ReviewLensKey>('quickstart');
  const [reviewStateHydrated, setReviewStateHydrated] = useState(false);

  const imagesRef = useRef(images);
  const initialReviewStateRef = useRef(initialReviewUrlState);
  const appliedInitialReviewState = useRef(false);

  // Derived state
  const reviewRoutes = summaryPack
    ? Object.entries(summaryPack.links).filter(([, href]) => typeof href === 'string' && href.length > 0)
    : [];
  const runtimePosture = apiHealth
    ? `${apiHealth.mode === 'live' ? 'Live backend' : 'Demo backend'} \u00b7 ${(apiHealth.provider || 'unknown').toUpperCase()}`
    : 'Loading backend posture';
  const strongestPreset =
    SAMPLE_PRESETS.find((preset) => preset.name === 'LLM Latency Spike') ?? SAMPLE_PRESETS[0] ?? null;
  const proofSummary = replayOverview
    ? `${replayOverview.summary.passRate}% replay pass \u00b7 ${replayOverview.summary.severityAccuracy}% severity accuracy`
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
        const ownerText = item.owner ? ` \u00b7 ${item.owner}` : '';
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
      'Operator context',
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

  return {
    // State
    logs,
    setLogs,
    images,
    savedIncidents,
    report,
    status,
    error,
    analysisProgress,
    apiHealth,
    summaryPack,
    serviceMeta,
    reportSchema,
    providerComparison,
    providerComparisonError,
    providerComparisonLoading,
    replayOverview,
    replayEvalError,
    replayEvalLoading,
    apiKeyInput,
    setApiKeyInput,
    apiKeyMasked,
    apiKeyBusy,
    apiKeySource,
    showApiKeyPanel,
    setShowApiKeyPanel,
    enableGrounding,
    setEnableGrounding,
    tmConfigured,
    isOllamaMode,
    isStaticDemo,
    ttsAvailable,
    enableTmVision,
    setEnableTmVision,
    tmStatus,
    tmError,
    tmSignals,
    showHistory,
    setShowHistory,
    showGoogleImport,
    setShowGoogleImport,
    showDatasetExport,
    setShowDatasetExport,
    toasts,
    isDragging,
    selectedIncidentId,
    setSelectedIncidentId,
    selectedPresetSlug,
    setSelectedPresetSlug,
    reviewLens,
    setReviewLens,

    // Derived
    reviewRoutes,
    runtimePosture,
    strongestPreset,
    proofSummary,
    providerNarrative,
    runtimeEvidenceNote,
    maxLogChars,
    maxImages,
    logCharsUsed,
    logCharsRemaining,
    logsNearBudget,
    logsOverBudget,
    imagesWithinBudget,
    extraImages,
    payloadGuardrail,
    reviewStateChips,
    activeReviewLens,
    reviewLensNextAction,
    reviewLensNextStep,
    frontDoorDecisionSupport,

    // Handlers
    removeToast,
    addToast,
    handleSaveApiKey,
    handleClearApiKey,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleImageUpload,
    removeImage,
    loadPreset,
    loadStrongestPreset,
    copyReviewChecklist,
    copyReviewRoutes,
    copyReviewStateLink,
    copyReviewerBundle,
    copyEvidenceSnapshot,
    copyPayloadBudgetSnapshot,
    copyStrongestPreset,
    copyIncidentClaim,
    copyEscalationBrief,
    runReviewLensAction,
    handleImportLogs,
    handleImportImages,
    handleAnalyze,
    handleStartNew,
    handleEditInputs,
    handleReAnalyze,
    handleLoadIncident,
    handleDeleteIncident,
    loadReplayOverview,
  };
}

export type AppState = ReturnType<typeof useAppState>;
