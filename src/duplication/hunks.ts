// New-code line ranges from a working-tree diff (issue #358).
//
// "New-code-only" (FR-4, INV-1) is the whole point of the duplication gate: a chunk is a
// finding candidate only when the current change actually introduced or modified its lines.
// `loadChangeEvidence` stops at file paths, and nothing else in src/ parses diff hunks, so
// this module derives the per-file ADDED/MODIFIED line ranges the detector scopes to.
//
// The parser is a pure function over `git diff --unified=0` text so every branch is covered
// by fixtures with no git process; `collectAddedRanges` is the thin impure wrapper that runs
// git and folds in untracked files (whose whole content is new).

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { execa } from 'execa';

/** A 1-based inclusive line span on the NEW (post-change) side of a file. */
export interface LineRange {
  start: number;
  end: number;
}

/** The added/modified line ranges a single file gained in the change. */
export interface FileAddedRanges {
  /** Project-relative, forward-slash path (the new-side path for a rename). */
  file: string;
  ranges: LineRange[];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse `git diff --unified=0` text into the added/modified line ranges per file. Pure and
 * git-free. Only the NEW side is kept (`+c,d`): a hunk that adds `d` lines starting at new
 * line `c` becomes the inclusive range `[c, c + d - 1]`; a pure deletion (`+c,0`) contributes
 * no range. A file that appears with no additions yields an entry with an empty `ranges`.
 */
export function parseUnifiedDiff(diffText: string): FileAddedRanges[] {
  const byFile = new Map<string, LineRange[]>();
  let current: string | null = null;

  for (const rawLine of diffText.split('\n')) {
    // `+++ b/path` names the new-side file. `/dev/null` marks a deletion; ignore it — the
    // preceding `diff --git` still registered nothing, and a deleted file has no new code.
    if (rawLine.startsWith('+++ ')) {
      const target = rawLine.slice(4).trim();
      current = target === '/dev/null' ? null : stripDiffPrefix(target);
      if (current !== null && !byFile.has(current)) {
        byFile.set(current, []);
      }
      continue;
    }

    const hunk = HUNK_HEADER.exec(rawLine);
    if (hunk && current !== null) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count > 0) {
        byFile.get(current)!.push({ start, end: start + count - 1 });
      }
    }
  }

  return [...byFile.entries()].map(([file, ranges]) => ({ file, ranges }));
}

/** Strip the `a/` or `b/` prefix git prepends to diff paths, and normalize separators. */
function stripDiffPrefix(path: string): string {
  const withoutPrefix = path.replace(/^[ab]\//, '');
  return withoutPrefix.replace(/\\/g, '/');
}

/**
 * Collect the added/modified line ranges for `changedFiles` against `HEAD`. Tracked files are
 * diffed with `git diff --unified=0 HEAD`; an untracked file (no diff row) has its whole
 * content treated as new code, since every line is an addition. Best-effort: a git failure or
 * an unreadable file degrades that file to no ranges rather than throwing (NFR-3).
 */
export async function collectAddedRanges(options: {
  projectRoot: string;
  changedFiles: string[];
}): Promise<FileAddedRanges[]> {
  const { projectRoot, changedFiles } = options;
  if (changedFiles.length === 0) {
    return [];
  }

  const parsed = await diffTrackedRanges(projectRoot, changedFiles);
  const seen = new Map(parsed.map((entry) => [entry.file, entry]));

  // Any changed file git did not report a diff for is either untracked or added wholesale.
  // Treat its full current content as new code so a brand-new near-copy file is caught (AC-1).
  for (const file of changedFiles) {
    if (seen.has(file)) {
      continue;
    }
    const wholeFile = await wholeFileRange(projectRoot, file);
    if (wholeFile) {
      seen.set(file, wholeFile);
    }
  }

  return [...seen.values()];
}

/** Run `git diff --unified=0 HEAD` for the given files and parse it. Empty on any git error. */
async function diffTrackedRanges(
  projectRoot: string,
  changedFiles: string[],
): Promise<FileAddedRanges[]> {
  try {
    const result = await execa(
      'git',
      ['diff', '--unified=0', '--no-color', 'HEAD', '--', ...changedFiles],
      { cwd: projectRoot, reject: false },
    );
    if (result.exitCode !== 0 || result.stdout.trim() === '') {
      return [];
    }
    return parseUnifiedDiff(result.stdout);
  } catch {
    return [];
  }
}

/** The whole-file range `[1, lineCount]` for an untracked/new file, or null when empty/unreadable. */
async function wholeFileRange(projectRoot: string, file: string): Promise<FileAddedRanges | null> {
  const abs = join(projectRoot, file);
  if (!existsSync(abs)) {
    return null;
  }
  try {
    const content = await readFile(abs, 'utf8');
    const lineCount = content.split('\n').length;
    if (content.trim() === '') {
      return { file, ranges: [] };
    }
    return { file, ranges: [{ start: 1, end: lineCount }] };
  } catch {
    return null;
  }
}

/** True when line `line` falls inside any of the ranges. */
export function lineInRanges(line: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end);
}

/** True when `[start, end]` overlaps any of the ranges (shares at least one line). */
export function rangesOverlap(start: number, end: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => start <= range.end && end >= range.start);
}
