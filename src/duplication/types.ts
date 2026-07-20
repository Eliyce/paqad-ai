// Duplication-detector types (issue #358).

import type { LineRange } from './hunks.js';

/**
 * One near-duplication of existing code introduced by the current change. `kind` follows the
 * similarity band: at/above the threshold it is `deterministic` (blocking-capable in strict
 * mode); in the 0.80–0.90 band it is `heuristic` and routes to review, never blocking (FR-8).
 */
export interface DuplicationFinding {
  /** Project-relative, forward-slash path of the changed file the new code is in. */
  file: string;
  /** 1-based inclusive line span of the new code. */
  line_range: LineRange;
  /** Project-relative path of the existing file the new code near-copies. */
  matched_file: string;
  /** The exported symbol the matched code defines, when the index resolves one. */
  matched_symbol?: string;
  /** 1-based inclusive line span of the matched existing code. */
  matched_line_range: LineRange;
  /** Similarity in [0, 1] (rendered as a percentage in the message). */
  similarity: number;
  /** Distinct call sites of the matched symbol, from the code-knowledge index (0 when unknown). */
  matched_callers: number;
  /** True when jscpd independently flagged the same location (FR-7). */
  corroborated: boolean;
  kind: 'deterministic' | 'heuristic';
  /** The verbatim, developer-facing message (FR-2). */
  message: string;
}

/** Render a line range as `start-end` (or a bare line when the span is one line). */
export function formatRange(range: LineRange): string {
  return range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`;
}

/**
 * Build the verbatim finding message (FR-2). Kept as one function so the rule-script, the
 * gate, and the fixtures all render the identical string.
 */
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
