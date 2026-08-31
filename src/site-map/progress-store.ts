// The resumable site-map authoring-progress store (S5a, D7). The same prompt in a new session
// resumes instead of restarting, and a run that died mid-write can never leave a half-written
// file looking finished. It mirrors the doc-generation progress tracker
// (`src/document/progress-tracker.ts`) and the site-map store's read/write discipline
// (`src/site-map/store.ts`):
//   - reads are tolerant: a missing, corrupt, or schema-invalid file reads as "no progress"
//     (null), never a crash and never a half-built file masquerading as real (INV-1);
//   - writes are atomic: the JSON is written through `writeJsonFile` to a UNIQUE temp path and
//     renamed onto the target, so a concurrent or interrupted write never leaves a partial file;
//   - crash recovery on load resets every `writing` unit and deletes its half-written artifact,
//     so a truncated file can never read as complete (INV-2).
// This module is the ONLY writer of `.paqad/site-map/progress.json` (INV-3).

import { readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type {
  SiteMapProgressFile,
  SiteMapProgressSummary,
  SiteMapProgressUnit,
  SiteMapProgressUnitKind,
} from '@/core/types/site-map-progress.js';
import { hashSourceFiles } from '@/document/staleness.js';
import { VERSION } from '@/index.js';
import { SchemaValidator } from '@/validators/validator.js';

import { writeJsonFile } from './shared.js';

const VALIDATOR = new SchemaValidator();

/** Monotonic per-process counter so concurrent writes never share a temp path (see saveProgress). */
let tmpSeq = 0;

/** Absolute path to the single progress store for a project. */
function progressPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_PROGRESS);
}

/** An empty store seeded from the S4 inventory. `framework_version` is the running VERSION. */
export function createEmptyProgress(
  inventory: { screens: number; groups: string[] },
  now: Date,
): SiteMapProgressFile {
  const iso = now.toISOString();
  return {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: VERSION,
    created_at: iso,
    updated_at: iso,
    inventory: { screens: inventory.screens, groups: [...inventory.groups] },
    units: {},
  };
}

/** A fresh `not_started` unit. `artifact` is the file it will write (null when it writes none). */
export function createUnit(input: {
  id: string;
  kind: SiteMapProgressUnitKind;
  label: string;
  artifact: string | null;
  source_files: string[];
}): SiteMapProgressUnit {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    state: 'not_started',
    started_at: null,
    completed_at: null,
    artifact: input.artifact,
    source_files: [...input.source_files],
    source_hash: null,
    error: null,
  };
}

/** Mark a unit as being written now. */
export function startUnit(unit: SiteMapProgressUnit, now: Date): void {
  unit.state = 'writing';
  unit.started_at = now.toISOString();
  unit.error = null;
}

/** Mark a unit done, stamping the source hash that the skip rule later compares against. */
export function completeUnit(unit: SiteMapProgressUnit, sourceHash: string, now: Date): void {
  unit.state = 'done';
  unit.completed_at = now.toISOString();
  unit.source_hash = sourceHash;
  unit.error = null;
}

/** Mark a unit failed with a reason. */
export function failUnit(unit: SiteMapProgressUnit, error: string, now: Date): void {
  unit.state = 'failed';
  unit.completed_at = now.toISOString();
  unit.error = error;
}

/**
 * Read the store tolerantly (INV-1): a missing, unparseable, or schema-invalid file reads as
 * `null` (no progress) and never throws. Performs no write — safe to call from `status` (S5b)
 * while a run is in flight.
 */
export async function readProgress(projectRoot: string): Promise<SiteMapProgressFile | null> {
  let raw: string;
  try {
    raw = await readFile(progressPath(projectRoot), 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!VALIDATOR.validate('site-map-progress', parsed).valid) {
    return null;
  }
  return parsed as SiteMapProgressFile;
}

/**
 * Persist the store atomically (FR-4): serialise through `writeJsonFile` to a UNIQUE temp path
 * (pid + a monotonic counter) and rename it onto the target, so two concurrent writes never
 * interleave and an interrupted write never leaves a partial file. Stamps `updated_at`.
 */
export async function saveProgress(
  projectRoot: string,
  progress: SiteMapProgressFile,
  updatedAt: Date,
): Promise<void> {
  progress.updated_at = updatedAt.toISOString();
  const target = progressPath(projectRoot);
  tmpSeq += 1;
  const tmp = `${target}.${process.pid}.${tmpSeq}.tmp`;
  await writeJsonFile(tmp, progress);
  await rename(tmp, target);
}

/**
 * Crash recovery on load (FR-5, INV-2): every unit left `writing` by a run that died is reset to
 * `not_started` (its `started_at` and `error` cleared) AND the file named by its `artifact` is
 * deleted, so a truncated artifact can never be treated as complete. Mutates `progress` in place
 * and returns the ids that were reset.
 */
export async function recoverInFlight(
  projectRoot: string,
  progress: SiteMapProgressFile,
): Promise<string[]> {
  const reset: string[] = [];
  for (const unit of Object.values(progress.units)) {
    if (unit.state !== 'writing') {
      continue;
    }
    if (unit.artifact !== null) {
      await rm(join(projectRoot, unit.artifact), { force: true });
    }
    unit.state = 'not_started';
    unit.started_at = null;
    unit.error = null;
    reset.push(unit.id);
  }
  return reset;
}

/**
 * Summarise the store for the read-only `sitemap status` verb (S5b): count the units by state
 * and pick the next one to work on. Pure — no filesystem, network, or clock (INV-3), so `status`
 * can call it after a plain `readProgress` without ever writing. `remaining` is the `not_started`
 * count, so total = done + writing + failed + remaining (FR-5). `next` is the first `not_started`
 * unit in the store's declaration order, or null when none remain (FR-6). A `writing` unit is
 * counted as writing and is never treated as `next` — a run resets `writing` to `not_started` on
 * load before such a unit is next, and `status` must not assume the reset it may not perform.
 */
export function summarizeProgress(progress: SiteMapProgressFile): SiteMapProgressSummary {
  const units = Object.values(progress.units);
  let done = 0;
  let writing = 0;
  let failed = 0;
  let remaining = 0;
  let next: { id: string; label: string } | null = null;
  for (const unit of units) {
    switch (unit.state) {
      case 'done':
        done += 1;
        break;
      case 'writing':
        writing += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      case 'not_started':
        remaining += 1;
        if (next === null) {
          next = { id: unit.id, label: unit.label };
        }
        break;
    }
  }
  return { total: units.length, done, writing, failed, remaining, next };
}

/**
 * The skip rule (FR-6): a `done` unit whose `source_hash` still equals the current hash of its
 * `source_files` is skipped on the next run; a `done` unit whose hash changed is reset to
 * `not_started`, because the code it describes moved. Mutates `progress` in place and returns the
 * skipped and reset ids.
 */
export async function reconcileDoneUnits(
  projectRoot: string,
  progress: SiteMapProgressFile,
): Promise<{ skipped: string[]; reset: string[] }> {
  const skipped: string[] = [];
  const reset: string[] = [];
  for (const unit of Object.values(progress.units)) {
    if (unit.state !== 'done') {
      continue;
    }
    const current = await hashSourceFiles(projectRoot, unit.source_files);
    if (current === unit.source_hash) {
      skipped.push(unit.id);
    } else {
      unit.state = 'not_started';
      unit.started_at = null;
      unit.completed_at = null;
      unit.source_hash = null;
      unit.error = null;
      reset.push(unit.id);
    }
  }
  return { skipped, reset };
}
