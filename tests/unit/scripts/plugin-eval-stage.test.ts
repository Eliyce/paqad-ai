import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  STAGED_ENTRIES,
  stagePluginEval,
  StagePluginEvalError,
  // @ts-expect-error -- pure JS helper shared with the runnable stage-plugin-eval.mjs script
} from '../../../scripts/lib/plugin-eval-stage.mjs';

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-eval-stage-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function countEntries(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    count += 1;
    if (entry.isDirectory()) count += countEntries(join(dir, entry.name));
  }
  return count;
}

function fakeRepo(withDist: boolean): string {
  const root = tempDir();
  for (const entry of [
    '.claude-plugin',
    'assets',
    'runtime',
    'evals/routing/a',
    'evals/results/x',
    'node_modules/dep',
    'src',
    '.git',
  ]) {
    mkdirSync(join(root, entry), { recursive: true });
  }
  if (withDist) mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, 'evals/routing/a/case.yaml'), 'name: a\n');
  writeFileSync(join(root, 'evals/results/x/report.html'), '<html>');
  return root;
}

describe('stagePluginEval', () => {
  it('copies the plugin entries and links node_modules, leaving results and repo-only dirs out', () => {
    const repo = fakeRepo(true);
    const dest = join(tempDir(), 'stage');
    stagePluginEval(repo, dest);
    expect(readdirSync(dest).sort()).toEqual([...STAGED_ENTRIES, 'node_modules'].sort());
    expect(lstatSync(join(dest, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(readdirSync(join(dest, 'evals'))).toEqual(['routing']);
  });

  it('fails with a named error when dist/ is missing', () => {
    const repo = fakeRepo(false);
    expect(() => stagePluginEval(repo, join(tempDir(), 'stage'))).toThrow(StagePluginEvalError);
    expect(() => stagePluginEval(repo, join(tempDir(), 'stage'))).toThrow(/dist\/ is missing/);
  });

  it('refuses a directory that is not empty', () => {
    const repo = fakeRepo(true);
    const dest = tempDir();
    writeFileSync(join(dest, 'keep'), '');
    expect(() => stagePluginEval(repo, dest)).toThrow(/not empty/);
  });

  it('stages this checkout well under the eval walker limit of 20000 entries', () => {
    const dest = join(tempDir(), 'stage');
    const out = spawnSync(process.execPath, [resolve('scripts/stage-plugin-eval.mjs'), dest], {
      encoding: 'utf8',
    });
    if (out.status !== 0) {
      expect(out.stderr).toContain('StagePluginEvalError: dist/ is missing');
      return;
    }
    expect(realpathSync(out.stdout.trim())).toBe(realpathSync(dest));
    expect(lstatSync(join(dest, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(countEntries(dest)).toBeLessThan(10_000);
  });
});
