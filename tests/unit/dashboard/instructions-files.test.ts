import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listInstructionsTree,
  readInstructionsFile,
  type InstructionsTreeNode,
} from '@/dashboard/instructions-files.js';
import { contentHash, PathNotAllowedError } from '@/dashboard/write-pipeline.js';

function write(root: string, relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function flatten(node: InstructionsTreeNode): string[] {
  if (node.type === 'file') return [node.path];
  return (node.children ?? []).flatMap(flatten);
}

describe('instructions files', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-instructions-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('listInstructionsTree', () => {
    it('reports a missing docs/instructions directory', () => {
      expect(listInstructionsTree(root)).toEqual({
        root: 'docs/instructions',
        exists: false,
        tree: null,
      });
    });

    it('lists editable files in sorted order, skipping dotfiles and foreign extensions', () => {
      write(root, 'docs/instructions/rules/coding/style.md', '# style');
      write(root, 'docs/instructions/rules/module-map.yml', 'modules: []');
      write(root, 'docs/instructions/stack/overview.md', '# stack');
      write(root, 'docs/instructions/.hidden/skip.md', 'hidden');
      write(root, 'docs/instructions/rules/script.sh', 'echo no');

      const listing = listInstructionsTree(root);
      expect(listing.exists).toBe(true);
      expect(flatten(listing.tree!)).toEqual([
        'rules/coding/style.md',
        'rules/module-map.yml',
        'stack/overview.md',
      ]);
    });
  });

  describe('readInstructionsFile', () => {
    it('returns content, hash, and parsed frontmatter for markdown', () => {
      write(
        root,
        'docs/instructions/rules/style.md',
        '---\ntitle: Style\nseverity: blocker\n---\n# Body here\n',
      );
      const file = readInstructionsFile(root, 'rules/style.md');
      expect(file.exists).toBe(true);
      expect(file.frontmatter).toEqual({ title: 'Style', severity: 'blocker' });
      expect(file.body).toBe('# Body here\n');
      expect(file.hash).toBe(contentHash(file.content!));
    });

    it('returns an empty frontmatter object when none is present', () => {
      write(root, 'docs/instructions/rules/plain.md', '# Plain\n');
      const file = readInstructionsFile(root, 'rules/plain.md');
      expect(file.frontmatter).toEqual({});
      expect(file.body).toBe('# Plain\n');
    });

    it('keeps the raw content as body when frontmatter is malformed', () => {
      const content = '---\n[broken\n---\n# Body\n';
      write(root, 'docs/instructions/rules/broken.md', content);
      const file = readInstructionsFile(root, 'rules/broken.md');
      expect(file.frontmatter).toEqual({});
      expect(file.body).toBe(content);
    });

    it('does not attempt frontmatter parsing for yaml files', () => {
      write(root, 'docs/instructions/rules/module-map.yml', 'modules: []\n');
      const file = readInstructionsFile(root, 'rules/module-map.yml');
      expect(file.frontmatter).toEqual({});
      expect(file.body).toBe('modules: []\n');
    });

    it('reports a missing file', () => {
      const file = readInstructionsFile(root, 'rules/missing.md');
      expect(file.exists).toBe(false);
      expect(file.body).toBeNull();
    });

    it('refuses paths that escape the instructions tree', () => {
      expect(() => readInstructionsFile(root, '../../src/index.md')).toThrow(PathNotAllowedError);
    });
  });
});
