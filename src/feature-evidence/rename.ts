import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { computeSessionRowHash } from '@/session-ledger/ledger.js';

import { updateFeatureRecord } from './feature-record.js';
import { UNTITLED_FEATURE_TITLE, mintFeatureDirName } from './mint.js';
import { featureDir, featureFilePath, parseFeatureDirName } from './paths.js';
import { readSessionControl, writeSessionControl } from './session-control.js';

export interface SlugBackfillResult {
  dirName: string;
  renamed: boolean;
}

export function backfillFeatureSlug(
  projectRoot: string,
  dirName: string,
  title: string,
  now?: () => Date,
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
  const minted = mintFeatureDirName({ title, ulid: parts.ulid });
  if (minted.slug === UNTITLED_FEATURE_TITLE || minted.dirName === dirName) {
    return unchanged;
  }
  const absOld = join(projectRoot, featureDir(dirName));
  const absNew = join(projectRoot, featureDir(minted.dirName));
  if (existsSync(absNew)) {
    return unchanged;
  }
  try {
    renameSync(absOld, absNew);
  } catch (error) {
    /* c8 ignore start -- a real fs error (EPERM/EBUSY): degrade to the generic name. */
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return unchanged;
    }
    /* c8 ignore stop */
  }
  repointSessionControls(projectRoot, dirName, minted.dirName, now);
  rewriteArtifactPaths(projectRoot, dirName, minted.dirName);
  updateFeatureRecord(
    projectRoot,
    minted.dirName,
    { title, slug: minted.slug, issue: minted.issue },
    now,
  );
  return { dirName: minted.dirName, renamed: true };
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
  const lines = raw.split('\n').map((line) => {
    if (!line.includes(oldPrefix)) {
      return line;
    }
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (!Array.isArray(row.artifact_paths)) {
        return line;
      }
      row.artifact_paths = row.artifact_paths.map((path) =>
        typeof path === 'string' && path.startsWith(oldPrefix)
          ? `${newPrefix}${path.slice(oldPrefix.length)}`
          : path,
      );
      row.content_hash = computeSessionRowHash(row);
      changed = true;
      return JSON.stringify(row);
    } catch {
      return line;
    }
  });
  if (changed) {
    try {
      writeFileSync(absLedger, lines.join('\n'), 'utf8');
      /* c8 ignore start -- best-effort: stale paths in old rows are cosmetic — digests are already stamped. */
    } catch {}
  }
}
/* c8 ignore stop */
