import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { collectAddedRanges, lineInRanges } from '@/duplication/hunks.js';

const COMMENT_PREFIXES = ['//', '/*', '*/', '*', '<!--', '-->', '#', '--'] as const;

export function isMeaningfulLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return !COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

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
      /* c8 ignore start -- defensive TOCTOU: collectAddedRanges reported ranges for this
         file, so it existed a moment ago; it can only be unreadable here if it vanished
         between the two reads. Degrade that file to zero rather than throw (INV-1). */
    } catch {
      continue;
      /* c8 ignore stop */
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lineInRanges(i + 1, entry.ranges) && isMeaningfulLine(lines[i]!)) {
        total += 1;
      }
    }
  }
  return total;
}
