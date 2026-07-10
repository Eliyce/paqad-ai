// Per-feature export + retention (issue #339, Phase 7 — the open threads).
//
// A feature's bundle is git-ignored, so an auditor can't just `git show` it. `export`
// collects one feature's whole record — every rigid bundle file, parsed — into a single
// self-contained JSON document you can hand off. `prune` is the retention policy: it
// removes the oldest feature bundles beyond a keep-count, never touching a feature that
// is still active or paused in any session control (that would drop live work).

import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readUnitFile } from '@/session-ledger/ledger.js';

import { listFeatureDirs } from './delivery.js';
import {
  FEATURE_BUNDLE_FILES,
  featureDir,
  featureFilePath,
  parseFeatureDirName,
  type FeatureBundleFile,
} from './paths.js';
import { readSessionControl } from './session-control.js';

/** A feature's whole bundle as one document: each file parsed (JSONL → row array). */
export interface FeatureBundleExport {
  dir_name: string;
  exported_at: string;
  files: Partial<Record<FeatureBundleFile, unknown>>;
}

function readJson(projectRoot: string, rel: string): unknown {
  try {
    return JSON.parse(readFileSync(join(projectRoot, rel), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Collect one feature's entire bundle into a self-contained export document — every
 * rigid file parsed (a `.json` object, a `.jsonl` row array). Absent files are omitted.
 * `exportedAt` is supplied so the call stays deterministic.
 */
export function exportFeatureBundle(
  projectRoot: string,
  dirName: string,
  exportedAt: string,
): FeatureBundleExport {
  const files: Partial<Record<FeatureBundleFile, unknown>> = {};
  for (const key of Object.keys(FEATURE_BUNDLE_FILES) as FeatureBundleFile[]) {
    const rel = featureFilePath(dirName, key);
    if (FEATURE_BUNDLE_FILES[key].endsWith('.jsonl')) {
      const rows = readUnitFile(projectRoot, rel);
      if (rows.length > 0) files[key] = rows;
    } else {
      const parsed = readJson(projectRoot, rel);
      if (parsed !== null) files[key] = parsed;
    }
  }
  return { dir_name: dirName, exported_at: exportedAt, files };
}

/** Every feature dir name that is active or paused in ANY session control. */
function liveFeatureDirs(projectRoot: string): Set<string> {
  const live = new Set<string>();
  let sessionFiles: string[];
  try {
    sessionFiles = readdirSync(join(projectRoot, PATHS.FEATURE_EVIDENCE_SESSION_DIR)).filter(
      (name) => name.endsWith('.json'),
    );
  } catch {
    return live;
  }
  for (const file of sessionFiles) {
    const control = readSessionControl(projectRoot, file.replace(/\.json$/, ''));
    if (control.active) live.add(control.active);
    for (const paused of control.paused) live.add(paused);
  }
  return live;
}

export interface PruneResult {
  removed: string[];
  kept: string[];
}

/**
 * Retention: keep the `keep` most-recent feature bundles (by ULID, time-ordered) and
 * remove the rest — but NEVER a feature still active or paused in a session control.
 * Returns which dirs were removed vs kept. A no-op when at or under the keep-count.
 */
export function pruneFeatureBundles(projectRoot: string, keep: number): PruneResult {
  const live = liveFeatureDirs(projectRoot);
  // Newest first, ordered by the time-sortable ULID (not the slug-dominated dir name).
  const ordered = listFeatureDirs(projectRoot).sort((a, b) =>
    (parseFeatureDirName(b)?.ulid ?? b).localeCompare(parseFeatureDirName(a)?.ulid ?? a),
  );
  const removed: string[] = [];
  const kept: string[] = [];
  let keptNonLive = 0;
  for (const dirName of ordered) {
    // A live (active/paused) feature is always kept and never consumes the keep quota.
    if (live.has(dirName)) {
      kept.push(dirName);
      continue;
    }
    if (keptNonLive < keep) {
      kept.push(dirName);
      keptNonLive++;
      continue;
    }
    try {
      rmSync(join(projectRoot, featureDir(dirName)), { recursive: true, force: true });
      removed.push(dirName);
    } catch {
      kept.push(dirName);
    }
  }
  return { removed, kept };
}
