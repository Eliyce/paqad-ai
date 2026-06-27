import { describe, expect, it } from 'vitest';

import {
  MAX_CONTEXT_PACK_ENTRIES,
  composeContextPack,
  distillSlices,
  locateLineRange,
} from '@/context/context-pack.js';
import type { RetrievalSlice } from '@/context/retrieval-context.js';

function slice(partial: Partial<RetrievalSlice> & { source_file: string }): RetrievalSlice {
  return { content: 'export function f() {}', score: 0.9, ...partial };
}

const FILE = ['line one', 'export function f() {', '  return 1;', '}', 'line five'].join('\n');

describe('locateLineRange', () => {
  it('locates the 1-based inclusive line range of a chunk in a file', () => {
    expect(locateLineRange(FILE, 'export function f() {\n  return 1;\n}')).toEqual({
      start: 2,
      end: 4,
    });
  });

  it('returns undefined when the anchor line is not present', () => {
    expect(locateLineRange(FILE, 'const nope = 1;')).toBeUndefined();
  });

  it('returns undefined for blank chunk content', () => {
    expect(locateLineRange(FILE, '   \n  ')).toBeUndefined();
  });
});

describe('distillSlices', () => {
  it('produces path+hint pointers with no reader (no line range)', () => {
    const pack = distillSlices([
      slice({ source_file: 'src/a.ts', content: 'export const a = 1;' }),
    ]);
    expect(pack).toHaveLength(1);
    expect(pack[0]).toMatchObject({ source_file: 'src/a.ts', hint: 'export const a = 1;' });
    expect(pack[0].start_line).toBeUndefined();
  });

  it('locates line ranges when a reader is supplied', () => {
    const pack = distillSlices(
      [slice({ source_file: 'src/f.ts', content: 'export function f() {\n  return 1;\n}' })],
      { readFile: () => FILE },
    );
    expect(pack[0]).toMatchObject({ source_file: 'src/f.ts', start_line: 2, end_line: 4 });
  });

  it('dedupes pointers to the same file+range', () => {
    const s = slice({ source_file: 'src/f.ts', content: 'export function f() {\n  return 1;\n}' });
    const pack = distillSlices([s, s], { readFile: () => FILE });
    expect(pack).toHaveLength(1);
  });

  it('caps the pack at maxEntries', () => {
    const many = Array.from({ length: MAX_CONTEXT_PACK_ENTRIES + 5 }, (_, i) =>
      slice({ source_file: `src/f${i}.ts`, content: `export const v${i} = ${i};` }),
    );
    expect(distillSlices(many)).toHaveLength(MAX_CONTEXT_PACK_ENTRIES);
    expect(distillSlices(many, { maxEntries: 3 })).toHaveLength(3);
  });

  it('never throws when the reader throws', () => {
    const pack = distillSlices([slice({ source_file: 'src/a.ts' })], {
      readFile: () => {
        throw new Error('boom');
      },
    });
    expect(pack).toHaveLength(1);
    expect(pack[0].start_line).toBeUndefined();
  });
});

describe('composeContextPack', () => {
  it('returns empty string for an empty pack', () => {
    expect(composeContextPack([])).toBe('');
  });

  it('renders pointers (not bodies) with line ranges, match %, and a read-the-file frame', () => {
    const section = composeContextPack([
      {
        source_file: 'src/f.ts',
        start_line: 2,
        end_line: 4,
        score: 0.91,
        hint: 'export function f() {',
      },
    ]);
    expect(section).toContain('Retrieved context');
    expect(section).toContain('read the live file');
    expect(section).toContain('`src/f.ts:L2-4`');
    expect(section).toContain('match 91%');
    expect(section).toContain('export function f() {');
    // It is a pointer list, not a fenced code dump.
    expect(section).not.toContain('```');
  });

  it('omits the range when not located', () => {
    const section = composeContextPack([{ source_file: 'src/a.ts', hint: 'export const a = 1;' }]);
    expect(section).toContain('`src/a.ts`');
    expect(section).not.toContain(':L');
  });
});
