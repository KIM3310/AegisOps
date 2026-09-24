
import React from 'react';
import { useAppState } from './hooks/useAppState';
import { ToastContainer } from './components/Toast';
import { LoadingOverlay } from './components/LoadingOverlay';
import { AppHeader } from './components/AppHeader';
import { FrontDoorSection } from './components/FrontDoorSection';
import { OperatorDashboard } from './components/OperatorDashboard';
import { DeploymentBanners } from './components/DeploymentBanners';
import { ApiKeyPanel } from './components/ApiKeyPanel';
import { IncidentInputPanel } from './components/IncidentInputPanel';
import { AnalyzeControls } from './components/AnalyzeControls';
import { ReportView } from './components/ReportView';
import { HistoryModal } from './components/HistoryModal';
import { ReplayEvalCard } from './components/ReplayEvalCard';
import { ProviderComparisonCard } from './components/ProviderComparisonCard';
import { SummaryPackCard } from './components/SummaryPackCard';
import { OperatorReadinessCard } from './components/OperatorReadinessCard';
import { GoogleImport } from './components/GoogleImport';
import { DatasetExport } from './components/DatasetExport';
import { CommunityHub } from './components/CommunityHub';
import { PublicSectorIntro } from './components/PublicSectorIntro';
import { ResponseWorkflowCard } from './components/ResponseWorkflowCard';
import { PUBLIC_SECTOR_SAMPLE_LOGS } from './knowledge/sampleManuals';

export default function App() {
  const state = useAppState();

  const {
    report,
    status,
    analysisProgress,
    toasts,
    removeToast,
    isOllamaMode,
    isStaticDemo,
    showApiKeyPanel,
    apiHealth,
    showHistory,
    setShowHistory,
    showGoogleImport,
    setShowGoogleImport,
    showDatasetExport,
    setShowDatasetExport,
    savedIncidents,
    handleLoadIncident,
    handleDeleteIncident,
    handleImportLogs,
    handleImportImages,
    handleStartNew,
    handleEditInputs,
    handleReAnalyze,
    enableGrounding,
    ttsAvailable,
    replayOverview,
    replayEvalLoading,
    replayEvalError,
    loadReplayOverview,
    providerComparison,
    providerComparisonLoading,
    providerComparisonError,
    summaryPack,
    serviceMeta,
    reportSchema,
    logs,
    images,
    enableTmVision,
    tmConfigured,
    tmStatus,
    apiKeySource,
  } = state;
  const reportSnapshot = savedIncidents.find((incident) => incident.id === state.selectedIncidentId && incident.report === report);

  return (
    <div className="min-h-screen bg-bg selection:bg-accent/30 selection:text-white relative overflow-hidden">
      {/* Aurora Background Effect */}
      <div className="fixed top-0 left-0 w-full h-[500px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent/20 via-bg/0 to-bg/0 pointer-events-none z-0" />

      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {(status === 'UPLOADING' || status === 'ANALYZING') && (
        <LoadingOverlay progress={analysisProgress} status={status} />
      )}

      <AppHeader state={state} />

      <main className="max-w-4xl mx-auto px-4 py-8 relative z-10" role="main">
        {!report && status !== 'COMPLETE' ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
            <PublicSectorIntro onLoadSample={() => {
              handleStartNew();
              state.setLogs(PUBLIC_SECTOR_SAMPLE_LOGS);
              state.setEnableGrounding(false);
              state.setEnableTmVision(false);
            }} />
            <DeploymentBanners isStaticDemo={isStaticDemo} isOllamaMode={isOllamaMode} />
            {!isOllamaMode && !isStaticDemo && (showApiKeyPanel || apiHealth?.mode !== 'live') && (
              <ApiKeyPanel state={state} />
            )}
            <IncidentInputPanel state={state} />
            <AnalyzeControls state={state} />
            <ResponseWorkflowCard />
            <details className="rounded-xl border border-border bg-bg-card p-4">
              <summary className="cursor-pointer font-medium">선택 기능 · 아키텍처, 평가 및 제공자 비교</summary>
              <div className="mt-4 space-y-6">
                <FrontDoorSection state={state} />

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

                <OperatorDashboard state={state} />

              </div>
            </details>
          </div>
        ) : (
          <ReportView
            report={report!}
            responseSubmission={reportSnapshot ? {
              schemaVersion: 1,
              clientIncidentId: reportSnapshot.id,
              report: reportSnapshot.report,
              evidence: {
                logs: reportSnapshot.inputLogs,
                declaredImageCount: reportSnapshot.imageCount,
              },
            } : null}
            enableGrounding={enableGrounding}
            ttsAvailable={ttsAvailable}
            onStartNew={handleStartNew}
            onEditInputs={handleEditInputs}
            onReAnalyze={handleReAnalyze}
          />
        )}
      </main>

      <CommunityHub />

      {showHistory && (
        <HistoryModal
          savedIncidents={savedIncidents}
          onClose={() => setShowHistory(false)}
          onSelect={handleLoadIncident}
          onDelete={handleDeleteIncident}
        />
      )}

      {showGoogleImport && <GoogleImport onImportLogs={handleImportLogs} onImportImages={handleImportImages} onClose={() => setShowGoogleImport(false)} />}
      {showDatasetExport && <DatasetExport incidents={savedIncidents} onClose={() => setShowDatasetExport(false)} />}
    </div>
  );
}
