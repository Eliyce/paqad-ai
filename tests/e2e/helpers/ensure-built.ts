import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { execa } from 'execa';

const repoRoot = process.cwd();
const lockRoot = join(repoRoot, '.tmp');
const lockDir = join(lockRoot, 'built-cli.lock');

export const DIST_BUNDLES = [
  join(repoRoot, 'dist', 'index.js'),
  join(repoRoot, 'dist', 'cli', 'index.js'),
];

function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtimeMs(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

export function distIsCurrent(): boolean {
  if (!DIST_BUNDLES.every((bundle) => existsSync(bundle))) return false;
  const srcNewest = newestMtimeMs(join(repoRoot, 'src'));
  return DIST_BUNDLES.every((bundle) => statSync(bundle).mtimeMs >= srcNewest);
}

export async function ensureBuiltDist(): Promise<void> {
  if (distIsCurrent() && !existsSync(lockDir)) return;

  mkdirSync(lockRoot, { recursive: true });
  for (;;) {
    try {
      mkdirSync(lockDir, { recursive: false });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (distIsCurrent() && !existsSync(lockDir)) return;
      await sleep(100);
    }
  }

  try {
    if (!distIsCurrent()) {
      await execa('pnpm', ['run', 'build'], { cwd: repoRoot });
    }
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
