import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readEvidenceRowsAt } from '@/evidence/ledger.js';
import { readUnitFile } from '@/session-ledger/ledger.js';

import { strayBundleFiles } from './bundle-integrity.js';
import { listFeatureDirs } from './delivery.js';
import {
  FEATURE_BUNDLE_FILES,
  featureDir,
  featureFilePath,
  parseFeatureDirName,
  type FeatureBundleFile,
} from './paths.js';
import { readSessionControl } from './session-control.js';

export interface FeatureBundleExport {
  dir_name: string;
  exported_at: string;
  files: Partial<Record<FeatureBundleFile, unknown>>;
  strays: string[];
}

function readText(projectRoot: string, rel: string): string | null {
  try {
    return readFileSync(join(projectRoot, rel), 'utf8');
  } catch {
    return null;
  }
}

function readJson(projectRoot: string, rel: string): unknown {
  const text = readText(projectRoot, rel);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function exportFeatureBundle(
  projectRoot: string,
  dirName: string,
  exportedAt: string,
): FeatureBundleExport {
  const files: Partial<Record<FeatureBundleFile, unknown>> = {};
  for (const key of Object.keys(FEATURE_BUNDLE_FILES) as FeatureBundleFile[]) {
    const rel = featureFilePath(dirName, key);
    if (FEATURE_BUNDLE_FILES[key].endsWith('.jsonl')) {
      const rows =
        key === 'evidence' ? readEvidenceRowsAt(projectRoot, rel) : readUnitFile(projectRoot, rel);
      if (rows.length > 0) files[key] = rows;
    } else if (FEATURE_BUNDLE_FILES[key].endsWith('.md')) {
      const text = readText(projectRoot, rel);
      if (text !== null) files[key] = text;
    } else {
      const parsed = readJson(projectRoot, rel);
      if (parsed !== null) files[key] = parsed;
    }
  }
  return {
    dir_name: dirName,
    exported_at: exportedAt,
    files,
    strays: strayBundleFiles(projectRoot, dirName),
  };
}

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

export function pruneFeatureBundles(projectRoot: string, keep: number): PruneResult {
  const live = liveFeatureDirs(projectRoot);
  const ordered = listFeatureDirs(projectRoot).sort((a, b) =>
    (parseFeatureDirName(b)?.ulid ?? b).localeCompare(parseFeatureDirName(a)?.ulid ?? a),
  );
  const removed: string[] = [];
  const kept: string[] = [];
  let keptNonLive = 0;
  for (const dirName of ordered) {
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
