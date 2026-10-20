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
    return false;
  }
}

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
