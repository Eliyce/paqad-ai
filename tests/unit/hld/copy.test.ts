import { describe, expect, it } from 'vitest';

import { formatAge, formatDay, gateBlockLine, prSkippedLine } from '@/hld/copy.js';

const AT = '2026-10-30T09:00:00Z';
const at = (ms: number) => new Date(Date.parse(AT) + ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('hld copy', () => {
  it.each([
    [0, 'less than a minute'],
    [MIN - 1, 'less than a minute'],
    [MIN, '1 minute'],
    [2 * MIN, '2 minutes'],
    [HOUR - 1, '59 minutes'],
    [HOUR, '1 hour'],
    [DAY - 1, '23 hours'],
    [DAY, '1 day'],
    [2 * DAY - 1, '1 day'],
    [2 * DAY, '2 days'],
  ])('AC-51: %d ms after the post reads %s with an injected clock', (ms, text) => {
    expect(formatAge(AT, at(ms))).toBe(text);
  });

  it('formats the day and the skip line', () => {
    expect(formatDay('2026-10-31T23:30:00Z')).toBe('31 Oct');
    expect(prSkippedLine('Hotfix for checkout.')).toBe(
      'Built before high-level design sign-off. Reason: Hotfix for checkout.',
    );
  });

  it('FR-20: the gate line drops the skip when skips are off', () => {
    expect(gateBlockLine('PQD-1', false)).toBe(
      'The high-level design for PQD-1 is waiting for sign-off. Check for an answer with paqad-ai hld check-approval. The build starts only once an approver answers there.',
    );
  });
});
