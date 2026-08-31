// The persisted site-map authoring-progress store (S5, D7): a per-unit ledger so the same
// prompt in a new session resumes instead of restarting, and a run that died mid-write can
// never leave a half-written file looking finished. It mirrors the doc-generation progress
// tracker's discipline (`src/document/progress-tracker.ts`) but carries the site-map unit
// kinds and the artifact/crash-recovery fields that resumable authoring needs. The store lives
// at the `SITE_MAP_PROGRESS` path and is written only by `src/site-map/progress-store.ts`.

/** A unit's authoring state. `writing` is the crash-recovery signal — never treated as done. */
export type SiteMapProgressState = 'not_started' | 'writing' | 'done' | 'failed';

/** What a unit of work represents: a module group, a curated journey, or a run stage. */
export type SiteMapProgressUnitKind = 'group' | 'journey' | 'stage';

/** One resumable piece of the mapping job. */
export interface SiteMapProgressUnit {
  /** Stable id, e.g. `group:billing` | `journey:checkout-guest` | `stage:links`. */
  id: string;
  kind: SiteMapProgressUnitKind;
  label: string;
  state: SiteMapProgressState;
  /** ISO, or null before the unit starts / after a crash-recovery reset. */
  started_at: string | null;
  /** ISO, or null until the unit finishes. */
  completed_at: string | null;
  /** Posix, repo-relative: the file this unit writes. Null when the unit writes no file. */
  artifact: string | null;
  /** Posix, repo-relative: the source files whose content decides whether this unit is stale. */
  source_files: string[];
  /** Content hash of `source_files` recorded when the unit was completed; null otherwise. */
  source_hash: string | null;
  error: string | null;
}

/** The persisted progress file. `progress-store.ts` is its only writer. */
export interface SiteMapProgressFile {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  /** ISO — when the store was first created. */
  created_at: string;
  /** ISO — bumped on every write. */
  updated_at: string;
  /** The S4 inventory this run seeded from (a narrower projection than `SiteMapInventory`). */
  inventory: { screens: number; groups: string[] };
  units: Record<string, SiteMapProgressUnit>;
}
