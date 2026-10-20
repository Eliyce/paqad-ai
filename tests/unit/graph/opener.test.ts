import { describe, expect, it } from 'vitest';

import { isOpenableTarget, openBrowser, shouldSkipBrowser } from '@/graph/opener';

describe('shouldSkipBrowser', () => {
  it('returns a reason when an SSH session is detected', () => {
    expect(shouldSkipBrowser({ SSH_TTY: '/dev/pts/1' })).toMatch(/SSH/);
    expect(shouldSkipBrowser({ SSH_CONNECTION: '1.1.1.1' })).toMatch(/SSH/);
  });

  it('returns null when no skip signal is present (on darwin/win)', () => {
    if (process.platform === 'linux') {
      expect(shouldSkipBrowser({ DISPLAY: ':0' })).toBeNull();
    } else {
      expect(shouldSkipBrowser({})).toBeNull();
    }
  });
});

describe('openBrowser', () => {
  it('reports not opened when skip is set', () => {
    expect(openBrowser({ url: 'http://localhost', skip: true })).toEqual({
      opened: false,
      reason: 'browser open suppressed',
    });
  });
});

describe('isOpenableTarget', () => {
  it('accepts http(s) URLs and existing absolute file paths', () => {
    expect(isOpenableTarget('http://127.0.0.1:4000/#/graph')).toBe(true);
    expect(isOpenableTarget('https://example.com/a?b=1&c=2')).toBe(true);
    expect(isOpenableTarget(process.execPath)).toBe(true);
  });

  it('rejects option-like strings, other schemes, relative and missing paths', () => {
    expect(isOpenableTarget('--upload-pack=x')).toBe(false);
    expect(isOpenableTarget('   ')).toBe(false);
    expect(isOpenableTarget('javascript:alert(1)')).toBe(false);
    expect(isOpenableTarget('file:///etc/passwd')).toBe(false);
    expect(isOpenableTarget('relative/path.html')).toBe(false);
    expect(isOpenableTarget('/definitely/not/here.html')).toBe(false);
  });
});
