import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

const between = (text: string, start: string, end: string): string => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing section end: ${end}`).toBeGreaterThan(from);
  return text.slice(from, to);
};

const EM_DASH = '—';

describe('HUD and verification docs describe the truthful verdict', () => {
  const hud = read('docs/instructions/design-system/hud.md');
  const summary = read('docs/modules/verification/index/summary.md');

  const ladder = between(hud, 'One headline engine, `computeHudHeadline`', '### Strip states');
  const trust = between(hud, '### Trust tab', '### Strip states');
  const gates = between(summary, '## Gate states and record ownership', '## Why the code works');

  it('AC-41: the HUD doc describes the done ladder step by step', () => {
    for (const step of ['`Done`', '`Committed`', '`PR open`', '`Safe to merge`', '`Merged`']) {
      expect(ladder).toContain(step);
    }
    expect(ladder).toContain('only on real CI green');
    expect(ladder).toContain('When CI is unknown the ladder stops at\n`PR open`');
  });

  it('AC-41: the verification doc names the gate states', () => {
    for (const state of ['pass', 'fail', 'could not prove', 'not required']) {
      expect(gates).toContain(state);
    }
    expect(gates).toMatch(/did\s+not run/);
    expect(gates).toContain('recorded as did not run');
  });

  it("AC-41: the docs split paqad's record from the work", () => {
    expect(gates).toContain('Problems in the work fail or stop the change.');
    expect(gates).toContain("Problems in paqad's own record are paqad's gap, not the work's.");
    expect(gates).toContain('`work_kind`, `record_gaps` and `repairs`');
    expect(hud).toContain("(paqad's gap, not the work's)");
  });

  it('AC-41: the HUD doc describes the Trust tab stage by stage', () => {
    expect(trust).toContain('The Trust tab shows the proof of the work, stage by stage.');
    expect(trust).toContain('**Stage heading row**');
    expect(trust).toContain('**Step lines**');
    expect(trust).toContain('**Gate rows** use Row.');
    expect(trust).toContain('Empty state: `Nothing to prove yet`.');
  });

  it('AC-41: the sections this change added carry no em dash', () => {
    for (const section of [ladder, trust, gates]) {
      expect(section).not.toContain(EM_DASH);
    }
  });
});
