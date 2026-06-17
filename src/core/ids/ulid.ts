// Self-contained ULID generator (issue #184). A ULID is a 26-character,
// Crockford-base32 identifier whose first 10 characters encode a 48-bit
// millisecond timestamp and whose last 16 characters carry 80 bits of
// entropy. ULIDs are **lexicographically sortable by creation time**, which
// keeps directory-name ordering of decision packets chronological while being
// collision-free across machines — the property issue #184 needs so two
// developers on parallel branches never mint the same id.
//
// Implemented in-tree (no `ulid` npm dependency) to avoid adding a
// runtime dependency to a security-conscious package. Entropy comes from
// `node:crypto`; the generator is monotonic within a process so ids minted in
// the same millisecond (e.g. a batch of deferred decisions) still sort in
// allocation order.

import { randomBytes } from 'node:crypto';

// Crockford base32 alphabet (excludes I, L, O, U to avoid ambiguity).
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length; // 32
const TIME_LEN = 10;
const RANDOM_LEN = 16;

/** Single-ULID body pattern (the 26 chars after any prefix). */
export const ULID_BODY = `[0-9A-HJKMNP-TV-Z]{${TIME_LEN + RANDOM_LEN}}`;

let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(time: number): string {
  let remainder = time;
  let out = '';
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = remainder % ENCODING_LEN;
    out = ENCODING[mod] + out;
    remainder = (remainder - mod) / ENCODING_LEN;
  }
  return out;
}

function randomIndices(): number[] {
  const bytes = randomBytes(RANDOM_LEN);
  return Array.from(bytes, (byte) => byte % ENCODING_LEN);
}

/**
 * Increment a base32 index array by one, propagating carry from the least
 * significant position. On the (astronomically unlikely) overflow of a full
 * same-millisecond run, fall back to fresh entropy.
 */
function incrementIndices(indices: number[]): number[] {
  const next = [...indices];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]! < ENCODING_LEN - 1) {
      next[i] = next[i]! + 1;
      return next;
    }
    next[i] = 0;
  }
  /* v8 ignore next 2 -- same-ms entropy overflow is not reachable in practice */
  return randomIndices();
}

/**
 * Generate a ULID. Monotonic within this process: when called more than once in
 * the same millisecond, the entropy component is incremented rather than
 * re-randomised, so the returned ids strictly increase (and therefore sort in
 * allocation order). `seedTime` is exposed for deterministic tests.
 */
export function ulid(seedTime: number = Date.now()): string {
  if (seedTime <= lastTime) {
    lastRandom = incrementIndices(lastRandom);
  } else {
    lastTime = seedTime;
    lastRandom = randomIndices();
  }
  return encodeTime(seedTime) + lastRandom.map((index) => ENCODING[index]).join('');
}
