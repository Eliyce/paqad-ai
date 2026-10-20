import { createHash } from 'node:crypto';
import type { Chunk } from './types.js';

export const CHUNKER_VERSION = 'cast-blurb-v1';

export class AstChunker {
  constructor(
    private readonly maxChunkChars = 2000,
    private readonly merge = true,
  ) {}

  chunk(filePath: string, content: string): Chunk[] {
    const raw = this.chunkRaw(filePath, content);
    return this.merge ? castMerge(raw, this.maxChunkChars) : raw;
  }

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
        const subChunks = this.splitLargeSegment(filePath, segment);
        chunks.push(...subChunks);
      } else {
        const nameMatch = /(?:function|class|const)\s+(\w+)/.exec(segment);
        chunks.push(this.makeChunk(filePath, segment, 'function', nameMatch?.[1] ?? `block_${i}`));
      }
    }

    if (chunks.length === 0) return this.fallbackSplit(filePath, content);
    return chunks;
  }

  private parsePhp(filePath: string, content: string): Chunk[] {
    const chunks: Chunk[] = [];
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
    ast_node_type: chunks[0].ast_node_type,
    ast_node_path,
    exported_symbols,
    content,
    char_count,
    content_hash: createHash('sha256').update(content).digest('hex'),
    ...(modified_at_ms === undefined ? {} : { modified_at_ms }),
  };
}
