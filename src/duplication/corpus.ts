import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, join } from 'node:path';

import { ChunkIndexManager } from '@/context/chunk-index.js';
import type { Chunk } from '@/context/types.js';
import { PATHS } from '@/core/constants/paths.js';
import { FileVectorIndex } from '@/rag/vector-index.js';
import type { StoredVectorChunk } from '@/rag/types.js';

import type { LineRange } from './hunks.js';

export interface CorpusChunk {
  id: string;
  file: string;
  content: string;
  charCount: number;
  exportedSymbols: string[];
}

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

  const stored = await loadStoredChunks(projectRoot);
  return stored
    .map((chunk) => ({ chunk, file: toRelative(projectRoot, chunk.source_file) }))
    .filter(({ file }) => !excluded.has(file))
    .map(({ chunk, file }) => corpusChunk(chunk, file));
}

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

function normalizeRel(path: string): string {
  return path.replace(/\\/g, '/');
}

export function toRelative(projectRoot: string, sourceFile: string): string {
  const normalized = sourceFile.replace(/\\/g, '/');
  if (!isAbsolute(sourceFile)) {
    return normalized;
  }
  return relative(projectRoot, sourceFile).replace(/\\/g, '/');
}

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

export async function readFileText(projectRoot: string, file: string): Promise<string | null> {
  try {
    return await readFile(join(projectRoot, file), 'utf8');
  } catch {
    return null;
  }
}
