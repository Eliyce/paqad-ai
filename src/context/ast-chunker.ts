import { createHash } from 'node:crypto';
import type { Chunk } from './types.js';

export class AstChunker {
  constructor(private readonly maxChunkChars = 2000) {}

  chunk(filePath: string, content: string): Chunk[] {
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
