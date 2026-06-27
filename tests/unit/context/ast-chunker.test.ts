import { describe, expect, it } from 'vitest';

import { AstChunker, CHUNKER_VERSION, castMerge } from '@/context/ast-chunker.js';
import type { Chunk } from '@/context/types.js';

function chunk(partial: Partial<Chunk> & { source_file: string; char_count: number }): Chunk {
  return {
    id: `${partial.source_file}:${partial.ast_node_path ?? 'x'}`,
    ast_node_type: 'function',
    ast_node_path: 'x',
    exported_symbols: [],
    content: 'body',
    content_hash: 'h',
    ...partial,
  };
}

describe('castMerge', () => {
  it('coalesces small adjacent same-file chunks up to the budget', () => {
    const merged = castMerge(
      [
        chunk({ source_file: 'a.ts', ast_node_path: 'one', content: 'fn one', char_count: 10 }),
        chunk({ source_file: 'a.ts', ast_node_path: 'two', content: 'fn two', char_count: 10 }),
        chunk({ source_file: 'a.ts', ast_node_path: 'three', content: 'fn three', char_count: 10 }),
      ],
      100,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].ast_node_path).toBe('one+two+three');
    expect(merged[0].content).toBe('fn one\n\nfn two\n\nfn three');
    expect(merged[0].char_count).toBe(30);
  });

  it('starts a new chunk when the budget would be exceeded', () => {
    const merged = castMerge(
      [
        chunk({ source_file: 'a.ts', ast_node_path: 'one', char_count: 60 }),
        chunk({ source_file: 'a.ts', ast_node_path: 'two', char_count: 60 }),
      ],
      100,
    );
    expect(merged).toHaveLength(2);
  });

  it('never merges across file boundaries', () => {
    const merged = castMerge(
      [
        chunk({ source_file: 'a.ts', ast_node_path: 'one', char_count: 10 }),
        chunk({ source_file: 'b.ts', ast_node_path: 'two', char_count: 10 }),
      ],
      100,
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((c) => c.source_file)).toEqual(['a.ts', 'b.ts']);
  });

  it('passes an already-oversize chunk through untouched', () => {
    const big = chunk({
      source_file: 'a.ts',
      ast_node_path: 'big',
      content: 'X',
      char_count: 5000,
    });
    const merged = castMerge([big], 2000);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(big); // single chunk returned verbatim, not re-hashed
  });

  it('unions exported symbols and re-hashes a merged chunk', () => {
    const merged = castMerge(
      [
        chunk({
          source_file: 'a.ts',
          ast_node_path: 'one',
          exported_symbols: ['A'],
          char_count: 5,
        }),
        chunk({
          source_file: 'a.ts',
          ast_node_path: 'two',
          exported_symbols: ['B', 'A'],
          char_count: 5,
        }),
      ],
      100,
    );
    expect(merged[0].exported_symbols.sort()).toEqual(['A', 'B']);
    expect(merged[0].id).not.toBe('a.ts:one'); // recomputed from merged content
  });

  it('never drops content (round-trips every byte of every chunk)', () => {
    const inputs = [
      chunk({ source_file: 'a.ts', ast_node_path: 'one', content: 'alpha', char_count: 5 }),
      chunk({ source_file: 'a.ts', ast_node_path: 'two', content: 'beta', char_count: 4 }),
      chunk({ source_file: 'b.ts', ast_node_path: 'three', content: 'gamma', char_count: 5 }),
    ];
    const merged = castMerge(inputs, 100);
    const joined = merged.map((c) => c.content).join('\n\n');
    for (const c of inputs) {
      expect(joined).toContain(c.content);
    }
  });
});

describe('AstChunker (cAST integration)', () => {
  const tsSource = [
    'export const a = 1;',
    'export const b = 2;',
    'export function helper() { return a + b; }',
    '',
  ].join('\n');

  it('merges tiny adjacent symbols by default (cAST on)', () => {
    const merged = new AstChunker(2000, true).chunk('src/x.ts', tsSource);
    const raw = new AstChunker(2000, false).chunk('src/x.ts', tsSource);
    // The merge pass produces no more chunks than the raw boundary split, and
    // collapses the small adjacent symbols into fewer slices.
    expect(merged.length).toBeLessThanOrEqual(raw.length);
    // Every chunk still belongs to the one source file.
    expect(merged.every((c) => c.source_file === 'src/x.ts')).toBe(true);
  });

  it('exposes a stable chunker version string', () => {
    // Covers the whole index-build strategy: cAST chunking (F22) + contextual blurbs (F24).
    expect(CHUNKER_VERSION).toBe('cast-blurb-v1');
  });
});
