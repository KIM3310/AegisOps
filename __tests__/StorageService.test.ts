import { StorageService } from '../services/StorageService';
import type { IncidentReport, SavedIncident } from '../types';

// Mock types for Jest
declare var describe: any;
declare var it: any;
declare var expect: any;
declare var beforeEach: any;
declare var jest: any;

// LocalStorage Mock 구현
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe('StorageService', () => {
  const mockReport: IncidentReport = {
    title: "Redis Failure",
    summary: "OOM Killed",
    severity: "SEV1",
    rootCauses: ["Memory Leak"],
    timeline: [],
    actionItems: [],
    mitigationSteps: [],
    tags: ["redis", "oom", "database"]
  };

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  describe('saveIncident', () => {
    it('should save a new incident correctly', () => {
      const saved = StorageService.saveIncident(mockReport, "raw logs", 1, 1000);
      
      expect(saved.id).toBeDefined();
      expect(saved.report.title).toBe("Redis Failure");
      
      const stored = JSON.parse(localStorage.getItem('aegisops_incidents') || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(saved.id);
    });

    it('should limit stored incidents to 100', () => {
      // 105개 데이터 강제 주입
      const manyIncidents = Array.from({ length: 105 }, (_, i) => ({
        id: `id_${i}`,
        report: { ...mockReport, title: `Inc ${i}` }
      }));
      localStorage.setItem('aegisops_incidents', JSON.stringify(manyIncidents));

      // 하나 더 저장
      StorageService.saveIncident(mockReport, "log", 0);

      const stored = StorageService.getIncidents();
      expect(stored).toHaveLength(100); // 100개로 잘려야 함
      expect(stored[0].report.title).toBe("Redis Failure"); // 최신이 맨 앞에 옴
    });
  });

  describe('findSimilarIncidents', () => {
    it('should rank incidents based on tags and severity', () => {
      // 미리 데이터 저장
      const existingIncidents = [
        { 
          id: '1', 
          report: { ...mockReport, severity: 'SEV1', tags: ['redis', 'network'], title: 'High Similarity' } 
        }, // Same Sev(0.5) + 1 Tag(1) = 1.5
        { 
          id: '2', 
          report: { ...mockReport, severity: 'SEV3', tags: ['redis'], title: 'Medium Similarity' } 
        }, // Diff Sev(0) + 1 Tag(1) = 1.0
        { 
          id: '3', 
          report: { ...mockReport, severity: 'SEV2', tags: ['java'], title: 'No Similarity' } 
        }, // Score 0
      ] as SavedIncident[];

      localStorage.setItem('aegisops_incidents', JSON.stringify(existingIncidents));

      const targetReport = { ...mockReport, severity: 'SEV1', tags: ['redis', 'oom'] } as IncidentReport;
      
      const similar = StorageService.findSimilarIncidents(targetReport);

      expect(similar).toHaveLength(2); // Score > 0 인 것만
      expect(similar[0].report.title).toBe('High Similarity');
      expect(similar[1].report.title).toBe('Medium Similarity');
    });
  });

  describe('getDashboardStats', () => {
    it('should calculate statistics correctly', () => {
      const data = [
        { report: { severity: 'SEV1', tags: ['redis'] } },
        { report: { severity: 'SEV1', tags: ['redis', 'db'] } },
        { report: { severity: 'SEV2', tags: ['api'] } },
      ] as SavedIncident[];
      
      localStorage.setItem('aegisops_incidents', JSON.stringify(data));

      const stats = StorageService.getDashboardStats();

      expect(stats.totalIncidents).toBe(3);
      expect(stats.severityDistribution.SEV1).toBe(2);
      expect(stats.severityDistribution.SEV2).toBe(1);
      expect(stats.topTags).toEqual([
        { tag: 'redis', count: 2 },
        { tag: 'db', count: 1 },
        { tag: 'api', count: 1 }
      ]);
    });
  });
});