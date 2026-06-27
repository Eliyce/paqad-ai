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

  it('skips a match whose computed start would be before the file start', () => {
    // The anchor's first meaningful line is preceded by blank lines (anchorIndex > 0),
    // but the only file match is on line 0 → start < 0 → skipped → undefined.
    expect(locateLineRange('foo\nbar', '\n\nfoo')).toBeUndefined();
  });

  it('stops extending when the chunk runs past the end of the file', () => {
    // Anchor matches the last file line; the chunk has more lines than remain.
    expect(locateLineRange('x\nfoo', 'foo\nbar\nbaz')).toEqual({ start: 2, end: 2 });
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

  it('yields an empty hint for a blank-only slice', () => {
    const pack = distillSlices([slice({ source_file: 'src/blank.ts', content: '   \n\t\n  ' })]);
    expect(pack).toHaveLength(1);
    expect(pack[0].hint).toBe('');
  });

  it('truncates a very long first line in the hint', () => {
    const longLine = `const x = '${'y'.repeat(200)}';`;
    const pack = distillSlices([slice({ source_file: 'src/long.ts', content: longLine })]);
    expect(pack[0].hint.endsWith('…')).toBe(true);
    expect(pack[0].hint.length).toBeLessThan(longLine.length);
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

  it('uses the plural noun and omits the hint dash for a hint-less entry', () => {
    const section = composeContextPack([
      { source_file: 'src/a.ts', hint: 'first' },
      { source_file: 'src/b.ts', hint: '' },
    ]);
    expect(section).toContain('2 pointers');
    // The hint-less entry renders no " — " suffix.
    expect(section).toContain('`src/b.ts`\n');
  });
});
