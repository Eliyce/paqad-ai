export const DASHBOARD_SECTION_IDS = [
  'project-profile',
  'framework-version',
  'rag-status',
  'decisions',
  'module-health',
  'module-map-drift',
  'module-decisions',
  'module-events',
  'stack-drift',
  'rules',
  'workflows',
  'delivery',
  'module-docs',
  'design-system',
  'stack',
  'registries',
  'tools',
  'tech-debt',
  'architecture',
  'pentest',
  'codebase-health',
  'site-map',
  'rule-compliance',
  'change-metrics',
  'attestation',
  'session',
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export type ScoreBand = 'green' | 'amber' | 'red' | 'unknown';

export interface SectionMetric {
  label: string;
  value: string;
}

export interface SectionData {
  id: DashboardSectionId;
  title: string;
  band: ScoreBand;
  score: number | null;
  summary: string;
  metrics: SectionMetric[];
  helper?: {
    what: string;
    goodLooksLike: string;
  };
  details?: Record<string, unknown>;
}

export interface AttentionItem {
  sectionId: DashboardSectionId;
  message: string;
  severity: 'info' | 'warn' | 'critical';
}

export interface DashboardReport {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  projectName: string | null;
  frameworkVersion: string | null;
  notOnboarded: boolean;
  overallScore: number | null;
  overallBand: ScoreBand;
  attention: AttentionItem[];
  sections: SectionData[];
}
