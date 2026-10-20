import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSync = vi.fn();
vi.mock('node:child_process', () => ({ execFileSync: (...a: unknown[]) => execFileSync(...a) }));

import { isNpmAvailable, resetNpmAvailableCache } from '@/core/npm-available.js';

beforeEach(() => {
  resetNpmAvailableCache();
  execFileSync.mockReset();
});

afterEach(() => {
  resetNpmAvailableCache();
});

describe('isNpmAvailable', () => {
  it('is true when `npm --version` succeeds, and memoizes the probe', () => {
    execFileSync.mockReturnValue('10.0.0');
    expect(isNpmAvailable()).toBe(true);
    expect(isNpmAvailable()).toBe(true);
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it('is false when npm is not on PATH', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('command not found: npm');
    });
    expect(isNpmAvailable()).toBe(false);
  });
});
