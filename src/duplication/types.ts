import type { LineRange } from './hunks.js';

export interface DuplicationFinding {
  file: string;
  line_range: LineRange;
  matched_file: string;
  matched_symbol?: string;
  matched_line_range: LineRange;
  similarity: number;
  matched_callers: number;
  corroborated: boolean;
  kind: 'deterministic' | 'heuristic';
  message: string;
}

export function formatRange(range: LineRange): string {
  return range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`;
}

export function duplicationMessage(input: {
  file: string;
  lineRange: LineRange;
  matchedFile: string;
  matchedSymbol?: string;
  matchedLineRange: LineRange;
  similarity: number;
  matchedCallers: number;
}): string {
  const percent = Math.round(input.similarity * 100);
  const matchedName = input.matchedSymbol ?? input.matchedFile;
  return (
    `New code in ${input.file}:${formatRange(input.lineRange)} is ${percent}% similar to ` +
    `existing ${matchedName} (${input.matchedFile}:${formatRange(input.matchedLineRange)}), ` +
    `already used by ${input.matchedCallers} call sites. Prefer reusing or extending it — or ` +
    `record why a new copy is needed.`
  );
}
