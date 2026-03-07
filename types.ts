
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
  reasoning?: string;
  confidenceScore?: number;
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

export type ReplayEvalCheckCategory =
  | 'severity_match'
  | 'title_keywords'
  | 'tag_coverage'
  | 'timeline_coverage'
  | 'root_cause_coverage'
  | 'actionability'
  | 'reasoning_trace'
  | 'confidence_range';

export interface ReplayEvalCheck {
  id: string;
  category: ReplayEvalCheckCategory;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ReplayEvalCaseObserved {
  title: string;
  severity: IncidentSeverity;
  tags: string[];
  confidenceScore: number;
  timelineEvents: number;
  actionItems: number;
}

export interface ReplayEvalCaseResult {
  id: string;
  title: string;
  status: 'pass' | 'fail';
  passRate: number;
  observed: ReplayEvalCaseObserved;
  failedChecks: ReplayEvalCheck[];
}

export interface ReplayEvalSummary {
  totalCases: number;
  totalChecks: number;
  passedChecks: number;
  passRate: number;
  casesPassingAll: number;
  severityAccuracy: number;
}

export interface ReplayEvalBucket {
  category: ReplayEvalCheckCategory;
  failures: number;
  caseIds: string[];
  labels: string[];
}

export interface ReplayEvalOverview {
  ok: boolean;
  suiteId: string;
  generatedAt: string;
  summary: ReplayEvalSummary;
  buckets: ReplayEvalBucket[];
  cases: ReplayEvalCaseResult[];
}

export interface IncidentReplayExpectation {
  severity: IncidentSeverity;
  titleIncludes?: string[];
  tagsInclude?: string[];
  rootCauseIncludes?: string[];
  actionItemsInclude?: string[];
  reasoningSections?: string[];
  minTimelineEvents?: number;
  confidenceRange?: { min: number; max: number };
}

export interface IncidentReplayCase {
  id: string;
  title: string;
  description: string;
  logs: string;
  imageCount: number;
  expected: IncidentReplayExpectation;
}
