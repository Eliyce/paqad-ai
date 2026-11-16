import { chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { answerCommit } from '../../../../src/onboarding/journey/commit.js';
import { fileSha256 } from '../../../../src/onboarding/journey/preflight.js';
import { readRun, updateRun } from '../../../../src/onboarding/journey/run-store.js';
import { ONBOARDING_STAGES } from '../../../../src/onboarding/journey/stages.js';

import { git, gitRepo } from './fixtures/git.js';
import { clockAt, seedRun, tempRoot, writeFile } from './fixtures/journey.js';

describe('the commit question', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-commit-');
    gitRepo(root);
    writeFile(root, 'README.md', '# app\n');
    writeFile(root, 'notes.md', 'v1\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    writeFile(root, 'notes.md', 'mine, before onboarding\n');
    seedRun(root, { baseline: { 'notes.md': 'dirty-before' } });
    writeFile(root, 'docs/stack/overview.md', '# Stack\n');
    writeFile(root, 'docs/architecture/overview.md', '# Arch\n');
    writeFile(root, '.env', 'SECRET=1\n');
    updateRun(root, (draft) => {
      for (const stage of ONBOARDING_STAGES) draft.stages[stage.id] = { status: 'done' };
      draft.written = {
        'docs/stack/overview.md': fileSha256(`${root}/docs/stack/overview.md`)!,
        'docs/architecture/overview.md': fileSha256(`${root}/docs/architecture/overview.md`)!,
        '.env': fileSha256(`${root}/.env`)!,
        'src/app.ts': 'x',
      };
    });
    writeFile(root, 'docs/architecture/overview.md', '# Arch, edited by a person\n');
    writeFile(root, 'scratch.txt', 'never written by the journey\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-8 INV-6 INV-13: commits only unchanged journey files on a branches.yaml branch and names what it left out', () => {
    const record = answerCommit(root, { kind: 'branch', branch: true }, clockAt(5));
    expect(record.branch).toMatch(/paqad-onboarding/u);
    expect(git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(record.branch);
    expect(record.committed).toEqual(['docs/stack/overview.md']);
    const leftOut = Object.fromEntries(
      (record.left_out ?? []).map((item) => [item.path, item.reason]),
    );
    expect(leftOut['docs/architecture/overview.md']).toBe('changed since onboarding wrote it');
    expect(leftOut['scratch.txt']).toBe('not written by onboarding');
    expect(leftOut['notes.md']).toBe('not written by onboarding');
    expect(leftOut['.env']).toBe('outside the files onboarding may commit');
    expect(leftOut['src/app.ts']).toBe('outside the files onboarding may commit');
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe(
      'docs/stack/overview.md',
    );
    expect(git(root, 'remote').trim()).toBe('');
    expect(readRun(root)?.status).toBe('done');
  });

  it('AC-20: declining ends the journey with the files left uncommitted', () => {
    answerCommit(root, { kind: 'no' }, clockAt(5));
    expect(readRun(root)?.commit?.answer).toBe('no');
    expect(git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(git(root, 'status', '--porcelain')).toContain('docs/');
  });

  it('INV-7: refuses before Wrap up is done', () => {
    updateRun(root, (draft) => void (draft.stages.finish = { status: 'running' }));
    expect(() => answerCommit(root, { kind: 'later' }, clockAt(5))).toThrow('after step 8');
  });

  it('goes back to the original branch and deletes the new one when the commit fails', () => {
    writeFile(root, '.hooks/pre-commit', '#!/bin/sh\necho "hook says no" >&2\nexit 1\n');
    chmodSync(join(root, '.hooks/pre-commit'), 0o755);
    git(root, 'config', 'core.hooksPath', '.hooks');
    expect(() => answerCommit(root, { kind: 'branch', branch: true }, clockAt(5))).toThrow(
      /went back to main.*hook says no/u,
    );
    expect(git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(git(root, 'branch', '--list').trim()).toBe('* main');
    expect(git(root, 'diff', '--cached', '--name-only').trim()).toBe('');
    expect(readRun(root)?.commit).toBeUndefined();
    expect(readRun(root)?.status).not.toBe('done');
  });

  it('refuses a typed branch name that breaks the team pattern', () => {
    expect(() => answerCommit(root, { kind: 'branch', branch: 'whatever' }, clockAt(5))).toThrow(
      /pattern/u,
    );
  });
});
