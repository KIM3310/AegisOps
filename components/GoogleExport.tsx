
import React, { useState, useEffect } from 'react';
import { FileText, Presentation, Calendar, MessageSquare, ExternalLink, Loader2, Check, X, LogIn, Settings } from 'lucide-react';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import { DocsService } from '../services/DocsService';
import { SlidesService } from '../services/SlidesService';
import { CalendarService } from '../services/CalendarService';
import { ChatService } from '../services/ChatService';
import type { IncidentReport } from '../types';

interface Props {
  report: IncidentReport;
  onClose: () => void;
}

type ExportType = 'docs' | 'slides' | 'calendar' | 'chat';

interface ExportResult {
  type: ExportType;
  url?: string;
  success: boolean;
  error?: string;
}

export const GoogleExport: React.FC<Props> = ({ report, onClose }) => {
  const { isAuthenticated, accessToken, signIn, isLoading: authLoading, isDemoMode } = useGoogleAuth();
  const [exporting, setExporting] = useState<ExportType | null>(null);
  const [results, setResults] = useState<ExportResult[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [showWebhook, setShowWebhook] = useState(false);

  // Load webhook URL from local storage on mount
  useEffect(() => {
    const savedUrl = localStorage.getItem('aegisops_webhook_url');
    if (savedUrl) setWebhookUrl(savedUrl);
  }, []);

  const handleWebhookChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setWebhookUrl(val);
    localStorage.setItem('aegisops_webhook_url', val);
  };

  const exportTo = async (type: ExportType) => {
    if (!accessToken) return;
    setExporting(type);

    try {
      let url = '';

      if (isDemoMode) {
        await new Promise((r) => setTimeout(r, 1500));
        const demoUrls: Record<ExportType, string> = {
          docs: 'https://docs.google.com/document/d/demo-postmortem',
          slides: 'https://docs.google.com/presentation/d/demo-slides',
          calendar: 'https://calendar.google.com/event?eid=demo',
          chat: '',
        };
        url = demoUrls[type];
      } else {
        switch (type) {
          case 'docs':
            const doc = await DocsService.createPostMortemDoc(accessToken, report);
            url = doc.url;
            break;
          case 'slides':
            const slide = await SlidesService.createIncidentSlides(accessToken, report);
            url = slide.url;
            break;
          case 'calendar':
            const event = await CalendarService.createReviewMeeting(accessToken, report);
            url = event.url;
            break;
          case 'chat':
            if (!webhookUrl) {
              setShowWebhook(true);
              setExporting(null);
              return;
            }
            await ChatService.sendToChatWebhook(webhookUrl, report);
            break;
        }
      }

      setResults((p) => [...p, { type, url, success: true }]);
    } catch (e) {
      setResults((p) => [...p, { type, success: false, error: String(e) }]);
    }

    setExporting(null);
  };

  const getResult = (type: ExportType) => results.find((r) => r.type === type);

  const exports: { type: ExportType; icon: any; title: string; desc: string }[] = [
    { type: 'docs', icon: FileText, title: 'Google Docs', desc: 'Generate Post-Mortem Doc' },
    { type: 'slides', icon: Presentation, title: 'Google Slides', desc: 'Generate Executive Slides' },
    { type: 'calendar', icon: Calendar, title: 'Google Calendar', desc: 'Schedule Post-Mortem Review' },
    { type: 'chat', icon: MessageSquare, title: 'Google Chat', desc: 'Post to Team Channel' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="w-full max-w-md bg-bg-card border border-border rounded overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span id="export-title" className="text-xs font-medium">Export Report to Workspace</span>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded" aria-label="Close export dialog"><X className="w-3.5 h-3.5 text-text-muted" aria-hidden="true" /></button>
        </div>

        {!isAuthenticated ? (
          <div className="p-8 text-center">
            <LogIn className="w-10 h-10 text-accent mx-auto mb-4 opacity-50" aria-hidden="true" />
            <p className="text-xs text-text-muted mb-4">Connect Google to enable exports</p>
            <button onClick={signIn} disabled={authLoading} className="h-8 px-4 text-xs bg-accent hover:bg-accent-hover rounded text-white">
              {authLoading ? 'Connecting...' : 'Connect Google'}
            </button>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {isDemoMode && (
              <div className="px-2 py-1.5 bg-sev2/10 border border-sev2/20 rounded text-2xs text-sev2 mb-3" role="status">
                Demo mode - simulated exports
              </div>
            )}

            {exports.map(({ type, icon: Icon, title, desc }) => {
              const result = getResult(type);
              const isLoading = exporting === type;

              return (
                <div key={type} className="flex items-center gap-3 p-2 bg-bg rounded border border-border">
                  <div className="w-8 h-8 rounded bg-accent/10 flex items-center justify-center" aria-hidden="true">
                    <Icon className="w-4 h-4 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">{title}</div>
                    <div className="text-2xs text-text-dim">{desc}</div>
                  </div>

                  {result?.success ? (
                    result.url ? (
                      <a href={result.url} target="_blank" rel="noopener noreferrer" className="h-7 px-2 text-2xs bg-green-500/10 text-green-500 rounded flex items-center gap-1" aria-label={`Open created ${title}`}>
                        <Check className="w-3 h-3" aria-hidden="true" />Open
                        <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                      </a>
                    ) : (
                      <div className="h-7 px-2 text-2xs bg-green-500/10 text-green-500 rounded flex items-center gap-1" role="status" aria-label="Export successful">
                        <Check className="w-3 h-3" aria-hidden="true" />Sent
                      </div>
                    )
                  ) : (
                    <button
                      onClick={() => exportTo(type)}
                      disabled={isLoading || exporting !== null}
                      className="h-7 px-3 text-2xs bg-accent hover:bg-accent-hover disabled:opacity-50 rounded text-white flex items-center gap-1"
                      aria-label={`Export to ${title}`}
                    >
                      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : 'Export'}
                    </button>
                  )}
                </div>
              );
            })}

            {showWebhook && (
              <div className="mt-3 p-3 bg-bg rounded border border-border">
                <div className="text-2xs text-text-muted mb-2 flex items-center gap-1">
                  <Settings className="w-3 h-3" aria-hidden="true" />Google Chat Webhook URL
                </div>
                <input
                  value={webhookUrl}
                  onChange={handleWebhookChange}
                  placeholder="https://chat.googleapis.com/v1/spaces/..."
                  className="w-full h-7 px-2 text-xs bg-bg-card border border-border rounded placeholder-text-dim focus:outline-none focus:border-border-light mb-2"
                  aria-label="Enter Google Chat Webhook URL"
                />
                <button
                  onClick={() => exportTo('chat')}
                  disabled={!webhookUrl || exporting === 'chat'}
                  className="w-full h-7 text-2xs bg-accent hover:bg-accent-hover disabled:opacity-50 rounded text-white"
                  aria-label="Confirm send to Chat"
                >
                  Send to Chat
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
