import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { DYNAMIC_BUNDLE_FILES } from './manifest.js';
import {
  FEATURE_BUNDLE_FILES,
  LEGACY_BUNDLE_FILES,
  SCREENSHOTS_DIR,
  featureDir,
  isFeatureDirName,
} from './paths.js';

export const ALLOWED_BUNDLE_FILENAMES: ReadonlySet<string> = new Set<string>([
  ...Object.values(FEATURE_BUNDLE_FILES),
  'report.html',
]);

export function isAllowedBundleFilename(filename: string): boolean {
  return (
    ALLOWED_BUNDLE_FILENAMES.has(filename) ||
    DYNAMIC_BUNDLE_FILES.some((entry) => entry.pattern.test(filename))
  );
}

export const LEGACY_BUNDLE_FILENAMES: ReadonlySet<string> = new Set<string>(
  Object.values(LEGACY_BUNDLE_FILES),
);

export const SCREENSHOT_ENTRY_RE =
  /^screenshots\/(overview\.gif|\d{2}-[a-z0-9-]{1,40}\/(image\.png|caption\.txt))$/;

function isAtomicWriteTemp(filename: string): boolean {
  return /\.tmp(-\d+)?$/.test(filename);
}

export interface BundlePathClassification {
  dirName: string;
  filename: string;
  allowed: boolean;
  screenshotSubtree: boolean;
}

export function classifyBundlePath(relPath: string): BundlePathClassification | null {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const prefix = `${PATHS.FEATURE_EVIDENCE_DIR}/`;
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  const rest = normalized.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash === -1) {
    return null;
  }
  const dirName = rest.slice(0, slash);
  const filename = rest.slice(slash + 1);
  if (!isFeatureDirName(dirName)) {
    return null;
  }
  if (filename === SCREENSHOTS_DIR || filename.startsWith(`${SCREENSHOTS_DIR}/`)) {
    return {
      dirName,
      filename,
      allowed: SCREENSHOT_ENTRY_RE.test(filename),
      screenshotSubtree: true,
    };
  }
  return {
    dirName,
    filename,
    allowed: isAllowedBundleFilename(filename),
    screenshotSubtree: false,
  };
}

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
    if (name === SCREENSHOTS_DIR) {
      strays.push(...strayScreenshotEntries(bundleAbs));
      continue;
    }
    if (isAllowedBundleFilename(name)) continue;
    if (legacy && LEGACY_BUNDLE_FILENAMES.has(name)) continue;
    strays.push(name);
  }
  return strays.sort();
}

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
