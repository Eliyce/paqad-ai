import { chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  KEPT_FOR_REVIEW,
  answerCommit,
  planCommit,
} from '../../../../src/onboarding/journey/commit.js';
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

describe('the commit plan and its refusals (AC-8)', () => {
  let root: string;
  const hash = (rel: string) => fileSha256(join(root, rel))!;

  beforeEach(() => {
    root = tempRoot('paqad-commit-plan-');
    gitRepo(root);
    writeFile(root, 'docs/kept.md', 'v1\n');
    writeFile(root, 'docs/head.md', 'head\n');
    writeFile(root, '.gitignore', 'docs/ignored.md\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    seedRun(root);
    updateRun(root, (draft) => {
      for (const stage of ONBOARDING_STAGES) draft.stages[stage.id] = { status: 'done' };
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('leaves out the allow list, secrets, deleted files, edited baseline pages, dirty-before files and ignored files', () => {
    writeFile(root, '.claude/settings.local.json', '{}\n');
    writeFile(root, 'docs/deploy.pem', 'key\n');
    writeFile(root, 'docs/gone.md', 'x\n');
    writeFile(root, 'docs/kept.md', 'edited by a person\n');
    writeFile(root, 'docs/head.md', 'dirty before onboarding\n');
    writeFile(root, 'docs/ignored.md', 'ignored\n');
    writeFile(root, 'docs/new.md', 'new\n');
    writeFile(root, 'docs/clean.md', 'clean\n');
    writeFile(root, 'docs/other.md', 'edited, not written by onboarding\n');
    git(root, 'add', 'docs/clean.md');
    git(root, 'commit', '-q', '-m', 'clean');
    const written = Object.fromEntries(
      [
        '.claude/settings.local.json',
        'docs/deploy.pem',
        'docs/gone.md',
        'docs/kept.md',
        'docs/head.md',
        'docs/ignored.md',
        'docs/new.md',
        'docs/clean.md',
      ].map((rel) => [rel, hash(rel)]),
    );
    rmSync(join(root, 'docs/gone.md'));
    writeFile(root, '.paqad/onboarding/choices.jsonl', '{}\n');
    updateRun(root, (draft) => {
      draft.written = { ...written, '../escape.md': 'x' };
      draft.docs_baseline = { 'docs/kept.md': 'before', 'docs/other.md': 'before' };
      draft.baseline = { 'docs/head.md': 'dirty-before', 'docs/clean.md': hash('docs/clean.md') };
    });
    const plan = planCommit(root, readRun(root)!);
    expect(plan.include).toEqual([
      '.paqad/onboarding/choices.jsonl',
      'docs/clean.md',
      'docs/new.md',
    ]);
    expect(Object.fromEntries(plan.left_out.map((item) => [item.path, item.reason]))).toEqual({
      '.claude/settings.local.json': 'local allow list, never committed',
      '../escape.md': 'outside the files onboarding may commit',
      'docs/deploy.pem': 'looks like a secret',
      'docs/gone.md': 'no longer exists',
      'docs/kept.md': KEPT_FOR_REVIEW,
      'docs/head.md': 'already had changes before onboarding started',
      'docs/ignored.md': 'git-ignored',
      'docs/other.md': KEPT_FOR_REVIEW,
      '.paqad/onboarding/journey.json': 'not written by onboarding',
    });
  });

  it('commits from a detached HEAD with the given message, then refuses a second commit', () => {
    writeFile(root, 'docs/new.md', 'new\n');
    updateRun(root, (draft) => void (draft.written = { 'docs/new.md': hash('docs/new.md') }));
    git(root, 'checkout', '-q', '--detach');
    const record = answerCommit(
      root,
      { kind: 'branch', branch: true, message: 'docs(#1): add the paqad onboarding docs' },
      clockAt(5),
    );
    expect(git(root, 'log', '-1', '--format=%s').trim()).toBe(
      'docs(#1): add the paqad onboarding docs',
    );
    expect(record.committed).toEqual(['docs/new.md']);
    expect(() => answerCommit(root, { kind: 'later' }, clockAt(6))).toThrow(
      'The onboarding changes are already committed.',
    );
  });

  it('goes back to a detached HEAD when the commit fails', () => {
    writeFile(root, 'docs/new.md', 'new\n');
    updateRun(root, (draft) => void (draft.written = { 'docs/new.md': hash('docs/new.md') }));
    const head = git(root, 'rev-parse', 'HEAD').trim();
    git(root, 'checkout', '-q', '--detach');
    writeFile(root, '.hooks/pre-commit', '#!/bin/sh\nexit 1\n');
    chmodSync(join(root, '.hooks/pre-commit'), 0o755);
    git(root, 'config', 'core.hooksPath', '.hooks');
    expect(() => answerCommit(root, { kind: 'branch', branch: true }, clockAt(5))).toThrow(
      `went back to ${head}`,
    );
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(head);
    expect(git(root, 'branch', '--list').trim()).toMatch(/HEAD detached/u);
  });

  it('refuses a message that breaks the team pattern and a commit with nothing onboarding wrote', () => {
    expect(() =>
      answerCommit(root, { kind: 'branch', branch: true, message: 'wip' }, clockAt(5)),
    ).toThrow('Pass --message "<subject>" and --ticket <id>.');
    expect(() => answerCommit(root, { kind: 'branch', branch: true }, clockAt(5))).toThrow(
      'There is nothing onboarding wrote that can be committed.',
    );
    expect(readRun(root)?.commit).toBeUndefined();
  });

  it('a degraded Wrap up may still answer later', () => {
    updateRun(root, (draft) => void (draft.stages.finish = { status: 'degraded' }));
    expect(answerCommit(root, { kind: 'later' }, clockAt(5)).answer).toBe('later');
  });
});
