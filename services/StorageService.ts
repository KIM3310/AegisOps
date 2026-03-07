
import type { IncidentReport, SavedIncident, DashboardStats, IncidentSeverity } from '../types';

const STORAGE_KEY = 'aegisops_incidents';
const MAX_STORED_INCIDENTS = 100;
const QUOTA_RECOVERY_INCIDENTS = 30;

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `inc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function isQuotaExceeded(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

export function saveIncident(report: IncidentReport, inputLogs: string, imageCount: number, analysisTimeMs?: number): SavedIncident {
  const newIncident: SavedIncident = {
    id: generateUUID(),
    report,
    createdAt: new Date().toISOString(),
    inputLogs,
    imageCount,
    analysisTimeMs,
  };

  try {
    const incidents = getIncidents();
    const updatedIncidents = [newIncident, ...incidents].slice(0, MAX_STORED_INCIDENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedIncidents));
  } catch (e) {
    console.error("Failed to save incident to localStorage:", e);

    if (isQuotaExceeded(e)) {
      try {
        const incidents = getIncidents();
        const reduced = [newIncident, ...incidents.slice(0, QUOTA_RECOVERY_INCIDENTS)];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(reduced));
        console.warn("Storage quota exceeded. Older incidents were evicted to make space.");
      } catch (retryError) {
        console.error("Could not save incident after storage cleanup.", retryError);
      }
    }
  }
  
  return newIncident;
}

export function getIncidents(): SavedIncident[] {
  try {
    const item = localStorage.getItem(STORAGE_KEY);
    if (!item) return [];
    
    const parsed = JSON.parse(item);
    if (!Array.isArray(parsed)) {
      console.warn("Storage corrupted: expected array, got", typeof parsed);
      return [];
    }
    return parsed;
  } catch (e) {
    console.error("Failed to load incidents from localStorage:", e);
    return [];
  }
}

export function deleteIncident(id: string): void {
  try {
    const incidents = getIncidents();
    const filtered = incidents.filter((i) => i.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error("Failed to delete incident:", e);
  }
}

export function findSimilarIncidents(report: IncidentReport, limit = 3): SavedIncident[] {
  try {
    const currentTags = report.tags || [];
    const tagsSet = new Set(currentTags.map((t) => t.toLowerCase()));
    
    return getIncidents()
      .map((inc) => {
        const incTags = inc.report?.tags || [];
        const matchCount = incTags.filter((t) => tagsSet.has(t.toLowerCase())).length;
        const severityMatch = inc.report?.severity === report.severity ? 0.5 : 0;
        
        return {
          inc,
          score: matchCount + severityMatch,
        };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.inc);
  } catch (e) {
    console.warn("Error finding similar incidents:", e);
    return [];
  }
}

export function getDashboardStats(): DashboardStats {
  try {
    const incidents = getIncidents();
    const dist: Record<IncidentSeverity, number> = { SEV1: 0, SEV2: 0, SEV3: 0, UNKNOWN: 0 };
    const tagCounts: Record<string, number> = {};

    incidents.forEach((inc) => {
      const severity = inc.report?.severity;
      if (severity && dist[severity] !== undefined) {
        dist[severity]++;
      } else {
        dist['UNKNOWN']++;
      }

      (inc.report?.tags || []).forEach((t) => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });

    return {
      totalIncidents: incidents.length,
      severityDistribution: dist,
      mttr: 0,
      topTags: Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count })),
    };
  } catch (e) {
    console.error("Failed to calculate stats:", e);
    return {
        totalIncidents: 0,
        severityDistribution: { SEV1: 0, SEV2: 0, SEV3: 0, UNKNOWN: 0 },
        mttr: 0,
        topTags: []
    };
  }
}

export const StorageService = { saveIncident, getIncidents, deleteIncident, findSimilarIncidents, getDashboardStats };
export default StorageService;
