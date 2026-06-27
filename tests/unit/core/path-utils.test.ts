import { sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripTrailingChars, toPosixPath, trimEdgeChars } from '@/core/path-utils.js';

describe('toPosixPath', () => {
  it('joins path segments with forward slashes', () => {
    expect(toPosixPath(['docs', 'modules', 'foo'].join(sep))).toBe('docs/modules/foo');
  });

  it('leaves an already-posix path unchanged', () => {
    expect(toPosixPath('docs/modules/foo')).toBe('docs/modules/foo');
  });
});

describe('stripTrailingChars', () => {
  it('removes trailing characters in the set', () => {
    expect(stripTrailingChars('value///', '/')).toBe('value');
    expect(stripTrailingChars('a.b...', '.')).toBe('a.b');
  });

  it('returns the same string (no slice) when there is nothing to strip', () => {
    expect(stripTrailingChars('value', '/')).toBe('value');
    expect(stripTrailingChars('', '/')).toBe('');
  });

  it('handles a string made entirely of stripped characters', () => {
    expect(stripTrailingChars('///', '/')).toBe('');
  });
});

describe('trimEdgeChars', () => {
  it('removes leading and trailing characters in the set', () => {
    expect(trimEdgeChars('__value__', '_')).toBe('value');
    expect(trimEdgeChars('//a/b//', '/')).toBe('a/b');
  });

  it('returns the same string (no slice) when nothing is trimmed', () => {
    expect(trimEdgeChars('value', '/')).toBe('value');
    expect(trimEdgeChars('', '/')).toBe('');
  });

  it('handles a string made entirely of trimmed characters', () => {
    expect(trimEdgeChars('____', '_')).toBe('');
  });
});
