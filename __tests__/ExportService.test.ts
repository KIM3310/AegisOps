import { ExportService } from '../services/ExportService';
import type { IncidentReport } from '../types';

// Mock types for Jest
declare var describe: any;
declare var it: any;
declare var expect: any;

describe('ExportService', () => {
  const mockReport: IncidentReport = {
    title: "Test Incident",
    summary: "Something went wrong",
    severity: "SEV1",
    rootCauses: ["Root Cause A"],
    timeline: [{ time: "10:00", description: "Start", severity: "critical" }],
    actionItems: [{ task: "Fix it", priority: "HIGH", owner: "DevOps" }],
    mitigationSteps: ["Restarted"],
    tags: ["test"],
    impact: { estimatedUsersAffected: "100" }
  };

  describe('exportReport', () => {
    it('should export correct Markdown format', () => {
      const result = ExportService.exportReport(mockReport, 'markdown');
      
      expect(result.mimeType).toBe('text/markdown');
      expect(result.filename).toContain('.md');
      
      const content = result.content;
      expect(content).toContain('# Test Incident');
      expect(content).toContain('**Severity:** SEV1');
      expect(content).toContain('## Root Causes');
      expect(content).toContain('1. Root Cause A');
      expect(content).toContain('- [HIGH] Fix it → DevOps');
    });

    it('should export correct JSON format', () => {
      const result = ExportService.exportReport(mockReport, 'json');
      
      expect(result.mimeType).toBe('application/json');
      const parsed = JSON.parse(result.content);
      expect(parsed).toEqual(mockReport);
    });

    it('should export correct Slack Block Kit format', () => {
      const result = ExportService.exportReport(mockReport, 'slack');
      
      expect(result.mimeType).toBe('application/json');
      const parsed = JSON.parse(result.content);
      
      // Slack Block 구조 확인
      expect(parsed).toHaveProperty('blocks');
      expect(parsed.blocks[0].text.text).toContain('🔴 [SEV1] Test Incident');
      expect(parsed.blocks[1].text.text).toContain('*Summary:*');
    });

    it('should export correct Jira text format', () => {
      const result = ExportService.exportReport(mockReport, 'jira');
      
      expect(result.mimeType).toBe('text/plain');
      expect(result.content).toContain('h1. Test Incident');
      expect(result.content).toContain('||Severity|SEV1||');
      expect(result.content).toContain('|HIGH|Fix it|DevOps|');
    });
  });
});