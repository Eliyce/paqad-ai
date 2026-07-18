// Feature-bundle rigid-only invariant (issue #402).
//
// A feature bundle directory is meant to hold ONLY rigid, script-owned artifacts:
// the `FEATURE_BUNDLE_FILES` set plus the derived `report.html`. Nothing enforced that.
// Only the `planning` / `specification` stage-end markers were validated (issue #394),
// and arbitrary file WRITES into the bundle dir were unconstrained, so a spec markdown
// and a review-notes file accumulated alongside the rigid JSON (the incident).
//
// This module is the invariant made checkable, in two directions:
//   - `classifyBundlePath` judges a project-relative path: is it inside a bundle dir,
//     and if so is it a rigid file? The stage-end boundary uses it to REJECT a non-rigid
//     artifact written into a bundle, for every stage rather than only the rigid ones.
//   - `strayBundleFiles` reads a bundle dir and reports what does not belong, so the
//     exporter and the report can FLAG a polluted bundle.
//
// Nothing here deletes. Reporting a stray is honest; silently removing a developer's
// file would not be.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { FEATURE_BUNDLE_FILES, featureDir, isFeatureDirName } from './paths.js';

/**
 * Every filename allowed to sit in a feature bundle dir: the rigid, script-owned set
 * plus `report.html`, the derived human-readable projection (issue #371) that is
 * deliberately not a `FEATURE_BUNDLE_FILES` member.
 */
export const ALLOWED_BUNDLE_FILENAMES: ReadonlySet<string> = new Set<string>([
  ...Object.values(FEATURE_BUNDLE_FILES),
  'report.html',
]);

/**
 * True for an in-flight atomic-write temp file (`<name>.tmp`, `<name>.tmp-<pid>`). The
 * bundle writers all write temp-then-rename, so one of these can legitimately exist for
 * an instant and must never be reported as a stray.
 */
function isAtomicWriteTemp(filename: string): boolean {
  return /\.tmp(-\d+)?$/.test(filename);
}

/** Where a project-relative path sits with respect to the feature bundles. */
export interface BundlePathClassification {
  /** The feature dir name the path lives under. */
  dirName: string;
  /** The path's filename relative to the bundle dir. */
  filename: string;
  /** Whether the file is one the bundle is allowed to contain. */
  allowed: boolean;
}

/**
 * Classify a project-relative posix path against the feature-bundle layout. Returns
 * `null` when the path is not inside a feature bundle directory at all — the common
 * case, and the one that must pass through untouched. A path directly under the
 * container, or under the `_session` control dir, is not in a bundle either.
 *
 * A nested path (`<bundle>/sub/file`) is classified as NOT allowed: the bundle is a
 * flat set of rigid files, so a subdirectory is pollution just as a stray file is.
 */
export function classifyBundlePath(relPath: string): BundlePathClassification | null {
  const prefix = `${PATHS.FEATURE_EVIDENCE_DIR}/`;
  if (!relPath.startsWith(prefix)) {
    return null;
  }
  const rest = relPath.slice(prefix.length);
  const slash = rest.indexOf('/');
  // A file directly under the container (no `<dir>/<file>` split) is not in a bundle.
  if (slash === -1) {
    return null;
  }
  const dirName = rest.slice(0, slash);
  const filename = rest.slice(slash + 1);
  // `_session/` holds the per-session controls, not a feature bundle.
  if (!isFeatureDirName(dirName)) {
    return null;
  }
  return {
    dirName,
    filename,
    allowed: ALLOWED_BUNDLE_FILENAMES.has(filename) || isAtomicWriteTemp(filename),
  };
}

/**
 * Every file in one feature's bundle directory that does not belong there — anything
 * that is neither a rigid bundle file, `report.html`, nor an in-flight atomic-write
 * temp file. Subdirectories are reported too (the bundle is a flat rigid set). Returns
 * `[]` for a missing or unreadable directory: absence is not pollution.
 *
 * Names are returned sorted so a caller's output is deterministic.
 */
export function strayBundleFiles(projectRoot: string, dirName: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(projectRoot, featureDir(dirName)));
  } catch {
    return [];
  }
  return entries
    .filter((name) => !ALLOWED_BUNDLE_FILENAMES.has(name) && !isAtomicWriteTemp(name))
    .sort();
}
