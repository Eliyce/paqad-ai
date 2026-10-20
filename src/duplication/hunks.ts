import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { execa } from 'execa';

export interface LineRange {
  start: number;
  end: number;
}

export interface FileAddedRanges {
  file: string;
  ranges: LineRange[];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(diffText: string): FileAddedRanges[] {
  const byFile = new Map<string, LineRange[]>();
  let current: string | null = null;

  for (const rawLine of diffText.split('\n')) {
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

function stripDiffPrefix(path: string): string {
  const withoutPrefix = path.replace(/^[ab]\//, '');
  return withoutPrefix.replace(/\\/g, '/');
}

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

export function lineInRanges(line: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end);
}

export function rangesOverlap(start: number, end: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => start <= range.end && end >= range.start);
}
