
import React, { useState, useEffect } from 'react';
import { Table2, Plus, ExternalLink, Loader2, Check, X, LogIn, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import { SheetsService } from '../services/SheetsService';
import { StorageService } from '../services/StorageService';
import type { SavedIncident, GoogleSheetInfo } from '../types';

interface Props {
  incidents: SavedIncident[];
  onClose: () => void;
}

export const DatasetExport: React.FC<Props> = ({ incidents, onClose }) => {
  const { isAuthenticated, accessToken, signIn, isLoading: authLoading, isDemoMode } = useGoogleAuth();
  const [existing, setExisting] = useState<GoogleSheetInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    // Reset success state on mount
    setSuccess(null);
    
    if (isAuthenticated && accessToken && !isDemoMode) {
      setLoading(true);
      SheetsService.findExistingDatasets(accessToken).then(setExisting).finally(() => setLoading(false));
    } else if (isDemoMode) {
      setExisting([
        { id: 'demo1', name: 'AegisOps Dataset 2025-01', url: 'https://docs.google.com/spreadsheets/d/demo1' },
      ]);
    }
  }, [isAuthenticated, accessToken, isDemoMode]);

  const createNew = async () => {
    if (!accessToken) return;
    setExporting(true);

    if (isDemoMode) {
      await new Promise((r) => setTimeout(r, 1500));
      setSuccess('https://docs.google.com/spreadsheets/d/demo-new');
    } else {
      try {
        const stats = StorageService.getDashboardStats();
        const sheet = await SheetsService.createIncidentDataset(accessToken, `AegisOps ${new Date().toISOString().split('T')[0]}`);
        await SheetsService.exportIncidentsToSheet(accessToken, sheet.id, incidents, stats);
        setSuccess(sheet.url);
      } catch (e) {
        console.error(e);
      }
    }

    setExporting(false);
  };

  const syncToExisting = async (sheetId: string, url: string) => {
    if (!accessToken) return;
    setExporting(true);

    if (isDemoMode) {
        await new Promise((r) => setTimeout(r, 1000));
        setSuccess(url);
    } else {
        try {
            const stats = StorageService.getDashboardStats();
            await SheetsService.exportIncidentsToSheet(accessToken, sheetId, incidents, stats);
            setSuccess(url);
        } catch (e) {
            console.error(e);
        }
    }
    setExporting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="dataset-title">
      <div className="w-full max-w-sm bg-bg-card border border-border rounded overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span id="dataset-title" className="text-xs font-medium flex items-center gap-1.5"><Table2 className="w-3.5 h-3.5 text-accent" aria-hidden="true" />Export Dataset to Sheets</span>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded" aria-label="Close dialog"><X className="w-3.5 h-3.5 text-text-muted" aria-hidden="true" /></button>
        </div>

        <div className="p-4">
          {success ? (
            <div className="text-center py-4">
              <Check className="w-10 h-10 text-green-500 mx-auto mb-3" aria-hidden="true" />
              <p className="text-xs text-text-muted mb-4" role="status">{incidents.length} incidents exported successfully.</p>
              <a href={success} target="_blank" rel="noopener noreferrer" className="h-8 px-4 text-xs bg-accent hover:bg-accent-hover rounded text-white inline-flex items-center gap-1.5">
                <ExternalLink className="w-3 h-3" aria-hidden="true" />Open Spreadsheet
              </a>
            </div>
          ) : !isAuthenticated ? (
            <div className="text-center py-4">
              <LogIn className="w-10 h-10 text-accent mx-auto mb-4 opacity-50" aria-hidden="true" />
              <p className="text-xs text-text-muted mb-4">Connect Google to export your dataset</p>
              <button onClick={signIn} disabled={authLoading} className="h-8 px-4 text-xs bg-accent hover:bg-accent-hover rounded text-white">
                {authLoading ? 'Connecting...' : 'Connect Google'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-bg rounded border border-border text-center">
                <div className="text-2xl font-semibold">{incidents.length}</div>
                <div className="text-2xs text-text-dim">incidents to export</div>
              </div>

              <button onClick={createNew} disabled={exporting || !incidents.length} className="w-full h-9 text-xs bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded text-accent flex items-center justify-center gap-1.5 disabled:opacity-50">
                {exporting ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Plus className="w-3 h-3" aria-hidden="true" />}
                Create New Dataset
              </button>

              {existing.length > 0 && (
                <div>
                  <div className="text-2xs text-text-dim mb-2">Sync to Existing Dataset</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto" role="list">
                    {existing.map((d) => (
                      <div key={d.id} className="flex items-center gap-2 p-2 bg-bg hover:bg-bg-hover border border-border rounded text-xs group" role="listitem">
                        <FileSpreadsheet className="w-4 h-4 text-accent" aria-hidden="true" />
                        <span className="truncate flex-1">{d.name}</span>
                        
                        <div className="flex items-center gap-1">
                            <button 
                                onClick={() => syncToExisting(d.id, d.url)} 
                                disabled={exporting}
                                className="p-1.5 hover:bg-bg-card rounded text-text-muted hover:text-text transition-colors"
                                title="Sync now"
                            >
                                {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            </button>
                            <a href={d.url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-bg-card rounded text-text-muted hover:text-text transition-colors">
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
