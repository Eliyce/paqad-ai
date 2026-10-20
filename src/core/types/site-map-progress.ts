export type SiteMapProgressState = 'not_started' | 'writing' | 'done' | 'failed';

export type SiteMapProgressUnitKind = 'group' | 'journey' | 'stage';

export interface SiteMapProgressUnit {
  id: string;
  kind: SiteMapProgressUnitKind;
  label: string;
  state: SiteMapProgressState;
  started_at: string | null;
  completed_at: string | null;
  artifact: string | null;
  source_files: string[];
  source_hash: string | null;
  error: string | null;
}

export interface SiteMapProgressSummary {
  total: number;
  done: number;
  writing: number;
  failed: number;
  remaining: number;
  next: { id: string; label: string } | null;
}

export interface SiteMapProgressFile {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  created_at: string;
  updated_at: string;
  inventory: { screens: number; groups: string[] };
  units: Record<string, SiteMapProgressUnit>;
}
