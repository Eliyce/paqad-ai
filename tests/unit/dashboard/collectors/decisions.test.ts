import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectDecisions } from '@/dashboard/collectors/decisions';
import {
  recordDecisionExpired,
  recordDecisionOpened,
  recordDecisionResolved,
} from '@/planning/decision-ledger.js';

const NOW = Date.UTC(2026, 4, 26);

/** Onboard the decisions contract (the dir's existence is the "in use" signal). */
function useContract(root: string): void {
  mkdirSync(join(root, '.paqad/decisions'), { recursive: true });
}

function openPending(root: string, id: string, agedDays: number, title = id): void {
  recordDecisionOpened(root, {
    decisionId: id,
    category: 'scope',
    title,
    createdAt: new Date(NOW - agedDays * 86_400_000).toISOString(),
  });
}

describe('collectDecisions', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-dec-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when there is no decisions directory', () => {
    const { section, attention } = collectDecisions(root, NOW);
    expect(section.band).toBe('unknown');
    expect(attention).toEqual([]);
  });

  it('scores green when the contract is in use but no decisions are recorded', () => {
    useContract(root);
    const { section } = collectDecisions(root, NOW);
    expect(section.band).toBe('green');
    expect(section.score).toBe(100);
    expect(section.summary).toMatch(/Clear/);
  });

  it('penalises ageing pending packets read from the ledger', () => {
    useContract(root);
    openPending(root, 'D-1', 2);
    openPending(root, 'D-2', 5);
    const { section, attention } = collectDecisions(root, NOW);
    // 20 (≤3d) + 35 (≤7d) = 55 penalty → 45.
    expect(section.score).toBe(45);
    expect(section.band).toBe('red');
    expect(attention.length).toBe(2);
    expect(attention[0]?.message).toMatch(/D-2/);
  });

  it('treats packets older than a week as critical', () => {
    useContract(root);
    openPending(root, 'D-9', 14);
    const { section, attention } = collectDecisions(root, NOW);
    expect(section.score).toBe(50);
    expect(attention[0]?.severity).toBe('critical');
  });

  it('reports resolved and expired counts folded from the ledger', () => {
    useContract(root);
    openPending(root, 'D-3', 0);
    openPending(root, 'D-4', 0);
    openPending(root, 'D-5', 0);
    recordDecisionResolved(root, 'D-3', 'resolved', 'human');
    recordDecisionResolved(root, 'D-4', 'delegated', 'human');
    recordDecisionExpired(root, 'D-5');
    const { section } = collectDecisions(root, NOW);
    expect(section.metrics.find((m) => m.label === 'resolved')?.value).toBe('2');
    expect(section.metrics.find((m) => m.label === 'expired')?.value).toBe('1');
    expect(section.metrics.find((m) => m.label === 'pending')?.value).toBe('0');
  });

  it('ages a pending packet whose opened row carried no created_at as fresh', () => {
    useContract(root);
    recordDecisionOpened(root, {
      decisionId: 'D-7',
      category: 'scope',
      title: 'no date',
      createdAt: '',
    });
    const { section, attention } = collectDecisions(root, NOW);
    // No created_at → aged from `now` → 0 days → 10 penalty → 90, no attention (< 1d).
    expect(section.score).toBe(90);
    expect(attention).toEqual([]);
  });

  // Hard-cutover proof (D1): a pending packet written ONLY to the legacy file bucket
  // (never recorded to the ledger) is invisible to the dashboard.
  it('ignores a pending packet present only as a legacy file', () => {
    useContract(root);
    const dir = join(root, '.paqad/decisions/pending');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'D-ghost.json'),
      JSON.stringify({
        decision_id: 'D-ghost',
        question: 'ghost',
        created_at: '2026-04-01T00:00:00Z',
      }),
    );
    const { section } = collectDecisions(root, NOW);
    expect(section.score).toBe(100);
    expect(section.metrics.find((m) => m.label === 'pending')?.value).toBe('0');
  });
});
