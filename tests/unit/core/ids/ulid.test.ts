import { describe, expect, it } from 'vitest';

import { ulid, ULID_BODY } from '@/core/ids/ulid.js';

const ULID_RE = new RegExp(`^${ULID_BODY}$`);

describe('ulid', () => {
  it('produces a 26-character Crockford-base32 id', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(id).toMatch(ULID_RE);
    // Crockford base32 excludes I, L, O, U.
    expect(id).not.toMatch(/[ILOU]/);
  });

  it('sorts lexicographically by creation time', () => {
    const earlier = ulid(1_000_000_000_000);
    const later = ulid(2_000_000_000_000);
    expect(earlier < later).toBe(true);
    // The 10-char time prefix alone is already ordered.
    expect(earlier.slice(0, 10) < later.slice(0, 10)).toBe(true);
  });

  it('is monotonic within the same millisecond (strictly increasing, collision-free)', () => {
    const fixed = 1_700_000_000_000;
    const ids = Array.from({ length: 1000 }, () => ulid(fixed));
    // All unique...
    expect(new Set(ids).size).toBe(ids.length);
    // ...and already in sorted order without re-sorting.
    expect([...ids].sort()).toEqual(ids);
    // Same millisecond ⇒ identical time prefix; only the entropy advances.
    expect(new Set(ids.map((id) => id.slice(0, 10))).size).toBe(1);
  });

  it('does not collide across many default-time calls', () => {
    const ids = Array.from({ length: 5000 }, () => ulid());
    expect(new Set(ids).size).toBe(ids.length);
  });
});
