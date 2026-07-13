import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_IGNORE_GLOBS,
  DEFAULT_SOURCE_GLOBS,
  dropGitIgnored,
  scanWorkingTree,
} from '@/core/fs/gitignore-scan.js';

function git(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

describe('gitignore-scan', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-gitignore-scan-'));
    git(root, ['init']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test']);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('dropGitIgnored', () => {
    it('drops files matched by .gitignore, keeps the rest', () => {
      writeFileSync(join(root, '.gitignore'), 'ignored.ts\n');
      writeFileSync(join(root, 'ignored.ts'), 'x');
      writeFileSync(join(root, 'kept.ts'), 'y');
      const result = dropGitIgnored(root, ['ignored.ts', 'kept.ts']);
      expect(result).toEqual(['kept.ts']);
    });

    it('keeps a tracked file even when a pattern would match it (index wins)', () => {
      writeFileSync(join(root, '.gitignore'), '*.ts\n');
      writeFileSync(join(root, 'tracked.ts'), 'y');
      git(root, ['add', '-f', 'tracked.ts']);
      const result = dropGitIgnored(root, ['tracked.ts']);
      expect(result).toEqual(['tracked.ts']);
    });

    it('falls back to the input list unchanged when the dir is not a git repo', () => {
      const nonRepo = mkdtempSync(join(tmpdir(), 'paqad-nonrepo-'));
      try {
        writeFileSync(join(nonRepo, 'a.ts'), 'x');
        expect(dropGitIgnored(nonRepo, ['a.ts', 'b.ts'])).toEqual(['a.ts', 'b.ts']);
      } finally {
        rmSync(nonRepo, { recursive: true, force: true });
      }
    });

    it('returns an empty result for an empty input without erroring', () => {
      expect(dropGitIgnored(root, [])).toEqual([]);
    });
  });

  describe('scanWorkingTree', () => {
    it('enumerates matching files, drops ignored ones, and sorts', () => {
      writeFileSync(join(root, '.gitignore'), 'skip.ts\n');
      writeFileSync(join(root, 'b.ts'), 'x');
      writeFileSync(join(root, 'a.ts'), 'y');
      writeFileSync(join(root, 'skip.ts'), 'z');
      writeFileSync(join(root, 'note.md'), 'not source');
      const result = scanWorkingTree(root);
      expect(result).toEqual(['a.ts', 'b.ts']);
    });

    it('never descends into the statically-ignored directories', () => {
      mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(join(root, 'node_modules', 'pkg', 'dep.ts'), 'x');
      writeFileSync(join(root, 'real.ts'), 'y');
      expect(scanWorkingTree(root)).toEqual(['real.ts']);
    });

    it('honours a caller-supplied glob set (e.g. php/dart)', () => {
      writeFileSync(join(root, 'a.php'), '<?php');
      writeFileSync(join(root, 'b.ts'), 'x');
      const result = scanWorkingTree(root, ['**/*.php']);
      expect(result).toEqual(['a.php']);
    });

    it('exposes the shared default glob and ignore constants', () => {
      expect(DEFAULT_SOURCE_GLOBS).toContain('**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}');
      expect(DEFAULT_IGNORE_GLOBS).toContain('**/node_modules/**');
    });
  });
});
