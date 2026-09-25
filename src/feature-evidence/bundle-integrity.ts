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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import {
  FEATURE_BUNDLE_FILES,
  LEGACY_BUNDLE_FILES,
  SCREENSHOTS_DIR,
  featureDir,
  isFeatureDirName,
} from './paths.js';

/**
 * Every filename allowed to sit in a feature bundle dir: the rigid, script-owned set
 * plus the derived `report.html` (issue #371), deliberately not a `FEATURE_BUNDLE_FILES`
 * member. Exactly the issue #581 target set: no `specification.md`, no
 * `context-efficiency.jsonl` (see {@link LEGACY_BUNDLE_FILENAMES}).
 */
export const ALLOWED_BUNDLE_FILENAMES: ReadonlySet<string> = new Set<string>([
  ...Object.values(FEATURE_BUNDLE_FILES),
  'report.html',
]);

/**
 * Files a pre-#581 bundle may still hold. {@link strayBundleFiles} tolerates them in a legacy
 * bundle only, because the migration adds files and never deletes an old one (issue #581,
 * AC-20); in a bundle written since #581 they are strays.
 */
export const LEGACY_BUNDLE_FILENAMES: ReadonlySet<string> = new Set<string>(
  Object.values(LEGACY_BUNDLE_FILES),
);

/**
 * The ONLY entries allowed under the `screenshots/` subtree (issue #551): the overview GIF
 * and, per captured step, a `NN-slug/` dir holding exactly `image.png` + `caption.txt`. The
 * `NN` is a zero-padded 2-digit position and `slug` is Windows-safe kebab-case (no `:`).
 * Anything else under `screenshots/` is pollution.
 */
export const SCREENSHOT_ENTRY_RE =
  /^screenshots\/(overview\.gif|\d{2}-[a-z0-9-]{1,40}\/(image\.png|caption\.txt))$/;

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
  /** The path's filename relative to the bundle dir (may include the `screenshots/` prefix). */
  filename: string;
  /** Whether the file is one the bundle is allowed to contain. */
  allowed: boolean;
  /**
   * True when the path is inside the `screenshots/` subtree (issue #551). Such a path may be
   * allowed-in-bundle (`allowed: true` for a valid entry) yet is NEVER a valid stage-end
   * artifact — the stage boundary rejects it regardless of `allowed`.
   */
  screenshotSubtree: boolean;
}

/**
 * Classify a project-relative posix path against the feature-bundle layout. Returns
 * `null` when the path is not inside a feature bundle directory at all — the common
 * case, and the one that must pass through untouched. A path directly under the
 * container, or under the `_session` control dir, is not in a bundle either.
 *
 * A nested path (`<bundle>/sub/file`) is classified as NOT allowed: the bundle is a
 * flat set of rigid files, so a subdirectory is pollution just as a stray file is — with
 * the one carve-out for the `screenshots/` subtree (issue #551), whose valid entries are
 * allowed-in-bundle but are still rejected as stage-end artifacts.
 */
export function classifyBundlePath(relPath: string): BundlePathClassification | null {
  // Both callers hand this an already-normalized posix path (via `normalizeArtifactPath`),
  // but normalize defensively anyway: this function decides whether a write is INSIDE a
  // bundle, so an unrecognized spelling must never fail open into "not in a bundle". A
  // stray `./` or a Windows backslash would otherwise read as clean.
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const prefix = `${PATHS.FEATURE_EVIDENCE_DIR}/`;
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  const rest = normalized.slice(prefix.length);
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
  // The `screenshots/` subtree (issue #551): a valid entry is allowed-in-bundle, but every
  // screenshots path is flagged so the stage boundary can reject it as an artifact.
  if (filename === SCREENSHOTS_DIR || filename.startsWith(`${SCREENSHOTS_DIR}/`)) {
    return {
      dirName,
      filename,
      allowed: SCREENSHOT_ENTRY_RE.test(filename),
      screenshotSubtree: true,
    };
  }
  // Deliberately NOT tolerant of a temp file here, unlike `strayBundleFiles`. A stage
  // artifact is never legitimately an in-flight `.tmp`, so accepting one would hand back
  // a bypass: `--artifact <bundle>/notes.tmp` would clear the check AND stay invisible to
  // stray detection. Transience is a reason not to REPORT a file, not a reason to bless it.
  return {
    dirName,
    filename,
    allowed: ALLOWED_BUNDLE_FILENAMES.has(filename),
    screenshotSubtree: false,
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
  const bundleAbs = join(projectRoot, featureDir(dirName));
  let entries: string[];
  try {
    entries = readdirSync(bundleAbs);
  } catch {
    return [];
  }
  const legacy = isLegacyBundle(bundleAbs);
  const strays: string[] = [];
  for (const name of entries) {
    if (isAtomicWriteTemp(name)) {
      continue;
    }
    // Issue #551 — the `screenshots/` subtree is allowed; recurse and report only the
    // entries inside it that do not match the strict per-step layout.
    if (name === SCREENSHOTS_DIR) {
      strays.push(...strayScreenshotEntries(bundleAbs));
      continue;
    }
    if (ALLOWED_BUNDLE_FILENAMES.has(name)) continue;
    if (legacy && LEGACY_BUNDLE_FILENAMES.has(name)) continue;
    strays.push(name);
  }
  return strays.sort();
}

/**
 * Parse a bundle file as a JSON object: the whole file, or only its first non-blank line for a
 * JSONL ledger. Null when the file is absent, unreadable, or not an object.
 */
function readJsonObject(absPath: string, firstLineOnly: boolean): Record<string, unknown> | null {
  try {
    const text = readFileSync(absPath, 'utf8');
    const json = firstLineOnly ? text.split('\n').find((line) => line.trim().length > 0) : text;
    const parsed: unknown = json === undefined ? null : JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether a bundle was written before issue #581, judged from files no writer rewrites: the
 * first stage-evidence row (the open row) stamped `ts` rather than `recorded_at`, or the
 * frozen `specification.json` names a source other than the bundle's `spec.md`. `feature.json`
 * is not a signal: `updateFeatureRecord` re-stamps an old one in the new header.
 */
export function isLegacyBundle(bundleAbs: string): boolean {
  const openRow = readJsonObject(join(bundleAbs, FEATURE_BUNDLE_FILES.stageEvidence), true);
  if (openRow && typeof openRow.ts === 'string' && openRow.recorded_at === undefined) {
    return true;
  }
  const spec = readJsonObject(join(bundleAbs, FEATURE_BUNDLE_FILES.specification), false);
  return (
    spec !== null &&
    typeof spec.spec_file === 'string' &&
    spec.spec_file !== FEATURE_BUNDLE_FILES.specMd
  );
}

/**
 * Walk the `screenshots/` subtree and return every FILE (posix path relative to the bundle,
 * `screenshots/...`) that does not match {@link SCREENSHOT_ENTRY_RE}. In-flight atomic-write
 * temp files are tolerated, like everywhere else in the bundle. Returns `[]` when the subtree
 * is missing or unreadable.
 */
function strayScreenshotEntries(bundleAbs: string): string[] {
  const strays: string[] = [];
  const walk = (absDir: string, relPrefix: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (isAtomicWriteTemp(name)) {
        continue;
      }
      const abs = join(absDir, name);
      const rel = `${relPrefix}/${name}`;
      let isDir: boolean;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(abs, rel);
      } else if (!SCREENSHOT_ENTRY_RE.test(rel)) {
        strays.push(rel);
      }
    }
  };
  walk(join(bundleAbs, SCREENSHOTS_DIR), SCREENSHOTS_DIR);
  return strays;
}
