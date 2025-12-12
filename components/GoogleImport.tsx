
import React, { useState } from 'react';
import { Mail, HardDrive, Search, Download, Check, Loader2, FileText, Image as ImageIcon, X, LogIn, AlertCircle } from 'lucide-react';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import { GmailService, GmailMessage } from '../services/GmailService';
import { DriveService, DriveFile } from '../services/DriveService';

interface Props {
  onImportLogs: (logs: string) => void;
  onImportImages: (images: File[]) => void;
  onClose: () => void;
}

export const GoogleImport: React.FC<Props> = ({ onImportLogs, onImportImages, onClose }) => {
  const { isAuthenticated, user, accessToken, signIn, isLoading: authLoading, isDemoMode } = useGoogleAuth();
  const [tab, setTab] = useState<'gmail' | 'drive'>('gmail');
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);

  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [selEmails, setSelEmails] = useState<Set<string>>(new Set());
  const [emailQ, setEmailQ] = useState('');

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selFiles, setSelFiles] = useState<Set<string>>(new Set());
  const [driveQ, setDriveQ] = useState('');

  const searchGmail = async () => {
    if (!accessToken) return;
    setSearching(true);

    if (isDemoMode) {
      await new Promise((r) => setTimeout(r, 600)); // Simulate latency
      setEmails([
        { id: '1', subject: '[ALERT] High CPU on prod-api-01', from: 'alerts@datadog.com', date: '2025-01-15', snippet: 'CPU usage exceeded 90% threshold...', body: '[ERROR] CPU 95%\n[WARN] Memory 82%' },
        { id: '2', subject: '[PagerDuty] Incident #4521 Triggered', from: 'noreply@pagerduty.com', date: '2025-01-15', snippet: 'Redis cluster unreachable...', body: '[CRITICAL] Redis connection timeout\n[ERROR] Cache miss rate 100%' },
        { id: '3', subject: '[ALERT] Database replication lag', from: 'alerts@datadog.com', date: '2025-01-14', snippet: 'Replication lag > 30s...', body: '[WARN] Replication lag: 45s\n[INFO] Primary: db-master-01' },
      ]);
    } else {
      try {
        const r = await GmailService.searchAlertEmails(accessToken, { customQuery: emailQ || undefined });
        setEmails(r.messages);
      } catch (e) {
        console.error(e);
      }
    }
    setSearching(false);
  };

  const searchDrive = async () => {
    if (!accessToken) return;
    setSearching(true);

    if (isDemoMode) {
      await new Promise((r) => setTimeout(r, 600)); // Simulate latency
      setFiles([
        { id: '1', name: 'grafana-cpu-spike.png', mimeType: 'image/png', size: 245000 },
        { id: '2', name: 'incident-2025-01-15.log', mimeType: 'text/plain', size: 12400 },
        { id: '3', name: 'datadog-dashboard.png', mimeType: 'image/png', size: 189000 },
      ]);
    } else {
      try {
        const r = await DriveService.searchIncidentFiles(accessToken, { query: driveQ || undefined });
        setFiles(r.files);
      } catch (e) {
        console.error(e);
      }
    }
    setSearching(false);
  };

  const importGmail = async () => {
    if (!accessToken || !selEmails.size) return;
    setImporting(true);

    if (isDemoMode) {
      await new Promise((r) => setTimeout(r, 800));
      const selected = emails.filter((e) => selEmails.has(e.id));
      const logs = selected.map((e) => `=== ${e.subject} ===\n${e.body}`).join('\n\n');
      onImportLogs(logs);
    } else {
      const logs = await GmailService.batchExtractLogs(emails.filter((e) => selEmails.has(e.id)));
      onImportLogs(logs);
    }

    setImporting(false);
    onClose();
  };

  const importDrive = async () => {
    if (!accessToken || !selFiles.size) return;
    setImporting(true);

    if (isDemoMode) {
      await new Promise((r) => setTimeout(r, 1000));
      const selected = files.filter((f) => selFiles.has(f.id));
      const logFiles = selected.filter((f) => !f.mimeType.startsWith('image/'));
      const imgFiles = selected.filter((f) => f.mimeType.startsWith('image/'));

      if (logFiles.length) {
        onImportLogs(logFiles.map((f) => `=== ${f.name} ===\n[Demo Mode: Content for ${f.name}]\n[2025-01-15 10:00:00] ERROR: Simulated log entry`).join('\n\n'));
      }
      
      if (imgFiles.length) {
        // [Demo Mode] Use visual purple box placeholder instead of red pixel for better video demo
        const placeholderBase64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAALUlEQVR42u3RAQ0AAAgDIJ/6N5WCB9R0oJ1O1+l0nU7X6XSdTtfpdJ1O1+l0XfsAE12D4Z5+1R4AAAAASUVORK5CYII=";
        const byteCharacters = atob(placeholderBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {type: 'image/png'});
        
        const demoImages = imgFiles.map(f => new File([blob], f.name, { type: f.mimeType }));
        onImportImages(demoImages);
      }
    } else {
      // [Updated Logic] Use the new DownloadedFile structure
      const downloadedItems = await DriveService.downloadMultipleFiles(accessToken, files.filter((f) => selFiles.has(f.id)));
      
      const logItems = downloadedItems.filter(i => i.type === 'log');
      const imgItems = downloadedItems.filter(i => i.type === 'image');

      if (logItems.length) {
        const mergedLogs = logItems.map(item => `=== ${item.name} ===\n${item.data}`).join('\n\n');
        onImportLogs(mergedLogs);
      }

      if (imgItems.length) {
        const imgFiles = imgItems.map((item) => {
          const arr = Uint8Array.from(atob(item.data), (c) => c.charCodeAt(0));
          // Preserve original filename
          return new File([arr], item.name, { type: item.mimeType });
        });
        onImportImages(imgFiles);
      }
    }

    setImporting(false);
    onClose();
  };

  const toggleEmail = (id: string) => setSelEmails((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleFile = (id: string) => setSelFiles((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="w-full max-w-md bg-bg-card border border-border rounded overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span id="import-title" className="text-xs font-medium">Import from Google Workspace</span>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded" aria-label="Close import dialog"><X className="w-3.5 h-3.5 text-text-muted" aria-hidden="true" /></button>
        </div>

        {!isAuthenticated ? (
          <div className="p-8 text-center">
            <LogIn className="w-10 h-10 text-accent mx-auto mb-4 opacity-50" aria-hidden="true" />
            <p className="text-xs text-text-muted mb-4">Connect your Google account to access Gmail and Drive.</p>
            <button onClick={signIn} disabled={authLoading} className="h-8 px-4 text-xs bg-accent hover:bg-accent-hover rounded text-white">
              {authLoading ? 'Connecting...' : 'Connect Google'}
            </button>
          </div>
        ) : (
          <>
            <div className="px-3 py-1.5 bg-bg text-2xs text-text-dim border-b border-border flex items-center gap-2">
              <span>{user?.email}</span>
              {isDemoMode && <span className="px-1.5 py-0.5 bg-sev2/20 text-sev2 rounded text-2xs">Demo</span>}
            </div>

            <div className="flex border-b border-border" role="tablist">
              <button 
                onClick={() => setTab('gmail')} 
                className={`flex-1 py-2 text-2xs flex items-center justify-center gap-1.5 ${tab === 'gmail' ? 'text-text border-b-2 border-accent' : 'text-text-muted'}`}
                role="tab"
                aria-selected={tab === 'gmail'}
              >
                <Mail className="w-3 h-3" aria-hidden="true" />Gmail
              </button>
              <button 
                onClick={() => setTab('drive')} 
                className={`flex-1 py-2 text-2xs flex items-center justify-center gap-1.5 ${tab === 'drive' ? 'text-text border-b-2 border-accent' : 'text-text-muted'}`}
                role="tab"
                aria-selected={tab === 'drive'}
              >
                <HardDrive className="w-3 h-3" aria-hidden="true" />Drive
              </button>
            </div>

            <div className="p-3">
              {tab === 'gmail' ? (
                <div className="space-y-3" role="tabpanel">
                  <div className="flex gap-1.5">
                    <input 
                      value={emailQ} 
                      onChange={(e) => setEmailQ(e.target.value)} 
                      placeholder="Search alert emails..." 
                      className="flex-1 h-7 px-2 text-xs bg-bg border border-border rounded placeholder-text-dim focus:outline-none focus:border-border-light" 
                      aria-label="Search emails"
                    />
                    <button onClick={searchGmail} disabled={searching} className="h-7 px-3 text-xs bg-accent hover:bg-accent-hover rounded text-white flex items-center gap-1" aria-label="Search">
                      {searching ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Search className="w-3 h-3" aria-hidden="true" />}
                    </button>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1" role="list">
                    {!emails.length ? (
                      <div className="text-center py-6 text-2xs text-text-dim">No emails found. Try a different search.</div>
                    ) : (
                      emails.map((e) => (
                        <div 
                          key={e.id} 
                          onClick={() => toggleEmail(e.id)} 
                          onKeyDown={(ev) => { if(ev.key === 'Enter' || ev.key === ' ') toggleEmail(e.id); }}
                          role="checkbox"
                          aria-checked={selEmails.has(e.id)}
                          tabIndex={0}
                          className={`p-2 rounded border cursor-pointer ${selEmails.has(e.id) ? 'bg-accent/10 border-accent' : 'bg-bg border-border hover:border-border-light'}`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${selEmails.has(e.id) ? 'bg-accent border-accent' : 'border-border'}`} aria-hidden="true">
                              {selEmails.has(e.id) && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs truncate">{e.subject}</div>
                              <div className="text-2xs text-text-dim truncate">{e.from}</div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {selEmails.size > 0 && (
                    <button onClick={importGmail} disabled={importing} className="w-full h-8 text-xs bg-accent hover:bg-accent-hover rounded text-white flex items-center justify-center gap-1.5">
                      {importing ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <><Download className="w-3 h-3" aria-hidden="true" />Import {selEmails.size} email(s)</>}
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3" role="tabpanel">
                  <div className="flex gap-1.5">
                    <input 
                      value={driveQ} 
                      onChange={(e) => setDriveQ(e.target.value)} 
                      placeholder="Search log files or screenshots..." 
                      className="flex-1 h-7 px-2 text-xs bg-bg border border-border rounded placeholder-text-dim focus:outline-none focus:border-border-light" 
                      aria-label="Search drive files"
                    />
                    <button onClick={searchDrive} disabled={searching} className="h-7 px-3 text-xs bg-accent hover:bg-accent-hover rounded text-white flex items-center gap-1" aria-label="Search">
                      {searching ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Search className="w-3 h-3" aria-hidden="true" />}
                    </button>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1" role="list">
                    {!files.length ? (
                      <div className="text-center py-6 text-2xs text-text-dim">No matching files found.</div>
                    ) : (
                      files.map((f) => (
                        <div 
                          key={f.id} 
                          onClick={() => toggleFile(f.id)} 
                          onKeyDown={(ev) => { if(ev.key === 'Enter' || ev.key === ' ') toggleFile(f.id); }}
                          role="checkbox"
                          aria-checked={selFiles.has(f.id)}
                          tabIndex={0}
                          className={`p-2 rounded border cursor-pointer flex items-center gap-2 ${selFiles.has(f.id) ? 'bg-accent/10 border-accent' : 'bg-bg border-border hover:border-border-light'}`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center ${selFiles.has(f.id) ? 'bg-accent border-accent' : 'border-border'}`} aria-hidden="true">
                            {selFiles.has(f.id) && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                          {f.mimeType?.startsWith('image/') ? <ImageIcon className="w-4 h-4 text-accent" aria-hidden="true" /> : <FileText className="w-4 h-4 text-text-dim" aria-hidden="true" />}
                          <span className="text-xs truncate flex-1">{f.name}</span>
                        </div>
                      ))
                    )}
                  </div>

                  {selFiles.size > 0 && (
                    <button onClick={importDrive} disabled={importing} className="w-full h-8 text-xs bg-accent hover:bg-accent-hover rounded text-white flex items-center justify-center gap-1.5">
                      {importing ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <><Download className="w-3 h-3" aria-hidden="true" />Import {selFiles.size} file(s)</>}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
