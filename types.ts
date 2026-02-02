
export type IncidentSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'UNKNOWN';
export type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type AnalysisStatus = 'IDLE' | 'UPLOADING' | 'ANALYZING' | 'COMPLETE' | 'ERROR';

export interface TimelineEvent {
  time: string;
  description: string;
  severity?: 'critical' | 'warning' | 'info' | 'success';
}

export interface ActionItem {
  task: string;
  owner?: string;
  priority: ActionPriority;
}

export interface IncidentImpact {
  estimatedUsersAffected?: string;
  duration?: string;
  peakLatency?: string;
  peakErrorRate?: string;
}

export interface ReferenceSource {
  title: string;
  uri: string;
}

export interface IncidentReport {
  title: string;
  summary: string;
  severity: IncidentSeverity;
  rootCauses: string[];
  timeline: TimelineEvent[];
  actionItems: ActionItem[];
  mitigationSteps: string[];
  impact?: IncidentImpact;
  tags: string[];
  lessonsLearned?: string;
  preventionRecommendations?: string[];
  references?: ReferenceSource[];
  // [New] Explainable AI Fields
  reasoning?: string;       // AI's chain-of-thought explaining the diagnosis
  confidenceScore?: number; // 0-100 score indicating AI's certainty based on data quality
}

export interface SavedIncident {
  id: string;
  report: IncidentReport;
  createdAt: string;
  inputLogs: string;
  imageCount: number;
  analysisTimeMs?: number;
}

export interface DashboardStats {
  totalIncidents: number;
  severityDistribution: Record<IncidentSeverity, number>;
  mttr: number;
  topTags: { tag: string; count: number }[];
}

export type ExportFormat = 'json' | 'markdown' | 'slack' | 'jira';

export interface GoogleDocInfo {
  id: string;
  name: string;
  url: string;
}

export interface GoogleSlideInfo {
  id: string;
  name: string;
  url: string;
}

export interface GoogleEventInfo {
  id: string;
  url: string;
}

export interface GoogleSheetInfo {
  id: string;
  name: string;
  url: string;
}
