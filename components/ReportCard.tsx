
import React, { useState, useRef, useEffect } from 'react';
import { AlertTriangle, Clock, Users, Target, CheckCircle2, ChevronDown, Copy, Download, FileJson, FileText, Hash, Code, Lightbulb, MessageSquare, Share2, Link as LinkIcon, Check, Brain, Gauge, ExternalLink, Volume2, StopCircle, Loader2 } from 'lucide-react';
import type { IncidentReport, SavedIncident, ExportFormat } from '../types';
import { ExportService } from '../services/ExportService';
import { StorageService } from '../services/StorageService';
import { GeminiService } from '../services/geminiService';
import { Timeline } from './Timeline';
import { MetricsChart } from './MetricsChart';
import { FollowUpChat } from './FollowUpChat';
import { SimilarIncidents } from './SimilarIncidents';
import { GoogleExport } from './GoogleExport';

interface Props {
  report: IncidentReport;
  allIncidents?: SavedIncident[];
}

const sevMap: Record<string, { c: string; bg: string; dot: string }> = {
  SEV1: { c: 'text-sev1', bg: 'bg-sev1/10', dot: 'bg-sev1' },
  SEV2: { c: 'text-sev2', bg: 'bg-sev2/10', dot: 'bg-sev2' },
  SEV3: { c: 'text-sev3', bg: 'bg-sev3/10', dot: 'bg-sev3' },
  UNKNOWN: { c: 'text-text-muted', bg: 'bg-bg-card', dot: 'bg-text-dim' },
};

/**
 * Helper: Decode Base64 Raw PCM (Int16) to AudioBuffer
 */
const decodeAudioData = async (
  base64Data: string, 
  ctx: AudioContext
): Promise<AudioBuffer> => {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const safeLength = bytes.length - (bytes.length % 2);
  const int16Data = new Int16Array(bytes.buffer, bytes.byteOffset, safeLength / 2);
  
  if (int16Data.length === 0) {
      throw new Error("Audio data is empty or corrupted");
  }

  const sampleRate = 24000;
  const numChannels = 1;
  const buffer = ctx.createBuffer(numChannels, int16Data.length, sampleRate);
  const channelData = buffer.getChannelData(0);
  
  for (let i = 0; i < int16Data.length; i++) {
    channelData[i] = int16Data[i] / 32768.0;
  }
  
  return buffer;
};

/**
 * [Component] MarkdownText
 * Enhanced to support:
 * 1. Code Blocks (```)
 * 2. Inline Code (`)
 * 3. Bold (**)
 * 4. Markdown Links [text](url)
 * 5. Raw URLs (https://...)
 */
const MarkdownText: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  if (!text) return null;

  // Split by code blocks first
  const blocks = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((block, blockIdx) => {
        // If it's a code block
        if (block.startsWith('```') && block.endsWith('```')) {
          const content = block.slice(3, -3).replace(/^json\n|^bash\n|^log\n/, '');
          return (
            <div key={blockIdx} className="bg-black/30 border border-border rounded-md p-3 overflow-x-auto my-2">
              <pre className="text-[11px] font-mono text-text-muted whitespace-pre-wrap leading-relaxed">{content.trim()}</pre>
            </div>
          );
        }

        // If it's regular text, parse lines
        return (
          <div key={blockIdx} className="space-y-1">
            {block.split('\n').map((line, lineIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={lineIdx} className="h-1.5" />;

              const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
              const isOrdered = /^\d+\.\s/.test(trimmed);
              
              let content = trimmed;
              if (isBullet) content = trimmed.substring(2);
              else if (isOrdered) content = trimmed.replace(/^\d+\.\s/, '');

              // Parse: Inline Code -> Markdown Links -> Bold -> Raw URLs
              // Note: Splitting order matters. 
              
              // 1. Inline Code (`...`)
              const parts = content.split(/(`[^`]+`)/g).map((segment, i) => {
                 if (segment.startsWith('`') && segment.endsWith('`')) {
                     return <code key={`code-${i}`} className="bg-bg-card border border-border px-1.5 rounded text-[11px] font-mono text-accent/90 mx-0.5">{segment.slice(1, -1)}</code>;
                 }
                 
                 // 2. Markdown Links [text](url)
                 return segment.split(/(\[[^\]]+\]\([^)]+\))/g).map((sub, j) => {
                    const linkMatch = sub.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
                    if (linkMatch) {
                        return (
                            <a key={`mdlink-${i}-${j}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline font-medium inline-flex items-center gap-0.5">
                                {linkMatch[1]}<ExternalLink className="w-2.5 h-2.5 opacity-50"/>
                            </a>
                        );
                    }

                    // 3. Bold (**...**)
                    return sub.split(/(\*\*.*?\*\*)/g).map((word, k) => {
                        if (word.startsWith('**') && word.endsWith('**')) {
                            return <strong key={`bold-${i}-${j}-${k}`} className="font-semibold text-text">{word.slice(2, -2)}</strong>;
                        }

                        // 4. Raw URLs (https://...)
                        return word.split(/(https?:\/\/[^\s]+)/g).map((token, l) => {
                             if (token.match(/^https?:\/\//)) {
                                 const match = token.match(/^(https?:\/\/[^\s]+?)([.,;)]*)$/);
                                 if (match) {
                                     const url = match[1];
                                     const punctuation = match[2];
                                     return (
                                         <React.Fragment key={`rawlink-${i}-${j}-${k}-${l}`}>
                                             <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline break-all">{url}</a>
                                             {punctuation}
                                         </React.Fragment>
                                     );
                                 }
                                 return <a key={`rawlink-${i}-${j}-${k}-${l}`} href={token} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline break-all">{token}</a>;
                             }
                             return token;
                        });
                    });
                 });
              });

              return (
                <div key={lineIdx} className={`flex gap-2 ${isBullet || isOrdered ? 'pl-2' : ''}`}>
                  {isBullet && <span className="text-text-dim select-none mt-1.5 w-1 h-1 rounded-full bg-text-dim/50 flex-shrink-0" />}
                  {isOrdered && <span className="text-text-dim select-none font-mono text-2xs pt-0.5 w-4 flex-shrink-0">{trimmed.match(/^\d+/)?.[0]}.</span>}
                  <div className="flex-1 leading-relaxed break-words text-text-muted">{parts}</div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

// Section Component
interface SectionProps {
  id: string;
  title: string;
  icon: React.ElementType;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ id, title, icon: Icon, count, isOpen, onToggle, children }) => (
  <div className="border-b border-border last:border-0 group">
    <button 
      onClick={onToggle} 
      className="w-full px-6 py-4 flex items-center justify-between hover:bg-bg-hover/30 transition-colors focus:outline-none"
    >
      <div className="flex items-center gap-3 text-sm font-medium text-text-muted group-hover:text-text transition-colors">
        <Icon className="w-4.5 h-4.5 opacity-70" aria-hidden="true" />
        {title}
        {count !== undefined && <span className="text-text-dim text-[10px] bg-bg border border-border px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center">{count}</span>}
      </div>
      <ChevronDown className={`w-4 h-4 text-text-dim transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
    </button>
    <div className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
      <div className="overflow-hidden">
          <div className="px-6 pb-6 pt-0">{children}</div>
      </div>
    </div>
  </div>
);

export const ReportCard: React.FC<Props> = ({ report }) => {
  const [exp, setExp] = useState({ timeline: true, causes: true, actions: true, prevention: false, references: true, chat: false });
  const [copied, setCopied] = useState<string | null>(null);
  const [showGoogleExport, setShowGoogleExport] = useState(false);

  // Audio / TTS State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  const s = sevMap[report.severity] || sevMap.UNKNOWN;
  const similar = StorageService.findSimilarIncidents(report);
  const confidence = report.confidenceScore || 0;
  
  const confColor = confidence >= 85 ? 'text-green-500' : confidence >= 60 ? 'text-sev3' : 'text-sev2';

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const copy = async (f: ExportFormat) => {
    const r = ExportService.exportReport(report, f);
    await ExportService.copyToClipboard(r.content);
    setCopied(f);
    setTimeout(() => setCopied(null), 2000);
  };

  const dl = (f: ExportFormat) => {
    const r = ExportService.exportReport(report, f);
    ExportService.downloadFile(r.content, r.filename, r.mimeType);
  };

  const copyItem = async (text: string, id: string) => {
    await ExportService.copyToClipboard(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) { /* ignore already stopped */ }
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  const playSummary = async () => {
    if (isPlaying) {
      stopAudio();
      return;
    }

    setIsLoadingAudio(true);
    try {
      if (!audioContextRef.current) {
        // @ts-ignore: Handle Webkit browsers
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioCtor();
      }
      
      // Critical: Ensure context is running (fixes "The AudioContext was not allowed to start" error)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const base64Audio = await GeminiService.generateTTS(report.summary);
      if (!base64Audio) {
         console.warn("No audio data returned from TTS service");
         return;
      }

      const buffer = await decodeAudioData(base64Audio, audioContextRef.current);
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => setIsPlaying(false);
      
      sourceNodeRef.current = source;
      source.start();
      setIsPlaying(true);
    } catch (e) {
      console.error("Failed to play audio", e);
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const toggleSection = (key: keyof typeof exp) => {
    setExp(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* 1. Reasoning Block */}
      {report.reasoning && (
        <div className="bg-gradient-to-br from-bg-card to-bg border border-accent/20 rounded-xl p-6 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-50">
             <Brain className="w-24 h-24 text-accent/5 -rotate-12" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-accent animate-pulse" />
              <span className="text-xs font-bold text-accent tracking-wider uppercase">AI Reasoning Engine</span>
            </div>
            <div className="text-sm text-text-muted leading-relaxed italic border-l-2 border-accent/50 pl-4 py-1 bg-black/10 rounded-r-md">
              <MarkdownText text={report.reasoning} />
            </div>
          </div>
        </div>
      )}

      {/* 2. Main Header Card */}
      <div className="bg-bg-card border border-border rounded-xl p-6 shadow-sm relative overflow-hidden group hover:border-border-light transition-colors">
        {confidence > 0 && (
          <div className="absolute top-5 right-5 flex items-center gap-2 bg-bg/50 backdrop-blur px-3 py-1.5 rounded-full border border-border shadow-sm">
             <Gauge className={`w-4 h-4 ${confColor}`} />
             <div className="flex flex-col leading-none">
                 <span className="text-[9px] font-bold text-text-dim uppercase tracking-wider">Confidence</span>
                 <span className={`text-xs font-bold ${confColor} tabular-nums`}>{confidence}%</span>
             </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${s.dot} shadow-[0_0_8px_rgba(0,0,0,0.3)] animate-pulse`} />
            <span className={`text-xs font-bold px-2 py-0.5 rounded border ${s.bg} border-transparent ${s.c}`}>{report.severity}</span>
            <span className="text-xs text-text-dim border-l border-border pl-2.5">{new Date().toLocaleDateString()}</span>
          </div>
          
          <div className="pr-20">
            <h1 className="text-2xl font-bold leading-tight mb-3 text-text">{report.title}</h1>
            
            <div className="relative group/summary">
                <div className="text-sm text-text-muted leading-relaxed max-w-4xl">
                  <MarkdownText text={report.summary} />
                </div>
                
                {/* TTS Button */}
                <button
                    onClick={playSummary}
                    disabled={isLoadingAudio}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg hover:bg-bg-hover border border-border rounded-full text-xs font-medium text-text-muted transition-colors hover:text-accent disabled:opacity-50"
                >
                    {isLoadingAudio ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isPlaying ? (
                        <StopCircle className="w-3.5 h-3.5 text-sev1" />
                    ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                    )}
                    {isLoadingAudio ? 'Generating Audio...' : isPlaying ? 'Stop Reading' : 'Read Summary'}
                </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            {report.tags.map((t, i) => (
              <span key={i} className="text-[10px] font-medium text-text-dim px-2.5 py-1 bg-bg rounded-full border border-border uppercase tracking-wide hover:border-accent/30 hover:text-accent transition-colors cursor-default">#{t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Impact Metrics */}
      {report.impact && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: Users, label: 'Affected Users', val: report.impact.estimatedUsersAffected },
            { icon: Clock, label: 'Duration', val: report.impact.duration },
            { icon: AlertTriangle, label: 'Peak Latency', val: report.impact.peakLatency },
            { icon: Target, label: 'Peak Error Rate', val: report.impact.peakErrorRate },
          ].map(({ icon: I, label, val }) => (
            <div key={label} className="bg-bg-card border border-border rounded-lg p-4 flex flex-col gap-2 hover:border-border-light transition-colors group">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-bg group-hover:bg-accent/10 transition-colors">
                    <I className="w-3.5 h-3.5 text-text-dim group-hover:text-accent transition-colors" />
                </div>
                <span className="text-[10px] font-medium text-text-dim uppercase tracking-wider">{label}</span>
              </div>
              <div className="text-base font-semibold text-text truncate pl-1">{val || '—'}</div>
            </div>
          ))}
        </div>
      )}

      {/* 4. Details Accordion */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        
        <Section id="timeline" title="Incident Timeline" icon={Clock} count={report.timeline.length} isOpen={exp.timeline} onToggle={() => toggleSection('timeline')}>
          <Timeline events={report.timeline} />
          <MetricsChart timeline={report.timeline} />
        </Section>

        <Section id="causes" title="Root Causes" icon={Target} count={report.rootCauses.length} isOpen={exp.causes} onToggle={() => toggleSection('causes')}>
          <div className="space-y-3">
            {report.rootCauses.map((c, i) => (
              <div key={i} className="flex gap-4 text-sm p-4 bg-bg rounded-lg border border-border/50 hover:border-border transition-colors">
                <div className="flex flex-col items-center gap-1">
                    <span className="w-6 h-6 rounded bg-sev1/10 text-sev1 flex items-center justify-center flex-shrink-0 text-[11px] font-bold border border-sev1/20">{i + 1}</span>
                    {i < report.rootCauses.length -1 && <div className="w-px h-full bg-border/50 my-1"/>}
                </div>
                <div className="text-text-muted py-0.5"><MarkdownText text={c} /></div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="actions" title="Action Items" icon={CheckCircle2} count={report.actionItems.length} isOpen={exp.actions} onToggle={() => toggleSection('actions')}>
          <div className="space-y-2">
            {report.actionItems.map((a, i) => (
              <div key={i} className="flex items-start justify-between text-sm gap-4 p-3 bg-bg rounded-lg border border-border/50 group hover:border-border transition-colors">
                <div className="flex gap-3 flex-1">
                  <div className={`w-1 h-auto rounded-full ${a.priority === 'HIGH' ? 'bg-sev1' : a.priority === 'MEDIUM' ? 'bg-sev2' : 'bg-green-500'}`} />
                  <div className="flex-1 py-0.5">
                    <div className="font-medium text-text-muted group-hover:text-text transition-colors"><MarkdownText text={a.task} /></div>
                    {a.owner && <div className="text-[10px] text-text-dim mt-1.5 flex items-center gap-1.5">Assignee: <span className="bg-bg-card px-2 py-0.5 rounded border border-border font-medium">{a.owner}</span></div>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wide border ${a.priority === 'HIGH' ? 'bg-sev1/10 text-sev1 border-sev1/20' : a.priority === 'MEDIUM' ? 'bg-sev2/10 text-sev2 border-sev2/20' : 'bg-green-500/10 text-green-500 border-green-500/20'}`}>{a.priority}</span>
                  <button onClick={() => copyItem(a.task, `action-${i}`)} className="p-1.5 text-text-dim hover:text-text hover:bg-bg-hover rounded opacity-0 group-hover:opacity-100 transition-opacity" title="Copy task">
                     {copied === `action-${i}` ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="prevention" title="Prevention & Lessons" icon={Lightbulb} count={report.preventionRecommendations?.length || 0} isOpen={exp.prevention} onToggle={() => toggleSection('prevention')}>
          <div className="space-y-6">
            {report.preventionRecommendations?.length ? (
              <div>
                  <h4 className="text-xs font-semibold text-text mb-3 uppercase tracking-wider opacity-70">Recommendations</h4>
                  <ul className="space-y-3">
                    {report.preventionRecommendations.map((p, i) => (
                      <li key={i} className="flex gap-3 text-sm group">
                        <CheckCircle2 className="w-5 h-5 text-green-500/50 flex-shrink-0 group-hover:text-green-500 transition-colors" />
                        <div className="text-text-muted"><MarkdownText text={p} /></div>
                      </li>
                    ))}
                  </ul>
              </div>
            ) : null}
            {report.lessonsLearned && (
              <div className="p-5 bg-bg/50 rounded-lg border border-border border-dashed relative">
                <div className="absolute top-0 left-0 w-1 h-full bg-accent/30 rounded-l-lg" />
                <div className="text-[10px] font-bold text-text-dim uppercase tracking-wider mb-2 flex items-center gap-2"><Brain className="w-3 h-3"/> Lessons Learned</div>
                <div className="text-sm text-text-muted italic leading-relaxed"><MarkdownText text={report.lessonsLearned} /></div>
              </div>
            )}
          </div>
        </Section>
        
        {report.references && report.references.length > 0 && (
          <Section id="references" title="References" icon={LinkIcon} count={report.references.length} isOpen={exp.references} onToggle={() => toggleSection('references')}>
             <div className="grid gap-2">
               {report.references.map((ref, i) => (
                 <a key={i} href={ref.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-bg hover:bg-bg-hover rounded-lg border border-border group transition-all">
                   <div className="w-8 h-8 rounded bg-bg-card border border-border flex items-center justify-center flex-shrink-0 group-hover:border-accent/50 transition-colors">
                     <LinkIcon className="w-3.5 h-3.5 text-text-dim group-hover:text-accent" />
                   </div>
                   <div className="flex-1 min-w-0">
                     <div className="text-xs font-medium text-text group-hover:text-accent truncate transition-colors">{ref.title}</div>
                     <div className="text-2xs text-text-dim truncate font-mono opacity-70">{ref.uri}</div>
                   </div>
                   <ExternalLink className="w-3.5 h-3.5 text-text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
                 </a>
               ))}
             </div>
          </Section>
        )}

        <Section id="chat" title="Assistant Chat" icon={MessageSquare} isOpen={exp.chat} onToggle={() => toggleSection('chat')}>
          <FollowUpChat report={report} />
        </Section>
      </div>

      {/* 5. Footer: Similar & Export */}
      <div className="grid md:grid-cols-2 gap-4">
        {similar.length > 0 && (
          <div className="bg-bg-card border border-border rounded-xl p-5 hover:border-border-light transition-colors">
            <div className="text-xs font-medium text-text-muted mb-3 flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5 text-accent" />Similar Past Incidents
            </div>
            <SimilarIncidents incidents={similar} />
          </div>
        )}

        <div className="bg-bg-card border border-border rounded-xl p-5 hover:border-border-light transition-colors">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-medium text-text-muted">Export & Share</span>
            <button onClick={() => setShowGoogleExport(true)} className="h-7 px-3 text-[10px] font-medium bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent rounded-md flex items-center gap-1.5 transition-colors">
              <Share2 className="w-3 h-3" />
              Google Workspace
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { f: 'json', i: FileJson, label: 'JSON' },
              { f: 'markdown', i: FileText, label: 'Markdown' },
              { f: 'slack', i: Hash, label: 'Slack' },
              { f: 'jira', i: Code, label: 'Jira' },
            ].map(({ f, i: I, label }) => (
              <div key={f} className="flex rounded-md shadow-sm overflow-hidden border border-border group hover:border-border-light transition-all">
                <button onClick={() => copy(f as ExportFormat)} className="h-8 pl-3 pr-2 bg-bg hover:bg-bg-hover flex items-center gap-1.5 transition-colors border-r border-border focus:outline-none">
                  {copied === f ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <I className="w-3.5 h-3.5 text-text-muted group-hover:text-text" />}
                  <span className="text-[10px] font-medium text-text-muted group-hover:text-text">{label}</span>
                </button>
                <button onClick={() => dl(f as ExportFormat)} className="h-8 px-2.5 bg-bg hover:bg-bg-hover flex items-center justify-center transition-colors focus:outline-none border-l border-transparent hover:border-border" title="Download file">
                  <Download className="w-3.5 h-3.5 text-text-dim hover:text-text" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showGoogleExport && <GoogleExport report={report} onClose={() => setShowGoogleExport(false)} />}
    </div>
  );
};
