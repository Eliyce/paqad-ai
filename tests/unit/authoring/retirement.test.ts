import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACTIVATIONS_LEDGER } from '@/authoring/activations.js';
import { runRetirementStep } from '@/authoring/retirement.js';
import { readDebtItems } from '@/tech-debt/items.js';

import { useTempRoots } from '../_helpers/temp-roots.js';

const tempRoot = useTempRoots('paqad-retirement-');
const NOW = new Date('2026-11-01T12:00:00.000Z');

function writeLog(root: string, rows: { skill: string; at: string }[]): void {
  const path = join(root, ACTIVATIONS_LEDGER);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    rows
      .map((row) =>
        JSON.stringify({ ...row, request_id: null, session_id: null, source: 'Skill-tool' }),
      )
      .join('\n'),
  );
}

function pendingDecisions(root: string): string[] {
  const dir = join(root, '.paqad', 'decisions', 'pending');
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe('AC-30: the retirement step waits for a 30-day activation log', () => {
  it('a log younger than 30 days files one follow-up dated for day 30 and raises no packet', () => {
    const root = tempRoot();
    writeLog(root, [{ skill: 'decision', at: '2026-10-20T08:00:00.000Z' }]);
    const result = runRetirementStep({ projectRoot: root, skills: ['decision', 'join'], now: NOW });
    expect(result).toMatchObject({ outcome: 'follow-up', due: '2026-11-19' });
    const debt = readDebtItems(root);
    expect(debt).toHaveLength(1);
    expect(debt[0]).toMatchObject({ kind: 'follow-up', status: 'open' });
    expect(debt[0]!.title).toContain('2026-11-19');
    expect(pendingDecisions(root)).toEqual([]);
  });

  it('no log at all is treated as a log that starts today', () => {
    const root = tempRoot();
    expect(runRetirementStep({ projectRoot: root, skills: ['join'], now: NOW })).toMatchObject({
      outcome: 'follow-up',
      due: '2026-12-01',
    });
  });

  it('a log older than 30 days raises one packet per skill that never fired in the window', () => {
    const root = tempRoot();
    writeLog(root, [
      { skill: 'decision', at: '2026-09-01T08:00:00.000Z' },
      { skill: 'decision', at: '2026-10-25T08:00:00.000Z' },
      { skill: 'join', at: '2026-09-02T08:00:00.000Z' },
    ]);
    const result = runRetirementStep({
      projectRoot: root,
      skills: ['decision', 'join', 'onboard', 'onboard'],
      now: NOW,
    });
    expect(result.outcome).toBe('packets');
    if (result.outcome !== 'packets') return;
    expect(result.decisions.map((entry) => entry.skill)).toEqual(['join', 'onboard']);
    expect(pendingDecisions(root)).toHaveLength(2);
    expect(readDebtItems(root)).toEqual([]);
  });
});
