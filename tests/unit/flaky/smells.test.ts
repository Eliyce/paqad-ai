import { describe, expect, it } from 'vitest';

import { detectFlakinessSmells, smellCategories } from '@/flaky/smells.js';

describe('detectFlakinessSmells', () => {
  it('surfaces timing smells (Date.now, setTimeout, sleep)', () => {
    const hits = detectFlakinessSmells('const t = Date.now(); await sleep(10);');
    expect(hits.map((h) => h.smell)).toContain('timing');
  });

  it('surfaces randomness smells (Math.random)', () => {
    const hits = detectFlakinessSmells('const x = Math.random();');
    expect(hits).toEqual([{ smell: 'randomness', signal: 'Math.random' }]);
  });

  it('surfaces order-dependence smells (.only, beforeAll)', () => {
    const hits = detectFlakinessSmells('beforeAll(() => { seed(); });');
    expect(hits.map((h) => h.smell)).toContain('order-dependence');
  });

  it('surfaces shared-state smells (process.env mutation)', () => {
    const hits = detectFlakinessSmells('process.env.TOKEN = "x";');
    expect(hits.map((h) => h.smell)).toContain('shared-state');
  });

  it('surfaces network/IO smells (fetch, fs)', () => {
    const hits = detectFlakinessSmells('await fetch("http://x"); readFileSync("a");');
    expect(hits.map((h) => h.smell)).toContain('network-io');
  });

  it('deduplicates repeated signals and is deterministic', () => {
    const hits = detectFlakinessSmells('Math.random(); Math.random(); Math.random();');
    expect(hits).toHaveLength(1);
  });

  it('returns nothing for clean source or empty input', () => {
    expect(detectFlakinessSmells('expect(add(1, 2)).toBe(3);')).toEqual([]);
    expect(detectFlakinessSmells('')).toEqual([]);
  });
});

describe('smellCategories', () => {
  it('returns distinct categories in declared order', () => {
    const hits = detectFlakinessSmells(
      'Math.random(); fetch("x"); Date.now(); process.env.A = "1";',
    );
    expect(smellCategories(hits)).toEqual(['timing', 'shared-state', 'network-io', 'randomness']);
  });

  it('returns an empty list for no hits', () => {
    expect(smellCategories([])).toEqual([]);
  });
});
