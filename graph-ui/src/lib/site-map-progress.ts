/**
 * Mirrors src/core/types/site-map-progress.ts. Kept structurally identical so the JSON the
 * GET /api/site-map/progress route serves deserialises directly. Update both sides together.
 * The Site map area reads this store statically (S6, D8) to show how far a run has got.
 */
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

/** The Site map progress strip's fields (S6, FR-6), projected from the progress file. */
export interface SiteMapProgressStrip {
  /** The unit the run is on now: what it is writing, what is up next, or that all are mapped. */
  current: string;
  done: number;
  writing: number;
  remaining: number;
  total: number;
  /** One line naming what a previous session finished, or null when nothing is done yet. */
  skipped: string | null;
}

/**
 * Project the progress file into the strip's fields (pure — no I/O). Returns null when there is
 * no progress file, or when the file records no units, so the caller renders nothing rather than
 * an empty or zeroed bar (S6, FR-5, FR-6). `remaining` is the not_started count; `failed` units
 * count only toward the total. The current unit is the one being written, else the first
 * not_started unit, else a done-with-all line. The skipped line names how many units a previous
 * session finished (the done count), and is null when none are done yet.
 */
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
