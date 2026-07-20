// The comparison corpus for the duplication detector (issue #358).
//
// A corpus chunk is an AST-scoped span of existing code the change's new chunks are compared
// against. It carries the chunk's raw `content` (from the token-efficiency chunk index, or the
// embedding index when only that exists) so the detector can score it with token-shingle
// similarity — the deterministic, zero-model-token backend that works whether or not an
// embedding index is present (FR-6 / AC-6). Chunks carry no line numbers, so the resolver
// locates a chunk's `content` inside its source file to derive a range for the finding.
//
// New-code-only (FR-4/FR-5): every chunk whose source file is in the change is excluded, which
// removes both the candidate-vs-itself comparison and the moved-function original (AC-3).

import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, join } from 'node:path';

import { ChunkIndexManager } from '@/context/chunk-index.js';
import type { Chunk } from '@/context/types.js';
import { PATHS } from '@/core/constants/paths.js';
import { FileVectorIndex } from '@/rag/vector-index.js';
import type { StoredVectorChunk } from '@/rag/types.js';

import type { LineRange } from './hunks.js';

/** One existing-code span to compare new code against. */
export interface CorpusChunk {
  /** Content-hash-scoped chunk id from the source index. */
  id: string;
  /** Project-relative, forward-slash path of the source file. */
  file: string;
  content: string;
  /** Non-whitespace char count carried from the chunk index. */
  charCount: number;
  /** Exported symbol names the chunk defines, for matched-symbol enrichment. */
  exportedSymbols: string[];
}

/**
 * Load the comparison corpus, excluding every chunk that lives in a changed file. Prefers the
 * token-efficiency chunk index for content and falls back to the embedding index's stored
 * chunks when only that exists. Returns an empty array (never throws) when neither index is
 * present, so the detector degrades to zero findings rather than an error (NFR-3).
 */
export async function loadCorpus(options: {
  projectRoot: string;
  changedFiles: string[];
}): Promise<CorpusChunk[]> {
  const { projectRoot } = options;
  const excluded = new Set(options.changedFiles.map(normalizeRel));

  const chunkIndex = await new ChunkIndexManager(projectRoot).load();
  if (chunkIndex) {
    const chunks: CorpusChunk[] = [];
    for (const entry of chunkIndex.entries) {
      for (const chunk of entry.chunks) {
        const file = toRelative(projectRoot, chunk.source_file);
        if (!excluded.has(file)) {
          chunks.push(corpusChunk(chunk, file));
        }
      }
    }
    return chunks;
  }

  // No chunk index: fall back to the embedding index alone — its items carry the same Chunk
  // fields (AC-6 keeps working when only one index exists).
  const stored = await loadStoredChunks(projectRoot);
  return stored
    .map((chunk) => ({ chunk, file: toRelative(projectRoot, chunk.source_file) }))
    .filter(({ file }) => !excluded.has(file))
    .map(({ chunk, file }) => corpusChunk(chunk, file));
}

/** Load the embedding index's stored chunks for content, or empty when absent/unreadable. */
async function loadStoredChunks(projectRoot: string): Promise<StoredVectorChunk[]> {
  try {
    const index = new FileVectorIndex<StoredVectorChunk>(PATHS.VECTOR_INDEX, PATHS.VECTOR_META);
    const payload = await index.load(projectRoot);
    return payload?.items ?? [];
  } catch {
    return [];
  }
}

function corpusChunk(chunk: Chunk, file: string): CorpusChunk {
  return {
    id: chunk.id,
    file,
    content: chunk.content,
    charCount: chunk.char_count,
    exportedSymbols: chunk.exported_symbols,
  };
}

/** Normalize a project-relative path to forward slashes for set membership. */
function normalizeRel(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Reduce a chunk `source_file` (often absolute) to a project-relative, forward-slash path. */
export function toRelative(projectRoot: string, sourceFile: string): string {
  const normalized = sourceFile.replace(/\\/g, '/');
  if (!isAbsolute(sourceFile)) {
    return normalized;
  }
  return relative(projectRoot, sourceFile).replace(/\\/g, '/');
}

/**
 * Resolve the 1-based inclusive line range of `content` within `fileText`, or null when the
 * content is not found verbatim (the working tree moved since the index was built, or the
 * chunk spans re-indented lines). A null result is treated by the detector as "cannot locate",
 * never a wrong range (NFR-3).
 */
export function resolveChunkLineRange(fileText: string, content: string): LineRange | null {
  if (content.length === 0) {
    return null;
  }
  const index = fileText.indexOf(content);
  if (index === -1) {
    return null;
  }
  const start = countNewlines(fileText.slice(0, index)) + 1;
  const spanned = content.split('\n').length;
  return { start, end: start + spanned - 1 };
}

/** The meaningful (non-blank) line count of a snippet — the span the min-lines floor measures. */
export function meaningfulLineCount(content: string): number {
  return content.split('\n').filter((line) => line.trim().length > 0).length;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      count += 1;
    }
  }
  return count;
}

/** Read a source file's text, or null when it cannot be read. */
export async function readFileText(projectRoot: string, file: string): Promise<string | null> {
  try {
    return await readFile(join(projectRoot, file), 'utf8');
  } catch {
    return null;
  }
}
