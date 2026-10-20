import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  stripTrailingChars,
  toPosixPath,
  toProjectRelativePath,
  trimEdgeChars,
} from '@/core/path-utils.js';

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

describe('toProjectRelativePath', () => {
  const root = join(tmpdir(), 'paqad-root');

  it('returns a posix project-relative path for a relative or absolute path inside the root', () => {
    expect(toProjectRelativePath(root, 'src/a.ts')).toBe('src/a.ts');
    expect(toProjectRelativePath(root, join(root, 'src', 'b.ts'))).toBe('src/b.ts');
    expect(toProjectRelativePath(root, './src/../src/c.ts')).toBe('src/c.ts');
    expect(toProjectRelativePath(root, '..notes/d.md')).toBe('..notes/d.md');
  });

  it('refuses the root itself and any path that leaves it', () => {
    expect(toProjectRelativePath(root, '.')).toBeNull();
    expect(toProjectRelativePath(root, '..')).toBeNull();
    expect(toProjectRelativePath(root, '../outside.ts')).toBeNull();
    expect(toProjectRelativePath(root, join(tmpdir(), 'elsewhere', 'x.ts'))).toBeNull();
  });
});
