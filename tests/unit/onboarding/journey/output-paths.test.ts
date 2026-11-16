import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordUnit } from '../../../../src/onboarding/journey/actions.js';
import { planCommit } from '../../../../src/onboarding/journey/commit.js';
import { readEvents } from '../../../../src/onboarding/journey/events.js';
import { isCleanRepoPath } from '../../../../src/onboarding/journey/paths.js';
import { readRun, updateRun } from '../../../../src/onboarding/journey/run-store.js';

import { git, gitRepo } from './fixtures/git.js';
import { clockAt, seedRun, tempRoot, writeFile } from './fixtures/journey.js';

describe('INV-6 INV-13: unit output paths are normalized and kept inside the project', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = tempRoot('paqad-outputs-');
    outside = tempRoot('paqad-outside-');
    seedRun(root);
    updateRun(root, (draft) => void (draft.stages.project_docs = { status: 'running' }));
    writeFile(root, 'docs/stack/overview.md', '# Stack\n');
    writeFile(root, 'src/x.ts', 'export const x = 1;\n');
    writeFile(outside, 'secret.md', 'not the project\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  function record(...outputs: string[]) {
    return recordUnit(root, 'project_docs', 'stack', { outputs, kept: false }, clockAt(1));
  }

  it('stores the normalized repo-relative path', () => {
    const run = record('./docs//stack/overview.md');
    expect(Object.keys(run.written)).toEqual(['docs/stack/overview.md']);
    const unit = readEvents(root).find((event) => event.kind === 'unit');
    expect(Object.keys(unit?.outputs ?? {})).toEqual(['docs/stack/overview.md']);
  });

  it('accepts an absolute path inside the project and stores it relative', () => {
    const run = record(join(root, 'docs/stack/overview.md'));
    expect(Object.keys(run.written)).toEqual(['docs/stack/overview.md']);
  });

  it('refuses docs/../src/x.ts and records nothing', () => {
    expect(() => record('docs/../src/x.ts')).toThrow('".."');
    expect(readRun(root)?.written).toEqual({});
    expect(readEvents(root).some((event) => event.kind === 'unit')).toBe(false);
  });

  it('refuses an absolute path outside the project', () => {
    expect(() => record(join(outside, 'secret.md'))).toThrow('outside the project');
  });

  it('refuses an output that escapes the project through a symlink', () => {
    mkdirSync(join(root, 'docs/linked'), { recursive: true });
    symlinkSync(outside, join(root, 'docs/linked/out'));
    expect(() => record('docs/linked/out/secret.md')).toThrow('symlink');
    symlinkSync(join(root, 'src/x.ts'), join(root, 'docs/x.md'));
    expect(() => record('docs/x.md')).toThrow('symlink');
    expect(readRun(root)?.written).toEqual({});
  });
});

describe('INV-6 INV-13: the commit checks normalized paths only', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-commit-paths-');
    gitRepo(root);
    writeFile(root, 'README.md', '# app\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    writeFile(root, 'src/x.ts', 'export const x = 1;\n');
    writeFile(root, 'docs/stack/overview.md', '# Stack\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('leaves out a recorded path that is not a clean docs/ path', () => {
    const run = seedRun(root, {
      written: {
        'docs/../src/x.ts': 'x',
        './docs/stack/overview.md': 'x',
        [join(root, 'docs/stack/overview.md')]: 'x',
      },
    });
    const plan = planCommit(root, run);
    expect(plan.include).toEqual([]);
    const reasons = Object.fromEntries(plan.left_out.map((item) => [item.path, item.reason]));
    expect(reasons['docs/../src/x.ts']).toBe('outside the files onboarding may commit');
    expect(reasons['./docs/stack/overview.md']).toBe('outside the files onboarding may commit');
    expect(reasons[join(root, 'docs/stack/overview.md')]).toBe(
      'outside the files onboarding may commit',
    );
  });

  it('isCleanRepoPath accepts only plain repo-relative paths', () => {
    expect(isCleanRepoPath('docs/a.md')).toBe(true);
    for (const bad of [
      '',
      '/docs/a.md',
      'docs/../a.md',
      './docs/a.md',
      'docs//a.md',
      'docs\\a.md',
    ]) {
      expect(isCleanRepoPath(bad)).toBe(false);
    }
  });
});
