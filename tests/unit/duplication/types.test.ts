import { describe, expect, it } from 'vitest';

import { duplicationMessage, formatRange } from '@/duplication/types.js';

describe('formatRange', () => {
  it('renders a multi-line span as start-end', () => {
    expect(formatRange({ start: 12, end: 19 })).toBe('12-19');
  });
  it('renders a single line as a bare number', () => {
    expect(formatRange({ start: 7, end: 7 })).toBe('7');
  });
});

describe('duplicationMessage', () => {
  it('renders the verbatim template with a symbol', () => {
    const message = duplicationMessage({
      file: 'src/stamp.ts',
      lineRange: { start: 12, end: 19 },
      matchedFile: 'src/utils/dates.ts',
      matchedSymbol: 'formatIsoDate',
      matchedLineRange: { start: 3, end: 10 },
      similarity: 0.93,
      matchedCallers: 4,
    });
    expect(message).toBe(
      'New code in src/stamp.ts:12-19 is 93% similar to existing formatIsoDate ' +
        '(src/utils/dates.ts:3-10), already used by 4 call sites. Prefer reusing or extending ' +
        'it — or record why a new copy is needed.',
    );
  });

  it('falls back to the matched file when no symbol is known', () => {
    const message = duplicationMessage({
      file: 'a.ts',
      lineRange: { start: 1, end: 8 },
      matchedFile: 'b.ts',
      matchedLineRange: { start: 1, end: 8 },
      similarity: 0.9,
      matchedCallers: 0,
    });
    expect(message).toContain('similar to existing b.ts (b.ts:1-8)');
  });
});
