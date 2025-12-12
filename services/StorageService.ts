
import type { IncidentReport, SavedIncident, DashboardStats, IncidentSeverity } from '../types';

const STORAGE_KEY = 'aegisops_incidents';

/**
 * ==============================================================================
 * STORAGE SERVICE (Debugged & Enhanced)
 * ==============================================================================
 * 브라우저의 LocalStorage를 간이 데이터베이스로 사용합니다.
 * 
 * [Key Improvements]
 * 1. UUID Generation: `crypto.randomUUID()`를 사용하여 ID 충돌 가능성 제거.
 * 2. Fallback ID: 구형 브라우저를 위한 Math.random() 백업.
 * 3. Quota Handling: 용량 초과 시 자동 정리(Eviction) 로직.
 */

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `inc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
    // 최신 100개 유지 (LocalStorage 5MB 제한 고려)
    const updatedIncidents = [newIncident, ...incidents].slice(0, 100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedIncidents));
  } catch (e) {
    // [Defensive] 저장 공간 부족 시, 가장 오래된 항목을 더 삭제하고 재시도
    console.error("Failed to save incident to localStorage:", e);
    
    // 할당량 초과 에러인 경우 (브라우저마다 이름이 다를 수 있음)
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        try {
            // 복구 시도: 기존 데이터의 절반만 유지하고 재시도
            const incidents = getIncidents();
            // 최신 30개만 남기고 정리
            const reduced = [newIncident, ...incidents.slice(0, 30)]; 
            localStorage.setItem(STORAGE_KEY, JSON.stringify(reduced));
            console.log("Storage quota exceeded. Older incidents were evicted to make space.");
        } catch (retryError) {
            console.error("Critical: Could not save incident even after cleanup.", retryError);
            // 사용자에게 알리기 위해 에러를 throw 할 수도 있지만, 
            // 분석 결과(report) 자체는 이미 생성되었으므로 UI 흐름을 끊지 않기 위해 조용히 실패 처리
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
    // [Defensive] 데이터가 배열인지 확인
    if (!Array.isArray(parsed)) {
        console.warn("Storage corrupted: expected array, got", typeof parsed);
        // 복구 불가능하면 초기화하는 것이 나을 수 있음
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
    // tags가 undefined일 경우를 대비해 기본값 [] 사용
    const currentTags = report.tags || [];
    const tagsSet = new Set(currentTags.map((t) => t.toLowerCase()));
    
    return getIncidents()
      .map((inc) => {
        // 저장된 리포트 구조가 깨져있을 수 있으므로 Optional Chaining 사용
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
