// Generic-slug back-fill (issue #403).
//
// A feature opened by a bare `paqad:stage planning start` is minted as the untitled
// `change-<ULID>` — the marker carries no title, and the dir name was never revisited
// once the descriptive title arrived at `plan compile` time. This module renames such
// a bundle to `[<issue>-]<slugified-title>-<ULID>` when the compiled plan template
// carries a title: same ULID (the stable change key), issue detected from the title
// with the existing mint primitives. Every `_session/*.json` control that references
// the old name is repointed, and any `artifact_paths` in the moved
// `stage-evidence.jsonl` that carry the old dir prefix are rewritten with the row
// `content_hash` re-stamped by the script — so nothing orphans. Fail-safe throughout:
// any failure leaves the feature on its generic name (the prior behavior) and never
// a half-renamed bundle.

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { computeSessionRowHash } from '@/session-ledger/ledger.js';

import { UNTITLED_FEATURE_TITLE, mintFeatureDirName } from './mint.js';
import { featureDir, featureFilePath, parseFeatureDirName } from './paths.js';
import { readSessionControl, writeSessionControl } from './session-control.js';

export interface SlugBackfillResult {
  /** The feature's dir name after the back-fill (unchanged when not renamed). */
  dirName: string;
  renamed: boolean;
}

/**
 * Rename a generically-named `change-<ULID>` bundle to the descriptive
 * `[<issue>-]<slug>-<ULID>` derived from `title`, keeping the ULID as the stable
 * change key. A no-op (returning the input name) when the dir is already
 * descriptive, the title is empty or itself derives the generic slug, the target
 * dir already exists, or the rename fails — the generic name is the degraded but
 * correct prior behavior, so the caller's compile always proceeds.
 */
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
    return unchanged; // never clobber an existing bundle — keep the generic name.
  }
  try {
    renameSync(absOld, absNew);
  } catch (error) {
    // A dir with no rows yet only lives in the session control — repoint it below.
    /* c8 ignore next 3 -- a real fs error (EPERM/EBUSY): degrade to the generic name. */
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return unchanged;
    }
  }
  // Only after the dir rename has succeeded (INV-3): repoint every session control
  // and rewrite the moved rows, each best-effort so a failure cannot orphan the
  // already-renamed bundle.
  repointSessionControls(projectRoot, dirName, minted.dirName, now);
  rewriteArtifactPaths(projectRoot, dirName, minted.dirName);
  return { dirName: minted.dirName, renamed: true };
}

/**
 * Repoint every `_session/*.json` control referencing `oldName` — active pointer or
 * paused entry, in ANY session — onto `newName`, so a session fork (issue #404) can
 * never keep an orphaned pointer to the pre-rename dir.
 */
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
    return; // no controls to repoint.
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
      );
      /* c8 ignore next 3 -- best-effort: an unwritable control is tolerated everywhere else too. */
    } catch {
      // Nothing to do — the remaining controls still get repointed.
    }
  }
}

/**
 * Rewrite `artifact_paths` entries in the renamed bundle's `stage-evidence.jsonl`
 * that still carry the old dir prefix, re-stamping each rewritten row's
 * `content_hash` (the script owns the ledger bytes, so the hash chain stays
 * consistent). Unparseable lines are preserved verbatim — this never drops a row.
 */
function rewriteArtifactPaths(projectRoot: string, oldName: string, newName: string): void {
  const absLedger = join(projectRoot, featureFilePath(newName, 'stageEvidence'));
  let raw: string;
  try {
    raw = readFileSync(absLedger, 'utf8');
  } catch {
    return; // no rows yet — nothing to rewrite.
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
      return line; // preserve an unparseable line untouched.
    }
  });
  if (changed) {
    try {
      writeFileSync(absLedger, lines.join('\n'), 'utf8');
      /* c8 ignore next 3 -- best-effort: stale paths in old rows are cosmetic — digests are already stamped. */
    } catch {
      // Nothing to do — the rename itself already succeeded.
    }
  }
}
