import { randomBytes } from 'node:crypto';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

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

function incrementIndices(indices: number[]): number[] {
  const next = [...indices];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]! < ENCODING_LEN - 1) {
      next[i] = next[i]! + 1;
      return next;
    }
    next[i] = 0;
  }
  /* v8 ignore start -- same-ms entropy overflow is not reachable in practice */
  return randomIndices();
}
/* v8 ignore stop */

export function ulid(seedTime: number = Date.now()): string {
  if (seedTime <= lastTime) {
    lastRandom = incrementIndices(lastRandom);
  } else {
    lastTime = seedTime;
    lastRandom = randomIndices();
  }
  return encodeTime(seedTime) + lastRandom.map((index) => ENCODING[index]).join('');
}
