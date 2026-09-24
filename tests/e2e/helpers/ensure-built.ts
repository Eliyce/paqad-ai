import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { execa } from 'execa';

// Shared, lock-guarded "make sure dist is built and current" step for e2e tests that import
// or execute the built bundles (issue #579, NFR-2). The lock dir is the same one the other e2e
// suites use, so parallel workers never race on `pnpm run build`.

const repoRoot = process.cwd();
const lockRoot = join(repoRoot, '.tmp');
const lockDir = join(lockRoot, 'built-cli.lock');

/** The bundles a dist-importing test depends on. */
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

/** dist is current when every bundle exists and none is older than the newest src file. */
export function distIsCurrent(): boolean {
  if (!DIST_BUNDLES.every((bundle) => existsSync(bundle))) return false;
  const srcNewest = newestMtimeMs(join(repoRoot, 'src'));
  return DIST_BUNDLES.every((bundle) => statSync(bundle).mtimeMs >= srcNewest);
}

/** Build dist once, under the shared lock, when it is missing or older than src. */
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
