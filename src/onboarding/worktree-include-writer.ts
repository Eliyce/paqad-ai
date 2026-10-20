import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const WORKTREE_INCLUDE_FILE = '.worktreeinclude';

export const WORKTREE_INCLUDE_LINE = '.paqad/.config';

export function mergeWorktreeInclude(existing: string, line: string): string {
  const present = existing.split(/\r?\n/).some((entry) => entry.trim() === line);
  if (present) {
    return existing;
  }
  const trimmed = existing.replace(/\s+$/, '');
  const prefix = trimmed.length > 0 ? `${trimmed}\n` : '';
  return `${prefix}${line}\n`;
}

export function writeWorktreeInclude(projectRoot: string): void {
  const path = join(projectRoot, WORKTREE_INCLUDE_FILE);
  let existing: string;
  try {
    existing = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      existing = '';
    } else {
      throw error;
    }
  }
  const next = mergeWorktreeInclude(existing, WORKTREE_INCLUDE_LINE);
  if (next !== existing) {
    writeFileSync(path, next);
  }
}
