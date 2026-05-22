import { describe, expect, it } from 'vitest';

import { isEnoentError } from '@/compliance/index-store.js';

describe('isEnoentError', () => {
  it('returns false for non-object inputs', () => {
    expect(isEnoentError(null)).toBe(false);
    expect(isEnoentError('nope')).toBe(false);
  });

  it('detects ENOENT by code', () => {
    expect(isEnoentError({ code: 'ENOENT' })).toBe(true);
    expect(isEnoentError({ code: 'EACCES' })).toBe(false);
  });
});
