import { describe, expect, it } from 'vitest';

import { replaceMarkerBlock } from '@/core/text/marker-block.js';

describe('replaceMarkerBlock', () => {
  it('swaps only the marked block and keeps the text around it', () => {
    expect(replaceMarkerBlock('a\n<b>\nold\n</b>\nz', '<b>', '</b>', '<b>\nnew\n</b>')).toBe(
      'a\n<b>\nnew\n</b>\nz',
    );
  });

  it('returns null when a marker is missing or the end comes first', () => {
    expect(replaceMarkerBlock('plain', '<b>', '</b>', 'x')).toBeNull();
    expect(replaceMarkerBlock('<b> only', '<b>', '</b>', 'x')).toBeNull();
    expect(replaceMarkerBlock('</b> then <b>', '<b>', '</b>', 'x')).toBeNull();
  });
});
