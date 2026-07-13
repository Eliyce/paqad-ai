// Entry-point allowlist for the code-knowledge index (issue #353). A file with no
// in-edges is only flagged `orphan` when it is NOT an entry point — otherwise every
// bin, CLI command, runtime hook, and test would be a false "dead code" hit. The
// resolved glob list rides in the index header so a consumer can see exactly why a
// file was spared.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { DEFAULT_IGNORE_GLOBS } from '@/core/fs/gitignore-scan.js';

/** Framework-convention entry points that are reached from outside the import graph. */
export const STATIC_ENTRY_GLOBS: readonly string[] = [
  'src/cli/**',
  'runtime/hooks/**',
  'runtime/scripts/**',
  'scripts/**',
  'tests/**',
  '**/*.test.{ts,tsx,js,jsx,mjs,cjs}',
  '**/*.spec.{ts,tsx,js,jsx,mjs,cjs}',
  '**/__tests__/**',
];

/** True for a test file — its imports never count toward a symbol's production callers. */
export function isTestFile(relPath: string): boolean {
  return (
    /(?:^|\/)__tests__\//.test(relPath) ||
    /(?:^|\/)tests\//.test(relPath) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relPath)
  );
}

interface PackageJson {
  main?: unknown;
  bin?: unknown;
  exports?: unknown;
}

/** Collect the string leaf values of package.json main/bin/exports as globs. */
function packageEntryGlobs(projectRoot: string): string[] {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return [];
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson;
  } catch {
    return [];
  }
  const globs = new Set<string>();
  collectStringLeaves(pkg.main, globs);
  collectStringLeaves(pkg.bin, globs);
  collectStringLeaves(pkg.exports, globs);
  return [...globs];
}

function collectStringLeaves(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    const normalized = value.replace(/^\.\//, '');
    if (normalized.length > 0 && !normalized.startsWith('#')) {
      out.add(normalized);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectStringLeaves(nested, out);
    }
  }
}

export interface EntryPoints {
  /** The full glob list (static conventions + package entries), for the index header. */
  globs: string[];
  /** Project-relative files matched by any entry-point glob. */
  files: Set<string>;
}

/**
 * Resolve the entry-point allowlist for a project: the static convention globs plus
 * the package.json entry paths, expanded against the working tree so membership is a
 * simple set lookup.
 */
export function resolveEntryPoints(projectRoot: string): EntryPoints {
  const globs = [...STATIC_ENTRY_GLOBS, ...packageEntryGlobs(projectRoot)];
  const files = new Set(
    fg.sync(globs, { cwd: projectRoot, ignore: DEFAULT_IGNORE_GLOBS, onlyFiles: true }),
  );
  return { globs, files };
}
