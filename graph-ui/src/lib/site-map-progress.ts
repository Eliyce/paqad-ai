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

export interface SiteMapProgressFile {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  created_at: string;
  updated_at: string;
  inventory: { screens: number; groups: string[] };
  units: Record<string, SiteMapProgressUnit>;
}

export interface SiteMapProgressStrip {
  current: string;
  done: number;
  writing: number;
  remaining: number;
  total: number;
  skipped: string | null;
}

export function summarizeSiteMapProgress(
  file: SiteMapProgressFile | null,
): SiteMapProgressStrip | null {
  if (file === null) return null;
  const units = Object.values(file.units);
  if (units.length === 0) return null;

  let done = 0;
  let writing = 0;
  let remaining = 0;
  let writingLabel: string | null = null;
  let nextLabel: string | null = null;
  for (const unit of units) {
    if (unit.state === 'done') {
      done += 1;
    } else if (unit.state === 'writing') {
      writing += 1;
      if (writingLabel === null) writingLabel = unit.label;
    } else if (unit.state === 'not_started') {
      remaining += 1;
      if (nextLabel === null) nextLabel = unit.label;
    }
  }

  let current: string;
  if (writingLabel !== null) {
    current = `Writing ${writingLabel}`;
  } else if (nextLabel !== null) {
    current = `Up next: ${nextLabel}`;
  } else {
    current = 'All units mapped';
  }

  const skipped =
    done > 0 ? `${done} unit${done === 1 ? '' : 's'} finished in a previous session` : null;

  return { current, done, writing, remaining, total: units.length, skipped };
}
