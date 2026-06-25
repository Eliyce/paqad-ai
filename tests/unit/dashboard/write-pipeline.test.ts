import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  contentHash,
  PathNotAllowedError,
  readManagedFile,
  resolveManagedPath,
  WriteConflictError,
  writeManagedFile,
} from '@/dashboard/write-pipeline.js';

function write(root: string, relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('dashboard write pipeline', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-write-pipeline-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('resolveManagedPath', () => {
    it('allows docs/instructions/** and the named config files', () => {
      expect(() =>
        resolveManagedPath(root, 'docs/instructions/rules/coding/style.md'),
      ).not.toThrow();
      expect(() =>
        resolveManagedPath(root, 'docs/instructions/workflows/delivery-policy.yaml'),
      ).not.toThrow();
      expect(() => resolveManagedPath(root, '.paqad/project-profile.yaml')).not.toThrow();
      expect(() => resolveManagedPath(root, '.paqad/rag.ignore.yaml')).not.toThrow();
    });

    it('rejects the retired decision-pause contract path (editor removed)', () => {
      // #229 retired the dashboard decision-contract editor: the path is no
      // longer on the named-file allowlist, so the dotfile rule rejects it.
      expect(() => resolveManagedPath(root, '.paqad/decision-pause-contract.md')).toThrow(
        PathNotAllowedError,
      );
      expect(() => resolveManagedPath(root, '.paqad/decision-pause-contract.md')).toThrow(
        /dotfiles/,
      );
    });

    it('rejects traversal, dotfiles, foreign roots, and uneditable extensions', () => {
      const cases: [string, RegExp][] = [
        ['docs/instructions/../../etc/passwd.md', /traversal/],
        ['docs/instructions/rules/.hidden.md', /dotfiles/],
        ['src/index.ts', /outside docs\/instructions/],
        // not on the named-file allowlist, so the dotfile rule fires
        ['.paqad/audit.log', /dotfiles/],
        ['docs/instructions/rules/script.sh', /extension/],
        ['', /empty path/],
      ];
      for (const [path, reason] of cases) {
        expect(() => resolveManagedPath(root, path), path).toThrow(PathNotAllowedError);
        expect(() => resolveManagedPath(root, path), path).toThrow(reason);
      }
    });

    it('rejects symlinks inside the allowlist', () => {
      const outside = mkdtempSync(join(tmpdir(), 'paqad-outside-'));
      try {
        writeFileSync(join(outside, 'target.md'), 'outside content');
        mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
        symlinkSync(join(outside, 'target.md'), join(root, 'docs/instructions/rules/link.md'));
        expect(() => resolveManagedPath(root, 'docs/instructions/rules/link.md')).toThrow(
          /symlinks/,
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('rejects a symlinked parent directory escaping the root', () => {
      const outside = mkdtempSync(join(tmpdir(), 'paqad-outside-'));
      try {
        mkdirSync(join(root, 'docs'), { recursive: true });
        symlinkSync(outside, join(root, 'docs/instructions'));
        expect(() => resolveManagedPath(root, 'docs/instructions/rules/a.md')).toThrow(
          PathNotAllowedError,
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe('readManagedFile', () => {
    it('returns content with its hash', () => {
      write(root, 'docs/instructions/rules/a.md', '# rule');
      const file = readManagedFile(root, 'docs/instructions/rules/a.md');
      expect(file).toMatchObject({ exists: true, content: '# rule' });
      expect(file.hash).toBe(contentHash('# rule'));
    });

    it('reports a missing file without a hash', () => {
      const file = readManagedFile(root, 'docs/instructions/rules/missing.md');
      expect(file).toEqual({
        path: 'docs/instructions/rules/missing.md',
        exists: false,
        content: null,
        hash: null,
      });
    });
  });

  describe('writeManagedFile', () => {
    it('writes through the pipeline and appends the dashboard audit line', () => {
      write(root, 'docs/instructions/rules/a.md', 'old');
      const result = writeManagedFile(root, {
        relativePath: 'docs/instructions/rules/a.md',
        content: 'new content',
        baseHash: contentHash('old'),
        action: 'dashboard.instructions.write',
      });

      expect(readFileSync(join(root, 'docs/instructions/rules/a.md'), 'utf8')).toBe('new content');
      expect(result.hash).toBe(contentHash('new content'));
      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('dashboard.instructions.write');
      expect(audit).toContain('actor="dashboard"');
      expect(audit).toContain('path="docs/instructions/rules/a.md"');
      expect(audit).toContain(result.hash);
    });

    it('creates a new file when baseHash is null', () => {
      const result = writeManagedFile(root, {
        relativePath: 'docs/instructions/rules/new.md',
        content: '# fresh',
        baseHash: null,
        action: 'dashboard.instructions.write',
      });
      expect(result.path).toBe('docs/instructions/rules/new.md');
      expect(readFileSync(join(root, 'docs/instructions/rules/new.md'), 'utf8')).toBe('# fresh');
    });

    it('returns a 409-shaped conflict when the file changed since it was loaded', () => {
      write(root, 'docs/instructions/rules/a.md', 'agent edited this meanwhile');
      let conflict: WriteConflictError | null = null;
      try {
        writeManagedFile(root, {
          relativePath: 'docs/instructions/rules/a.md',
          content: 'my edit',
          baseHash: contentHash('what I loaded'),
          action: 'dashboard.instructions.write',
        });
      } catch (err) {
        conflict = err as WriteConflictError;
      }
      expect(conflict).toBeInstanceOf(WriteConflictError);
      expect(conflict?.currentContent).toBe('agent edited this meanwhile');
      expect(conflict?.currentHash).toBe(contentHash('agent edited this meanwhile'));
      expect(conflict?.message).toContain('changed since you opened it');
      // The losing write must not land.
      expect(readFileSync(join(root, 'docs/instructions/rules/a.md'), 'utf8')).toBe(
        'agent edited this meanwhile',
      );
    });

    it('conflicts when creating a file that already exists', () => {
      write(root, 'docs/instructions/rules/a.md', 'already here');
      expect(() =>
        writeManagedFile(root, {
          relativePath: 'docs/instructions/rules/a.md',
          content: 'x',
          baseHash: null,
          action: 'dashboard.instructions.write',
        }),
      ).toThrow(WriteConflictError);
    });

    it('caps the managed file size', () => {
      expect(() =>
        writeManagedFile(root, {
          relativePath: 'docs/instructions/rules/big.md',
          content: 'x'.repeat(1024 * 1024 + 1),
          baseHash: null,
          action: 'dashboard.instructions.write',
        }),
      ).toThrow(/write limit/);
    });
  });
});
