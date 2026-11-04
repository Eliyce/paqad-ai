import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { sleepSync } from '@/core/fs/atomic-rename.js';
import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { computeSessionRowHash } from '@/session-ledger/ledger.js';

import { bundleLockPath, LEDGER_LOCK_STALE_MS, LEDGER_LOCK_TIMEOUT_MS } from './ledger-append.js';
import {
  featureRecordIsUntitled,
  readFeatureRecord,
  updateFeatureRecord,
} from './feature-record.js';
import { UNTITLED_FEATURE_TITLE, mintFeatureDirName } from './mint.js';
import { featureDir, featureFilePath, parseFeatureDirName } from './paths.js';
import { readSessionControl, writeSessionControl } from './session-control.js';
import { currentFeature } from './stage-ledger.js';

export interface SlugBackfillResult {
  dirName: string;
  renamed: boolean;
}

export function backfillFeatureSlug(
  projectRoot: string,
  dirName: string,
  title: string,
  now?: () => Date,
  issue?: string | null,
): SlugBackfillResult {
  const unchanged: SlugBackfillResult = { dirName, renamed: false };
  const parts = parseFeatureDirName(dirName);
  if (
    !parts ||
    parts.slug !== UNTITLED_FEATURE_TITLE ||
    parts.issue !== null ||
    title.trim().length === 0
  ) {
    return unchanged;
  }
  const minted = mintFeatureDirName({ title, issue, ulid: parts.ulid });
  if (minted.slug === UNTITLED_FEATURE_TITLE || minted.dirName === dirName) {
    return unchanged;
  }
  const absOld = join(projectRoot, featureDir(dirName));
  const absNew = join(projectRoot, featureDir(minted.dirName));
  if (existsSync(absNew)) {
    return unchanged;
  }
  takeBundleLock(bundleLockPath(projectRoot, dirName));
  try {
    renameSync(absOld, absNew);
  } catch (error) {
    releaseLock(bundleLockPath(projectRoot, dirName));
    /* c8 ignore start -- a real fs error (EPERM/EBUSY): degrade to the generic name. */
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return unchanged;
    }
    /* c8 ignore stop */
  }
  repointSessionControls(projectRoot, dirName, minted.dirName, now);
  rewriteArtifactPaths(projectRoot, dirName, minted.dirName);
  releaseLock(bundleLockPath(projectRoot, minted.dirName));
  updateFeatureRecord(
    projectRoot,
    minted.dirName,
    { title, slug: minted.slug, issue: minted.issue },
    now,
  );
  return { dirName: minted.dirName, renamed: true };
}

export function titleActiveFeature(
  projectRoot: string,
  sessionId: string,
  title: string,
  issue?: string | null,
  now?: () => Date,
): string | null {
  const active = currentFeature(projectRoot, sessionId);
  if (!active) {
    return null;
  }
  const record = readFeatureRecord(projectRoot, active);
  if (record && !featureRecordIsUntitled(record)) {
    return null;
  }
  const result = backfillFeatureSlug(projectRoot, active, title, now, issue);
  return result.renamed ? result.dirName : null;
}

function takeBundleLock(lockDir: string): void {
  const deadline = Date.now() + LEDGER_LOCK_TIMEOUT_MS;
  while (!tryAcquireLock(lockDir, { staleLockMs: LEDGER_LOCK_STALE_MS }).acquired) {
    if (Date.now() >= deadline) return;
    sleepSync(20);
  }
}

function repointSessionControls(
  projectRoot: string,
  oldName: string,
  newName: string,
  now?: () => Date,
): void {
  let files: string[];
  try {
    files = readdirSync(join(projectRoot, PATHS.FEATURE_EVIDENCE_SESSION_DIR));
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const sessionId = file.slice(0, -'.json'.length);
    try {
      const control = readSessionControl(projectRoot, sessionId, now);
      if (control.active !== oldName && !control.paused.includes(oldName)) {
        continue;
      }
      writeSessionControl(
        projectRoot,
        {
          ...control,
          active: control.active === oldName ? newName : control.active,
          paused: control.paused.map((name) => (name === oldName ? newName : name)),
        },
        now,
        'rename',
      );
      /* c8 ignore start -- best-effort: an unwritable control is tolerated everywhere else too. */
    } catch {}
  }
}
/* c8 ignore stop */

function rewriteArtifactPaths(projectRoot: string, oldName: string, newName: string): void {
  const absLedger = join(projectRoot, featureFilePath(newName, 'stageEvidence'));
  let raw: string;
  try {
    raw = readFileSync(absLedger, 'utf8');
  } catch {
    return;
  }
  const oldPrefix = `${featureDir(oldName)}/`;
  const newPrefix = `${featureDir(newName)}/`;
  let changed = false;
  let previousOld: unknown = null;
  let previousNew: unknown = null;
  const lines = raw.split('\n').map((line) => {
    if (line.trim() === '') return line;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return line;
    }
    const oldHash = row.content_hash;
    let touched = false;
    if (Array.isArray(row.artifact_paths) && line.includes(oldPrefix)) {
      row.artifact_paths = row.artifact_paths.map((path) =>
        typeof path === 'string' && path.startsWith(oldPrefix)
          ? `${newPrefix}${path.slice(oldPrefix.length)}`
          : path,
      );
      touched = true;
    }
    if (typeof row.prev_hash === 'string' && row.prev_hash === previousOld) {
      if (previousNew !== previousOld) {
        row.prev_hash = previousNew;
        touched = true;
      }
    }
    if (touched) {
      row.content_hash = computeSessionRowHash(row);
      changed = true;
    }
    previousOld = oldHash;
    previousNew = row.content_hash;
    return touched ? JSON.stringify(row) : line;
  });
  if (changed) {
    try {
      const temp = `${absLedger}.rename-${process.pid}.tmp`;
      writeFileSync(temp, lines.join('\n'), 'utf8');
      renameSync(temp, absLedger);
      /* c8 ignore start -- best-effort: stale paths in old rows are cosmetic — digests are already stamped. */
    } catch {}
  }
}
/* c8 ignore stop */
