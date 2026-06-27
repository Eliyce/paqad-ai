/**
 * Distilling retrieval sub-step → compact context pack (RAG buildout F26).
 *
 * A long workflow that pulls many retrieved slices bloats the context with chunk bodies
 * the model may not need verbatim. The SWE-grep pattern instead returns POINTERS — a
 * compact pack of `path:Lstart-Lend` locations with a one-line hint — so the main context
 * stays lean and the model reads the live file at the pointer only when it actually needs
 * the body. This is the "explore broadly, return pointers not dumps" distillation.
 *
 * Everything here is deterministic and bounded: the pack is built from the already-
 * retrieved {@link RetrievalSlice}s (F11/F12/F14 did the retrieval, scoping, and floor),
 * deduped per file+location, capped at {@link MAX_CONTEXT_PACK_ENTRIES}. Line ranges are
 * located against the live file via an injected reader when available; with no reader (or
 * a miss) the pointer degrades to the file path plus hint — never a throw.
 */
import type { RetrievalSlice } from './retrieval-context.js';

/** A single pointer in the context pack: where to look, and why. */
export interface ContextPackEntry {
  source_file: string;
  /** 1-based inclusive line range when locatable against the live file. */
  start_line?: number;
  end_line?: number;
  /** Calibrated match score, when known. */
  score?: number;
  /** One-line hint (the first meaningful line of the slice) so the model can triage. */
  hint: string;
}

/** Reads a file's text for line-range location; returns undefined when unreadable. */
export type FileReader = (path: string) => string | undefined;

/** Hard cap on pointers in a pack (token guard for long workflows). */
export const MAX_CONTEXT_PACK_ENTRIES = 12;

/** Max characters of the one-line hint. */
const MAX_HINT_CHARS = 100;

/** First non-blank, trimmed line of a slice, capped — a triage hint, not the body. */
function firstMeaningfulLine(content: string): string {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed.length > MAX_HINT_CHARS ? `${trimmed.slice(0, MAX_HINT_CHARS)}…` : trimmed;
    }
  }
  return '';
}

/**
 * Locate the 1-based inclusive line range of `chunkContent` within `fileContent`.
 * Anchors on the chunk's first meaningful line (exact line match), then spans as many of
 * the chunk's lines as match consecutively. Returns undefined when the anchor is not
 * found (the file changed since indexing, or the chunk was contextualised). Pure.
 */
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
    // Found the anchor; extend while subsequent chunk lines keep matching the file.
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
  /** Reader used to locate line ranges; omit to produce path+hint pointers only. */
  readFile?: FileReader;
  /** Max pointers. Defaults to {@link MAX_CONTEXT_PACK_ENTRIES}. */
  maxEntries?: number;
}

/**
 * Distill retrieved slices into a compact context pack of pointers. Preserves the input
 * order (already ranked upstream), dedupes by file+line-range (or file+hint when no range),
 * caps the result, and locates line ranges via the reader when supplied. Never throws.
 */
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

/** Format a single pointer: `path:Lstart-Lend · match NN% — hint`. */
function formatPointer(entry: ContextPackEntry): string {
  const range =
    entry.start_line !== undefined && entry.end_line !== undefined
      ? `:L${entry.start_line}-${entry.end_line}`
      : '';
  const match = typeof entry.score === 'number' ? ` · match ${Math.round(entry.score * 100)}%` : '';
  const hint = entry.hint ? ` — ${entry.hint}` : '';
  return `- \`${entry.source_file}${range}\`${match}${hint}`;
}

/**
 * Compose the context-pack section: a lean list of pointers instead of slice bodies.
 * Returns `''` for an empty pack so the caller can append it unconditionally. Framed as
 * "where to look" — the model opens the live file at the pointer when it needs the body.
 */
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
