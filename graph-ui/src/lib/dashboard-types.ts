/**
 * Mirrors the contract in src/dashboard/types.ts. Kept structurally
 * identical so JSON deserialisation just works. Update both sides when
 * adding fields.
 */
export type ScoreBand = 'green' | 'amber' | 'red' | 'unknown';

export interface SectionMetric {
  label: string;
  value: string;
}

export interface SectionData {
  id: string;
  title: string;
  band: ScoreBand;
  score: number | null;
  summary: string;
  metrics: SectionMetric[];
  helper?: { what: string; goodLooksLike: string };
  details?: Record<string, unknown>;
}

export interface AttentionItem {
  sectionId: string;
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
