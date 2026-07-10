
import React from 'react';
import { Shield, History, FileText, Download, Table2, Globe, BrainCircuit, KeyRound } from 'lucide-react';
import type { AppState } from '../hooks/useAppState';

interface AppHeaderProps {
  state: AppState;
}

export function AppHeader({ state }: AppHeaderProps) {
  const {
    apiHealth,
    isStaticDemo,
    isOllamaMode,
    enableGrounding,
    setEnableGrounding,
    enableTmVision,
    setEnableTmVision,
    tmConfigured,
    savedIncidents,
    setShowApiKeyPanel,
    setShowGoogleImport,
    setShowHistory,
    setShowDatasetExport,
    copyReviewStateLink,
    handleStartNew,
    addToast,
  } = state;

  return (
    <header className="sticky top-0 z-40 bg-bg/80 backdrop-blur-md border-b border-border transition-all" role="banner">
      <div className="max-w-4xl mx-auto px-4 min-h-12 py-2 flex flex-col gap-2 sm:h-12 sm:flex-row sm:items-center sm:justify-between sm:py-0">
        <button
          type="button"
          className="flex items-center gap-2 self-start bg-transparent p-0 text-left hover:opacity-80 transition-opacity"
          onClick={handleStartNew}
          aria-label="Start a new AegisOps review"
        >
          <Shield className="w-5 h-5 text-accent fill-accent/10" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">AegisOps</span>
          <span className="text-[9px] px-1.5 py-0.5 bg-accent/10 text-accent rounded-full font-medium border border-accent/20">
            {apiHealth ? (isStaticDemo ? 'Static demo' : apiHealth.mode === 'demo' ? 'Demo mode' : apiHealth.models.analyze) : 'Loading'}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5" role="navigation" aria-label="AegisOps actions">
          <button
            type="button"
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
            type="button"
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
              type="button"
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
          <button type="button" onClick={() => setShowGoogleImport(true)} className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors">
            <Download className="w-3.5 h-3.5" />Import
          </button>
          <button type="button" onClick={() => setShowDatasetExport(true)} className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors">
            <Table2 className="w-3.5 h-3.5" />Dataset
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors"
            aria-label="Open incident history"
            title="Open incident history"
          >
            <History className="w-3.5 h-3.5" />
            {savedIncidents.length > 0 && <span className="bg-accent/20 text-accent px-1.5 rounded-full text-[10px] font-bold min-w-[1.25rem] text-center">{savedIncidents.length}</span>}
          </button>
          <button type="button" onClick={copyReviewStateLink} className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors">
            <FileText className="w-3.5 h-3.5" />
            Copy Review Link
          </button>
        </div>
      </div>
    </header>
  );
}
