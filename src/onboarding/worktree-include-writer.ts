import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Issue #615 (Part 1) — a worktree session created from the Desktop app does not carry
// the dev-local `.paqad/.config` into the new worktree, so a developer who disabled paqad
// (or set a local knob) in the main checkout loses it the moment they branch into a
// worktree. Git copies a path listed in a repo-root `.worktreeinclude` into every new
// worktree, so onboarding and `paqad-ai join` ensure `.paqad/.config` is listed there.
//
// `.worktreeinclude` is a PROJECT-owned file (it may already list the team's own paths),
// so this is a plain idempotent append — add our line only when it is missing, and keep
// every other line byte-for-byte. It is never a paqad-managed, marker-fenced block.

/** The repo-root file git reads to copy extra paths into a new worktree. */
export const WORKTREE_INCLUDE_FILE = '.worktreeinclude';

/** The dev-local config path that must follow into a new worktree. */
export const WORKTREE_INCLUDE_LINE = '.paqad/.config';

/**
 * Merge `line` into a `.worktreeinclude` body: return it unchanged when the line is
 * already present (compared trimmed, line by line), otherwise append it on its own line
 * with exactly one trailing newline. Pure and side-effect-free so it is unit-testable.
 */
export function mergeWorktreeInclude(existing: string, line: string): string {
  const present = existing.split(/\r?\n/).some((entry) => entry.trim() === line);
  if (present) {
    return existing;
  }
  const trimmed = existing.replace(/\s+$/, '');
  const prefix = trimmed.length > 0 ? `${trimmed}\n` : '';
  return `${prefix}${line}\n`;
}

/**
 * Create or merge the repo-root `.worktreeinclude` so `.paqad/.config` follows into new
 * worktrees (issue #615, Part 1). Idempotent: a file that already lists the line is left
 * byte-identical, and any other lines the user added are preserved. Reads with a single
 * read + ENOENT catch (never existsSync-then-read, which is the CWE-367 TOCTOU race).
 */
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
