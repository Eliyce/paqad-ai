import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  mergeWorktreeInclude,
  WORKTREE_INCLUDE_FILE,
  WORKTREE_INCLUDE_LINE,
  writeWorktreeInclude,
} from '@/onboarding/worktree-include-writer.js';

describe('mergeWorktreeInclude', () => {
  it('adds the line to an empty file', () => {
    expect(mergeWorktreeInclude('', WORKTREE_INCLUDE_LINE)).toBe(`${WORKTREE_INCLUDE_LINE}\n`);
  });

  it('is a no-op when the line is already present', () => {
    const existing = `foo/bar\n${WORKTREE_INCLUDE_LINE}\n`;
    expect(mergeWorktreeInclude(existing, WORKTREE_INCLUDE_LINE)).toBe(existing);
  });

  it('appends the line while keeping existing lines', () => {
    const existing = 'foo/bar\nbaz.txt\n';
    expect(mergeWorktreeInclude(existing, WORKTREE_INCLUDE_LINE)).toBe(
      `foo/bar\nbaz.txt\n${WORKTREE_INCLUDE_LINE}\n`,
    );
  });

  it('matches an existing line even with surrounding whitespace', () => {
    const existing = `  ${WORKTREE_INCLUDE_LINE}  \n`;
    expect(mergeWorktreeInclude(existing, WORKTREE_INCLUDE_LINE)).toBe(existing);
  });
});

describe('writeWorktreeInclude', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-wti-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates the file with the line when absent', () => {
    writeWorktreeInclude(root);
    expect(readFileSync(join(root, WORKTREE_INCLUDE_FILE), 'utf8')).toBe(
      `${WORKTREE_INCLUDE_LINE}\n`,
    );
  });

  it('adds the line once and keeps the user lines', () => {
    const path = join(root, WORKTREE_INCLUDE_FILE);
    writeFileSync(path, 'team/private.env\n');
    writeWorktreeInclude(root);
    expect(readFileSync(path, 'utf8')).toBe(`team/private.env\n${WORKTREE_INCLUDE_LINE}\n`);
  });

  it('is idempotent across repeated runs', () => {
    writeWorktreeInclude(root);
    const once = readFileSync(join(root, WORKTREE_INCLUDE_FILE), 'utf8');
    writeWorktreeInclude(root);
    writeWorktreeInclude(root);
    expect(readFileSync(join(root, WORKTREE_INCLUDE_FILE), 'utf8')).toBe(once);
  });
});
