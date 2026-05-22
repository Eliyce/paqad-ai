import { describe, expect, it } from 'vitest';

import { openBrowser, shouldSkipBrowser } from '@/graph/opener';

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
