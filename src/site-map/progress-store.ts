import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renameWithRetry } from '@/core/fs/atomic-rename.js';
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

let tmpSeq = 0;

function progressPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_PROGRESS);
}

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

export function startUnit(unit: SiteMapProgressUnit, now: Date): void {
  unit.state = 'writing';
  unit.started_at = now.toISOString();
  unit.error = null;
}

export function completeUnit(unit: SiteMapProgressUnit, sourceHash: string, now: Date): void {
  unit.state = 'done';
  unit.completed_at = now.toISOString();
  unit.source_hash = sourceHash;
  unit.error = null;
}

export function failUnit(unit: SiteMapProgressUnit, error: string, now: Date): void {
  unit.state = 'failed';
  unit.completed_at = now.toISOString();
  unit.error = error;
}

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
  await renameWithRetry(tmp, target);
}

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

const KIND_LABEL: Record<SiteMapProgressUnitKind, string> = {
  group: 'Group',
  journey: 'Journey',
  stage: 'Stage',
};

export function describeCompletedUnits(progress: SiteMapProgressFile): string[] {
  const units = Object.values(progress.units);
  const totals: Record<SiteMapProgressUnitKind, number> = { group: 0, journey: 0, stage: 0 };
  for (const unit of units) totals[unit.kind] += 1;
  const seen: Record<SiteMapProgressUnitKind, number> = { group: 0, journey: 0, stage: 0 };
  const lines: string[] = [];
  for (const unit of units) {
    seen[unit.kind] += 1;
    if (unit.state !== 'done') continue;
    lines.push(
      `${KIND_LABEL[unit.kind]} ${seen[unit.kind]} of ${totals[unit.kind]}: ${unit.label}`,
    );
  }
  return lines;
}

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
