
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, History, FileText, Image as ImageIcon, Upload, X, AlertCircle, Loader2, Download, Table2, Zap, Sparkles, RefreshCw, Edit3, Globe } from 'lucide-react';
import type { IncidentReport, SavedIncident, AnalysisStatus } from './types';
import { analyzeIncident, fetchHealthz, type HealthzResponse } from './services/geminiService';
import { StorageService } from './services/StorageService';
import { ReportCard } from './components/ReportCard';
import { IncidentHistory } from './components/IncidentHistory';
import { LoadingOverlay } from './components/LoadingOverlay';
import { GoogleImport } from './components/GoogleImport';
import { DatasetExport } from './components/DatasetExport';
import { ToastContainer, ToastMessage } from './components/Toast';

// [Type Definition] 이미지 파일과 미리보기 URL을 함께 관리하기 위한 인터페이스
interface ImageFile {
  file: File;
  preview: string;
}

interface ApiImageInput {
  mimeType: string;
  data: string;
}

// [Demo Data] A small purple placeholder image (64x64) representing a generic chart for better video visibility
// Previously: 1x1 transparent pixel (invisible in demo)
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

export default function App() {
  // [State Management]
  const [logs, setLogs] = useState('');
  
  // [Fix & Optimization] File 객체와 Preview URL 관리
  const [images, setImages] = useState<ImageFile[]>([]);
  
  // [Optimization] Lazy Initialization: 렌더링 시점에 바로 데이터를 읽어와 깜빡임 방지
  const [savedIncidents, setSavedIncidents] = useState<SavedIncident[]>(() => StorageService.getIncidents());

  const [report, setReport] = useState<IncidentReport | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStartTime, setAnalysisStartTime] = useState<number | null>(null);
  const [apiHealth, setApiHealth] = useState<HealthzResponse | null>(null);
  const [enableGrounding, setEnableGrounding] = useState(false);
  
  // Modals & UI State
  const [showHistory, setShowHistory] = useState(false);
  const [showGoogleImport, setShowGoogleImport] = useState(false);
  const [showDatasetExport, setShowDatasetExport] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // [Ref-based Cleanup] 컴포넌트가 언마운트될 때 최신 images 상태를 참조하기 위해 ref 사용
  const imagesRef = useRef(images);
  
  // 상태가 변경될 때마다 ref 업데이트 (렌더링 사이클에 영향 주지 않음)
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // [Effect] 메모리 누수 방지: 컴포넌트가 완전히 사라질 때만 실행
  useEffect(() => {
    return () => {
      // ref를 통해 최신 이미지 목록에 접근하여 cleanup
      imagesRef.current.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, []); 

  // API health preflight (demo/live mode, limits, models)
  useEffect(() => {
    let mounted = true;
    fetchHealthz()
      .then((h) => { if (mounted) setApiHealth(h); })
      .catch(() => { if (mounted) setApiHealth(null); });
    return () => { mounted = false; };
  }, []);

  // Initialize grounding toggle from server defaults (only once).
  useEffect(() => {
    if (!apiHealth) return;
    setEnableGrounding((prev) => prev || apiHealth.defaults?.grounding || false);
  }, [apiHealth]);

  const addToast = (type: ToastMessage['type'], message: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // [Helper] 파일 배열을 받아 ImageFile 상태로 변환 및 추가
  const processAndAddImages = (files: File[]) => {
    const newImages = files.map(file => ({
      file,
      preview: URL.createObjectURL(file)
    }));
    setImages(prev => [...prev, ...newImages]);
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

      // 1. 이미지 처리
      if (imageFiles.length > 0) {
        const imgCount = processAndAddImages(imageFiles);
        addToast('info', `${imgCount} screenshots added`);
      }

      // 2. 텍스트 파일 처리 (순차적/비동기 읽기 이슈 해결)
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
      addToast('info', `${count} screenshots added`);
    }
    // [Fix] 동일한 파일을 다시 선택할 수 있도록 value 초기화
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.preview); // 개별 삭제 시 메모리 즉시 해제
      return prev.filter((_, i) => i !== index);
    });
  };

  const loadPreset = async (preset: (typeof SAMPLE_PRESETS)[0]) => {
    // 1. Logs
    setLogs(preset.logs);

    // 2. Demo Image (If preset has image)
    if (preset.hasImage) {
        // Create a dummy file object from base64 to simulate a screenshot
        const byteCharacters = atob(DEMO_IMG_BASE64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {type: 'image/png'});
        const file = new File([blob], "monitoring_dashboard.png", { type: 'image/png' });
        
        // Clear existing and add new
        images.forEach(img => URL.revokeObjectURL(img.preview));
        const newImages = [{ file, preview: URL.createObjectURL(file) }];
        setImages(newImages);
    } else {
        setImages([]);
    }

    setError(null);
    addToast('info', `Preset "${preset.name}" loaded with screenshots`);
  };

  const handleImportLogs = (importedLogs: string) => {
    // [Fix] Import 시에도 줄바꿈 정책 통일
    setLogs((prev) => (prev ? `${prev}\n\n${importedLogs}` : importedLogs));
    addToast('success', 'Logs imported successfully');
  };

  const handleImportImages = (importedImages: File[]) => {
    processAndAddImages(importedImages);
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
    setAnalysisStartTime(startTime);
    setReport(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    let progressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      const maxImages = apiHealth?.limits?.maxImages ?? 16;
      const imagesToAnalyze = images.slice(0, maxImages);
      if (images.length > maxImages) {
        addToast('info', `Analyzing first ${maxImages} images only (payload safeguard).`);
      }

      // 이미지 전처리: File -> { mimeType, base64 }
      const base64Images = await Promise.all(
        imagesToAnalyze.map(
          (imgItem) =>
            new Promise<ApiImageInput>((resolve, reject) => {
              const reader = new FileReader();
              const timeout = setTimeout(() => reject(new Error('Image read timeout')), 5000);
              reader.onload = () => { 
                clearTimeout(timeout);
                const result = String(reader.result || "");
                const data = result.includes(",") ? result.split(",")[1] : result;
                resolve({ mimeType: imgItem.file.type || "image/png", data });
              };
              reader.onerror = () => { clearTimeout(timeout); reject(new Error("Failed to read image")); };
              reader.readAsDataURL(imgItem.file);
            }).catch(() => ({ mimeType: imgItem.file.type || "image/png", data: "" }))
        )
      );

      const validImages = base64Images.filter(img => img.data !== "");
      
      // [Validation] 일부 이미지가 로드 실패한 경우 경고
      if (validImages.length < imagesToAnalyze.length) {
          addToast('error', `${imagesToAnalyze.length - validImages.length} images failed to upload. Analyzing with remaining files.`);
      }

      // 가짜 진행률 (UX)
      progressInterval = setInterval(() => {
        setAnalysisProgress((prev) => Math.min(prev + Math.random() * 12, 90));
      }, 500);

      setStatus('ANALYZING');
      if (apiHealth?.mode === 'demo' && enableGrounding) {
        addToast('info', 'Grounding is enabled, but demo mode will not fetch web sources.');
      }
      const result = await analyzeIncident(logs, validImages, { enableGrounding });

      if (progressInterval) clearInterval(progressInterval);
      setAnalysisProgress(100);

      const analysisTime = Date.now() - startTime;
      const saved = StorageService.saveIncident(result, logs, images.length, analysisTime);
      setSavedIncidents((prev) => [saved, ...prev]);

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
    // [Cleanup] 기존 이미지 URL 전체 해제
    images.forEach(img => URL.revokeObjectURL(img.preview));
    
    setLogs('');
    setImages([]);
    setReport(null);
    setStatus('IDLE');
    setError(null);
    setAnalysisProgress(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditInputs = () => {
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
        setReport(incident.report);
        setLogs(incident.inputLogs || '');
        setStatus('COMPLETE');
        setShowHistory(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        addToast('info', 'Incident loaded from history');
    }
  };

  const handleDeleteIncident = (id: string) => {
    StorageService.deleteIncident(id);
    setSavedIncidents((prev) => prev.filter((inc) => inc.id !== id));
    addToast('info', 'Incident deleted');
  };

  // Keyboard Shortcut: Cmd+Enter or Ctrl+Enter to analyze
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (status === 'IDLE' && (logs.trim() || images.length > 0)) {
          handleAnalyze();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [logs, images, status]);

  return (
    <div className="min-h-screen bg-bg selection:bg-accent/30 selection:text-white relative overflow-hidden">
      {/* Aurora Background Effect: fixed로 변경하여 스크롤 시에도 배경 유지 */}
      <div className="fixed top-0 left-0 w-full h-[500px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent/20 via-bg/0 to-bg/0 pointer-events-none z-0" />
      
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {(status === 'UPLOADING' || status === 'ANALYZING') && (
        <LoadingOverlay progress={analysisProgress} status={status} />
      )}

      <header className="sticky top-0 z-40 bg-bg/80 backdrop-blur-md border-b border-border transition-all" role="banner">
        <div className="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={handleStartNew} role="button">
            <Shield className="w-5 h-5 text-accent fill-accent/10" aria-hidden="true" />
            <span className="text-sm font-semibold tracking-tight">AegisOps</span>
            <span className="text-[9px] px-1.5 py-0.5 bg-accent/10 text-accent rounded-full font-medium border border-accent/20">
              {apiHealth ? (apiHealth.mode === 'demo' ? 'Demo mode' : apiHealth.models.analyze) : 'API offline'}
            </span>
          </div>
          <div className="flex items-center gap-1.5" role="navigation">
            <button
              onClick={() => {
                setEnableGrounding((p) => {
                  const next = !p;
                  if (next) addToast('info', 'Web grounding enabled. Treat results as hints and verify citations.');
                  else addToast('info', 'Web grounding disabled (default).');
                  return next;
                });
              }}
              className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors"
              aria-label="Toggle web grounding"
              title="When enabled, the model may use public web sources and attach citations."
            >
              <Globe className="w-3.5 h-3.5" />
              Grounding
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${enableGrounding ? 'bg-sev3/10 text-sev3 border-sev3/20' : 'bg-bg-card text-text-dim border-border'}`}>
                {enableGrounding ? 'ON' : 'OFF'}
              </span>
            </button>
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
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 relative z-10" role="main">
        {!report && status !== 'COMPLETE' ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
            <div className="mb-8 text-center sm:text-left">
              <h1 className="text-xl font-semibold mb-2 flex items-center gap-2 justify-center sm:justify-start">
                Incident Analysis <Sparkles className="w-4 h-4 text-accent animate-pulse" />
              </h1>
              <p className="text-sm text-text-muted max-w-xl">
                Paste system logs or drag & drop monitoring screenshots. 
                <br className="hidden sm:block"/>AI will deduce root causes and generate a structured post-mortem instantly.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {SAMPLE_PRESETS.map((preset) => (
                <button key={preset.name} onClick={() => loadPreset(preset)} className="h-7 px-3 text-xs text-text-muted hover:text-text bg-bg-card hover:bg-bg-hover border border-border hover:border-border-light rounded-full transition-all">
                  Load Preset: {preset.name}
                </button>
              ))}
            </div>

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
                  <span className="text-[10px] text-text-dim px-2 py-0.5 bg-bg rounded-full border border-border">{logs.split('\n').filter(Boolean).length} lines</span>
                </div>
                <textarea
                  id="log-input"
                  value={logs}
                  onChange={(e) => setLogs(e.target.value)}
                  placeholder="Paste raw logs here..."
                  className="flex-1 w-full p-3 bg-bg border border-border rounded-md text-xs font-mono text-text placeholder-text-dim/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 transition-all leading-relaxed"
                  spellCheck={false}
                />
              </div>

              <div className="bg-bg-card border border-border rounded-lg p-4 flex flex-col h-[280px] shadow-sm hover:border-border-light transition-colors group">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-text-muted group-hover:text-text transition-colors">
                    <ImageIcon className="w-4 h-4" />Screenshots
                  </div>
                  <span className="text-[10px] text-text-dim px-2 py-0.5 bg-bg rounded-full border border-border">{images.length} files</span>
                </div>
                
                <div className="flex-1 flex flex-col">
                  {images.length > 0 ? (
                    <div className="flex-1 p-2 bg-bg border border-border rounded-md mb-2 overflow-y-auto grid grid-cols-3 gap-2 content-start">
                      {images.map((imgItem, idx) => (
                        <div key={idx} className="relative group/img aspect-square rounded overflow-hidden border border-border bg-black">
                          {/* [Fix] 저장된 preview URL 사용 */}
                          <img src={imgItem.preview} alt="" className="w-full h-full object-cover opacity-80 group-hover/img:opacity-100 transition-opacity" />
                          <button onClick={() => removeImage(idx)} className="absolute top-1 right-1 w-5 h-5 bg-black/60 hover:bg-red-500/90 text-white rounded-full flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-all">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <label className="aspect-square rounded border border-dashed border-border flex items-center justify-center cursor-pointer hover:bg-bg-hover hover:border-text-dim transition-colors text-text-dim">
                        <Upload className="w-4 h-4" />
                        <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
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
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 p-4 bg-sev1/5 border border-sev1/20 rounded-lg text-xs text-sev1 animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">{error}</div>
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={(!logs.trim() && images.length === 0) || status !== 'IDLE'}
              className={`w-full h-11 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all shadow-sm ${
                (logs.trim() || images.length > 0) && status === 'IDLE' ? 'bg-accent hover:bg-accent-hover text-white shadow-[0_0_20px_rgba(139,92,246,0.2)] hover:shadow-[0_0_25px_rgba(139,92,246,0.3)] hover:scale-[1.01]' : 'bg-bg-card text-text-dim border border-border cursor-not-allowed opacity-50'
              }`}
            >
              {status === 'IDLE' ? <><Zap className="w-4 h-4 fill-white/20" />Run Analysis</> : <><Loader2 className="w-4 h-4 animate-spin" />Processing...</>}
            </button>
            {enableGrounding && (
              <div className="text-2xs text-sev3/90 border border-sev3/20 bg-sev3/5 rounded-lg px-3 py-2 leading-relaxed">
                Web grounding is enabled. Only trust claims that include references, and treat web results as hints (not source of truth).
              </div>
            )}
            <div className="text-center text-[10px] text-text-dim">
                Pro tip: Press <kbd className="font-mono bg-bg-card px-1 py-0.5 rounded border border-border">Cmd/Ctrl + Enter</kbd> to run immediately
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
            <ReportCard report={report!} allIncidents={savedIncidents} enableGrounding={enableGrounding} />
          </div>
        )}
      </main>

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
