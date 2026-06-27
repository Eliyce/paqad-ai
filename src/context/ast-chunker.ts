import { createHash } from 'node:crypto';
import type { Chunk } from './types.js';

/**
 * Identifies the chunking STRATEGY an index was built with (RAG buildout F22). It is
 * stamped into `RagIndexMeta.chunker_version` on every (re)build and compared on every
 * status check: an index built by a different chunker is treated as invalid, so it is
 * never incrementally synced (which would mix old and new chunk boundaries — corrupt)
 * and is fully rebuilt instead. Bump this whenever the chunking behaviour changes
 * (e.g. swapping the boundary detector for a tree-sitter parser).
 *
 * `cast-v1` = regex boundary detection + the cAST split-then-merge pass below.
 */
export const CHUNKER_VERSION = 'cast-v1';

export class AstChunker {
  /**
   * @param maxChunkChars per-chunk non-whitespace budget; also the cAST merge target.
   * @param merge when true (default) the cAST split-then-merge pass coalesces small
   *   adjacent same-file chunks up to the budget (RAG buildout F22). Disable for the
   *   raw boundary-only chunks (used by tests / the legacy `regex` strategy).
   */
  constructor(
    private readonly maxChunkChars = 2000,
    private readonly merge = true,
  ) {}

  /**
   * Chunk a file into AST-node-level slices, then (when enabled) apply the cAST
   * split-then-merge refinement so tiny adjacent symbols ride together up to the
   * budget instead of becoming one-line fragments. The boundary detection is the
   * "split"; {@link castMerge} is the "merge".
   */
  chunk(filePath: string, content: string): Chunk[] {
    const raw = this.chunkRaw(filePath, content);
    return this.merge ? castMerge(raw, this.maxChunkChars) : raw;
  }

  /** Boundary-only chunking (the "split" half of cAST), per detected language. */
  private chunkRaw(filePath: string, content: string): Chunk[] {
    const lang = this.detectLanguage(filePath);
    try {
      switch (lang) {
        case 'typescript':
          return this.parseTypeScript(filePath, content);
        case 'php':
          return this.parsePhp(filePath, content);
        case 'dart':
          return this.parseDart(filePath, content);
        default:
          return this.fallbackSplit(filePath, content);
      }
    } catch {
      return this.fallbackSplit(filePath, content);
    }
  }

  private detectLanguage(filePath: string): 'typescript' | 'php' | 'dart' | 'unknown' {
    if (
      filePath.endsWith('.ts') ||
      filePath.endsWith('.tsx') ||
      filePath.endsWith('.js') ||
      filePath.endsWith('.jsx')
    ) {
      return 'typescript';
    }
    if (filePath.endsWith('.php')) return 'php';
    if (filePath.endsWith('.dart')) return 'dart';
    return 'unknown';
  }

  private parseTypeScript(filePath: string, content: string): Chunk[] {
    const chunks: Chunk[] = [];
    // Match top-level functions, classes, arrow functions exported
    const blockPattern =
      /^(export\s+)?((?:async\s+)?function[\s*]+\w+|class\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?\(|export\s+(?:default\s+)?(?:async\s+)?function|export\s+class\s+\w+)/gm;

    const boundaries: number[] = [];
    let match;
    while ((match = blockPattern.exec(content)) !== null) {
      boundaries.push(match.index);
    }
    boundaries.push(content.length);

    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      const segment = content.slice(start, end);

      if (segment.trim().length === 0) continue;

      const nonWhitespaceCount = segment.replace(/\s/g, '').length;
      if (nonWhitespaceCount > this.maxChunkChars) {
        // Split further at method/function boundaries within the segment
        const subChunks = this.splitLargeSegment(filePath, segment);
        chunks.push(...subChunks);
      } else {
        const nameMatch = /(?:function|class|const)\s+(\w+)/.exec(segment);
        chunks.push(this.makeChunk(filePath, segment, 'function', nameMatch?.[1] ?? `block_${i}`));
      }
    }

    // If no boundaries found, fall back
    if (chunks.length === 0) return this.fallbackSplit(filePath, content);
    return chunks;
  }

  private parsePhp(filePath: string, content: string): Chunk[] {
    const chunks: Chunk[] = [];
    // Whitespace is kept unambiguous (no two adjacent `\s*`) to avoid polynomial
    // backtracking (ReDoS) on lines with long runs of spaces — an optional modifier
    // is matched together with its trailing whitespace as a single unit.
    const pattern =
      /^\s*(?:(?:public|protected|private|static|abstract|final)\s+)?(?:function|class|interface|trait)\s+\w+/gm;

    const boundaries: number[] = [];
    let match;
    while ((match = pattern.exec(content)) !== null) {
      boundaries.push(match.index);
    }
    boundaries.push(content.length);

    for (let i = 0; i < boundaries.length - 1; i++) {
      const segment = content.slice(boundaries[i], boundaries[i + 1]);
      if (segment.trim().length === 0) continue;
      const nameMatch = /(?:function|class|interface|trait)\s+(\w+)/.exec(segment);
      chunks.push(this.makeChunk(filePath, segment, 'function', nameMatch?.[1] ?? `block_${i}`));
    }

    if (chunks.length === 0) return this.fallbackSplit(filePath, content);
    return chunks;
  }

  private parseDart(filePath: string, content: string): Chunk[] {
    const chunks: Chunk[] = [];
    const pattern = /^(\s*(?:abstract\s+)?class\s+\w+|^\s*\w[\w<>?]*\s+\w+\s*\()/gm;

    const boundaries: number[] = [];
    let match;
    while ((match = pattern.exec(content)) !== null) {
      boundaries.push(match.index);
    }
    boundaries.push(content.length);

    for (let i = 0; i < boundaries.length - 1; i++) {
      const segment = content.slice(boundaries[i], boundaries[i + 1]);
      if (segment.trim().length === 0) continue;
      const nameMatch = /(?:class|\w+)\s+(\w+)/.exec(segment);
      chunks.push(this.makeChunk(filePath, segment, 'class', nameMatch?.[1] ?? `block_${i}`));
    }

    if (chunks.length === 0) return this.fallbackSplit(filePath, content);
    return chunks;
  }

  private splitLargeSegment(filePath: string, segment: string): Chunk[] {
    // Split at method boundaries within a class
    const methodPattern =
      /(?:async\s+)?(?:public|private|protected|static)?\s*(?:async\s+)?\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/g;
    const boundaries: number[] = [0];
    let match;
    while ((match = methodPattern.exec(segment)) !== null) {
      if (match.index > 0) boundaries.push(match.index);
    }
    boundaries.push(segment.length);

    const chunks: Chunk[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const sub = segment.slice(boundaries[i], boundaries[i + 1]);
      if (sub.trim().length > 0) {
        chunks.push(this.makeChunk(filePath, sub, 'method', `method_${i}`));
      }
    }
    return chunks.length > 0 ? chunks : this.fallbackSplit(filePath, segment);
  }

  fallbackSplit(filePath: string, content: string): Chunk[] {
    // Split at blank lines
    const paragraphs = content.split(/\n\s*\n/);
    const chunks: Chunk[] = [];
    let buffer = '';

    for (const para of paragraphs) {
      const combined = buffer ? buffer + '\n\n' + para : para;
      const nonWS = combined.replace(/\s/g, '').length;
      if (nonWS > this.maxChunkChars && buffer) {
        chunks.push(this.makeChunk(filePath, buffer, 'fallback', `para_${chunks.length}`));
        buffer = para;
      } else {
        buffer = combined;
      }
    }
    if (buffer.trim()) {
      chunks.push(this.makeChunk(filePath, buffer, 'fallback', `para_${chunks.length}`));
    }

    return chunks.length > 0 ? chunks : [this.makeChunk(filePath, content, 'fallback', 'full')];
  }

  private makeChunk(
    filePath: string,
    content: string,
    nodeType: Chunk['ast_node_type'],
    name: string,
  ): Chunk {
    const nonWS = content.replace(/\s/g, '');
    return {
      id: createHash('sha256').update(`${filePath}:${name}:${content}`).digest('hex'),
      source_file: filePath,
      ast_node_type: nodeType,
      ast_node_path: name,
      exported_symbols: this.extractExportedSymbols(content),
      content: content.trim(),
      char_count: nonWS.length,
      content_hash: createHash('sha256').update(content).digest('hex'),
    };
  }

  private extractExportedSymbols(content: string): string[] {
    const symbols: string[] = [];
    const pattern = /export\s+(?:default\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      symbols.push(match[1]);
    }
    return symbols;
  }
}

/**
 * The cAST "merge" pass (RAG buildout F22). Boundary detection produces one chunk per
 * symbol, which leaves many tiny one-line chunks (a re-export, a small constant, a
 * two-line helper). cAST coalesces a run of ADJACENT chunks FROM THE SAME FILE into one
 * chunk as long as the combined non-whitespace size stays within `targetChars`, so the
 * model receives a coherent slice rather than a fragment, and the index holds fewer,
 * better-filled chunks.
 *
 * Safe-by-construction: it only ever joins chunks that were already adjacent within one
 * file, never crosses a file boundary, never drops or reorders content, and passes an
 * already-oversize chunk through untouched (the boundary splitter already shrank it as
 * far as it could). A single chunk is returned verbatim — no needless re-hash.
 */
export function castMerge(chunks: readonly Chunk[], targetChars: number): Chunk[] {
  const result: Chunk[] = [];
  let buffer: Chunk[] = [];
  let bufferChars = 0;

  const flush = (): void => {
    if (buffer.length === 0) {
      return;
    }
    result.push(buffer.length === 1 ? buffer[0] : mergeChunks(buffer));
    buffer = [];
    bufferChars = 0;
  };

  for (const chunk of chunks) {
    const breaksRun =
      buffer.length > 0 &&
      (chunk.source_file !== buffer[0].source_file || bufferChars + chunk.char_count > targetChars);
    if (breaksRun) {
      flush();
    }
    buffer.push(chunk);
    bufferChars += chunk.char_count;
  }
  flush();
  return result;
}

/** Combine an adjacent same-file run of chunks into a single re-hashed chunk. */
function mergeChunks(chunks: Chunk[]): Chunk {
  const source_file = chunks[0].source_file;
  const content = chunks.map((c) => c.content).join('\n\n');
  const ast_node_path = chunks.map((c) => c.ast_node_path).join('+');
  const exported_symbols = [...new Set(chunks.flatMap((c) => c.exported_symbols))];
  const char_count = chunks.reduce((sum, c) => sum + c.char_count, 0);
  const modified_at_ms = chunks.reduce<number | undefined>(
    (max, c) => (c.modified_at_ms === undefined ? max : Math.max(max ?? 0, c.modified_at_ms)),
    undefined,
  );
  return {
    id: createHash('sha256').update(`${source_file}:${ast_node_path}:${content}`).digest('hex'),
    source_file,
    // The merged slice is rooted at its first node's kind; a precise "merged" tag would
    // mean widening the closed Chunk union, which is not worth it for an advisory field.
    ast_node_type: chunks[0].ast_node_type,
    ast_node_path,
    exported_symbols,
    content,
    char_count,
    content_hash: createHash('sha256').update(content).digest('hex'),
    ...(modified_at_ms === undefined ? {} : { modified_at_ms }),
  };
}
