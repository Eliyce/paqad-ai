import type { RetrievalSlice } from './retrieval-context.js';

export interface ContextPackEntry {
  source_file: string;
  start_line?: number;
  end_line?: number;
  score?: number;
  hint: string;
}

export type FileReader = (path: string) => string | undefined;

export const MAX_CONTEXT_PACK_ENTRIES = 12;

const MAX_HINT_CHARS = 100;

function firstMeaningfulLine(content: string): string {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed.length > MAX_HINT_CHARS ? `${trimmed.slice(0, MAX_HINT_CHARS)}…` : trimmed;
    }
  }
  return '';
}

export function locateLineRange(
  fileContent: string,
  chunkContent: string,
): { start: number; end: number } | undefined {
  const fileLines = fileContent.split('\n');
  const chunkLines = chunkContent.split('\n').map((line) => line.trimEnd());
  const anchorIndex = chunkLines.findIndex((line) => line.trim().length > 0);
  if (anchorIndex === -1) {
    return undefined;
  }
  const anchor = chunkLines[anchorIndex].trim();
  for (let i = 0; i < fileLines.length; i++) {
    if (fileLines[i].trim() !== anchor) {
      continue;
    }
    const start = i - anchorIndex;
    if (start < 0) {
      continue;
    }
    let matched = 0;
    for (let j = 0; j < chunkLines.length; j++) {
      const fileLine = fileLines[start + j];
      if (fileLine === undefined) {
        break;
      }
      if (fileLine.trimEnd() === chunkLines[j]) {
        matched = j + 1;
      }
    }
    if (matched >= 1) {
      return { start: start + 1, end: start + matched };
    }
  }
  return undefined;
}

export interface DistillOptions {
  readFile?: FileReader;
  maxEntries?: number;
}

export function distillSlices(
  slices: readonly RetrievalSlice[],
  options: DistillOptions = {},
): ContextPackEntry[] {
  const maxEntries = options.maxEntries ?? MAX_CONTEXT_PACK_ENTRIES;
  const seen = new Set<string>();
  const pack: ContextPackEntry[] = [];
  for (const slice of slices) {
    if (pack.length >= maxEntries) {
      break;
    }
    let range: { start: number; end: number } | undefined;
    if (options.readFile) {
      let fileText: string | undefined;
      try {
        fileText = options.readFile(slice.source_file);
      } catch {
        fileText = undefined;
      }
      if (fileText) {
        range = locateLineRange(fileText, slice.content);
      }
    }
    const hint = firstMeaningfulLine(slice.content);
    const key = range
      ? `${slice.source_file}:${range.start}-${range.end}`
      : `${slice.source_file}:${hint}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    pack.push({
      source_file: slice.source_file,
      start_line: range?.start,
      end_line: range?.end,
      score: slice.score,
      hint,
    });
  }
  return pack;
}

function formatPointer(entry: ContextPackEntry): string {
  const range =
    entry.start_line !== undefined && entry.end_line !== undefined
      ? `:L${entry.start_line}-${entry.end_line}`
      : '';
  const match = typeof entry.score === 'number' ? ` · match ${Math.round(entry.score * 100)}%` : '';
  const hint = entry.hint ? ` — ${entry.hint}` : '';
  return `- \`${entry.source_file}${range}\`${match}${hint}`;
}

export function composeContextPack(entries: readonly ContextPackEntry[]): string {
  if (entries.length === 0) {
    return '';
  }
  const noun = entries.length === 1 ? 'pointer' : 'pointers';
  const lines = entries.map(formatPointer).join('\n');
  return (
    `## Retrieved context — ${entries.length} ${noun} (read the live file at each)\n` +
    `> Where to look, not the code itself. Open the file at the pointer when you need the body; the match % is the index's confidence, not correctness.\n\n` +
    `${lines}\n`
  );
}
