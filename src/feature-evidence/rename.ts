import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { acquireOwnedFileLock, type OwnedFileLock } from '@/core/fs/file-lock.js';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { computeSessionRowHash } from '@/session-ledger/ledger.js';

import { bundleLockPath, LEDGER_LOCK_STALE_MS } from './ledger-append.js';
import {
  featureRecordIsUntitled,
  readFeatureRecord,
  updateFeatureRecord,
} from './feature-record.js';
import { UNTITLED_FEATURE_TITLE, mintFeatureDirName } from './mint.js';
import { featureDir, featureFilePath, parseFeatureDirName } from './paths.js';
import { readSessionControl, writeSessionControl } from './session-control.js';
import { currentFeature } from './stage-ledger.js';

const RENAME_LOCK_TIMEOUT_MS = 3_000;
const REWRITE_ATTEMPTS = 5;

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
  const lock = takeBundleLock(bundleLockPath(projectRoot, dirName));
  if (lock === null) return unchanged;
  try {
    renameSync(absOld, absNew);
  } catch (error) {
    lock.release();
    /* c8 ignore start -- a real fs error (EPERM/EBUSY): degrade to the generic name. */
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return unchanged;
    }
    /* c8 ignore stop */
  }
  repointSessionControls(projectRoot, dirName, minted.dirName, now);
  rewriteArtifactPaths(projectRoot, dirName, minted.dirName);
  lock.movedTo(bundleLockPath(projectRoot, minted.dirName)).release();
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

function takeBundleLock(lockDir: string): OwnedFileLock | null {
  try {
    return acquireOwnedFileLock(lockDir, {
      timeoutMs: RENAME_LOCK_TIMEOUT_MS,
      staleMs: LEDGER_LOCK_STALE_MS,
    });
  } catch {
    return null;
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
  const temp = `${absLedger}.rename-${process.pid}.tmp`;
  try {
    for (let attempt = 0; attempt < REWRITE_ATTEMPTS; attempt += 1) {
      const raw = readFileSync(absLedger, 'utf8');
      const rewritten = relinkedLedger(raw, oldName, newName);
      if (rewritten === null) return;
      writeFileSync(temp, rewritten, 'utf8');
      if (statSync(absLedger).size === Buffer.byteLength(raw)) {
        renameSync(temp, absLedger);
        return;
      }
    }
    rmSync(temp, { force: true });
    /* c8 ignore start -- best-effort: stale paths in old rows are cosmetic — digests are already stamped. */
  } catch {}
}
/* c8 ignore stop */

function relinkedLedger(raw: string, oldName: string, newName: string): string | null {
  const oldPrefix = `${featureDir(oldName)}/`;
  const newPrefix = `${featureDir(newName)}/`;
  let changed = false;
  const rehashed = new Map<unknown, unknown>();
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
    if (rehashed.has(row.prev_hash)) {
      row.prev_hash = rehashed.get(row.prev_hash);
      touched = true;
    }
    if (touched) {
      row.content_hash = computeSessionRowHash(row);
      changed = true;
    }
    if (row.content_hash !== oldHash) rehashed.set(oldHash, row.content_hash);
    return touched ? JSON.stringify(row) : line;
  });
  return changed ? lines.join('\n') : null;
}
