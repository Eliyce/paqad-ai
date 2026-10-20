import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { DEFAULT_IGNORE_GLOBS } from '@/core/fs/gitignore-scan.js';

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

function packageEntryGlobs(projectRoot: string): string[] {
  const pkgPath = join(projectRoot, 'package.json');
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
  globs: string[];
  files: Set<string>;
}

export function resolveEntryPoints(projectRoot: string): EntryPoints {
  const globs = [...STATIC_ENTRY_GLOBS, ...packageEntryGlobs(projectRoot)];
  const files = new Set(
    fg.sync(globs, { cwd: projectRoot, ignore: DEFAULT_IGNORE_GLOBS, onlyFiles: true }),
  );
  return { globs, files };
}
