// Meaningful changed-line counting for the change-shape metrics (issue #362).
//
// The two metrics are ratios over "meaningful changed lines" — the non-blank, non-comment
// lines the change added or modified. The existing `meaningfulLineCount` (src/duplication/
// corpus.ts) only drops blank lines and works over a whole snippet, so this composes the
// existing diff→added-ranges helper (`collectAddedRanges`) instead and adds comment-awareness
// on top: it reads each changed file's working-tree content, keeps only the added/modified
// line numbers, and counts those that are neither blank nor an obvious comment.
//
// The comment heuristic is deliberately simple (a line-prefix test over the common comment
// markers) — the issue asks to keep the definition simple, and undercounting a comment as
// non-meaningful only makes the ratios more conservative, never inflated.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { collectAddedRanges, lineInRanges } from '@/duplication/hunks.js';

/**
 * Line-comment / block-comment markers a meaningful line must not start with. Covers the
 * comment forms across this repo's languages (TS/JS `//` `/*` `*`, shell/YAML/Python `#`,
 * HTML/Markdown `<!--`, SQL `--`). A trailing code+comment line still counts as meaningful,
 * which is intended — the line carries real code.
 */
const COMMENT_PREFIXES = ['//', '/*', '*/', '*', '<!--', '-->', '#', '--'] as const;

/** True when a line carries real content: non-blank and not an obvious full-line comment. */
export function isMeaningfulLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return !COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * Count the meaningful (non-blank, non-comment) added/modified lines across `changedFiles`.
 * Best-effort by contract: a file that cannot be read contributes zero rather than throwing,
 * so a metric run degrades gracefully (INV-1/INV-3). Reads only the changed files' current
 * content plus one `git diff` — no repository-wide scan.
 */
export async function countMeaningfulChangedLines(options: {
  projectRoot: string;
  changedFiles: string[];
}): Promise<number> {
  const { projectRoot, changedFiles } = options;
  const added = await collectAddedRanges({ projectRoot, changedFiles });

  let total = 0;
  for (const entry of added) {
    if (entry.ranges.length === 0) {
      continue;
    }
    let content: string;
    try {
      content = await readFile(join(projectRoot, entry.file), 'utf8');
      /* c8 ignore next 4 -- defensive TOCTOU: collectAddedRanges reported ranges for this
         file, so it existed a moment ago; it can only be unreadable here if it vanished
         between the two reads. Degrade that file to zero rather than throw (INV-1). */
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // `collectAddedRanges` returns 1-based line numbers on the new side.
      if (lineInRanges(i + 1, entry.ranges) && isMeaningfulLine(lines[i]!)) {
        total += 1;
      }
    }
  }
  return total;
}
