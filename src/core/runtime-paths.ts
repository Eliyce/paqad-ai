import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'paqad-ai';

let packageRoot: string | null = null;

function isPaqadPackageDir(dir: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name?: unknown;
    } | null;
    return parsed?.name === PACKAGE_NAME;
  } catch {
    // Missing, unreadable, or unparseable package.json: not ours, keep walking.
    return false;
  }
}

/**
 * Walk up from `start` to the first folder whose package.json is named `paqad-ai`
 * (issue #579). A fixed `../..` depth broke for the depth-one `dist/index.js` bundle the
 * Stop hook imports, which resolved one folder too high. Walking to the package.json
 * gives the same answer from `src/core/`, `dist/`, and `dist/<entry>/`.
 */
export function findPackageRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (isPaqadPackageDir(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`${PACKAGE_NAME}: could not find the package root above ${start}`);
    }
    dir = parent;
  }
}

/**
 * The paqad-ai package root, resolved lazily on first call and memoized, so importing a
 * bundle for an unrelated API never fails at import time.
 */
export function getPackageRoot(): string {
  packageRoot ??= findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  return packageRoot;
}

export function getRuntimeRoot(): string {
  return join(getPackageRoot(), 'runtime');
}

export function getRuntimeTemplatesRoot(): string {
  return join(getRuntimeRoot(), 'templates');
}
