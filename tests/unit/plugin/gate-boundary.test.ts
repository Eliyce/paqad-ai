import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

function git(args: string[]): { ok: boolean; out: string } {
  const run = spawnSync('git', args, { encoding: 'utf8' });
  return { ok: run.status === 0, out: run.stdout.trim() };
}

function baseCommit(): string | null {
  for (const ref of ['origin/main', 'main']) {
    const found = git(['merge-base', 'HEAD', ref]);
    if (found.ok && found.out !== '') return found.out;
  }
  return null;
}

const base = baseCommit();

describe('what this change may not touch', () => {
  it.runIf(base !== null)(
    'AC-7: the diff against main holds no hook list, hook script or edit gate',
    () => {
      const changed = git(['diff', '--name-only', base!]).out.split('\n');
      const touched = changed.filter(
        (path) =>
          path === 'runtime/claude-plugin/hooks.json' ||
          path.startsWith('runtime/hooks/') ||
          path === 'src/kernel/gate.ts',
      );
      expect(touched).toEqual([]);
    },
  );
});
