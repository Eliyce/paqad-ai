import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureDir } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, foldFeature } from '@/feature-evidence/stage-ledger.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import {
  LEGACY_CONTEXT_EFFICIENCY_FILE,
  formatStageIsolationLine,
  hasStageAgentEvidence,
  readStageAgentRows,
  summarizeStageIsolation,
} from '@/stage-isolation/isolation-summary.js';
import { composeChangeReceipt } from '@/verification/repository/receipt.js';

import { appendLegacyStageRow } from '../../shared/legacy-stage-row.js';

const DIR = '581-one-packet-01JABCDEFGHJKMNPQRSTVWXYZ0';
const clock = () => new Date('2026-09-25T00:00:00.000Z');

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-isolation-summary-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function stageAgent(root: string, stage: string, notRecarried: number, estimate = true): void {
  appendFeatureStageRow(
    root,
    'ses_orch',
    DIR,
    {
      kind: 'stage-agent',
      stage,
      agent: `paqad-${stage}`,
      tokens_used: 100,
      tokens_not_recarried: notRecarried,
      estimate,
    },
    clock,
  );
}

function writeLegacy(root: string, lines: Record<string, unknown>[]): void {
  mkdirSync(join(root, featureDir(DIR)), { recursive: true });
  const base = {
    doc_type: 'paqad.context-efficiency',
    session_id: 's',
    ts: 't',
    content_hash: 'h',
  };
  writeFileSync(
    join(root, featureDir(DIR), LEGACY_CONTEXT_EFFICIENCY_FILE),
    lines.map((line) => JSON.stringify({ ...base, ...line })).join('\n'),
  );
}

describe('stage-agent rows', () => {
  it('reads one row per dispatched stage agent and summarises what isolation saved', () => {
    const root = tempRoot();
    appendFeatureStageRow(root, 'ses_orch', DIR, { kind: 'open' }, clock);
    stageAgent(root, 'planning', 1000);
    stageAgent(root, 'development', 2500);
    stageAgent(root, 'development', 500);

    expect(readStageAgentRows(root, DIR)).toHaveLength(3);
    expect(hasStageAgentEvidence(root, DIR)).toBe(true);
    expect(summarizeStageIsolation(root, DIR)).toEqual({
      stages: 2,
      tokensNotRecarried: 4000,
      estimate: true,
    });
  });

  it('reads exact only when no row says it was estimated', () => {
    const root = tempRoot();
    stageAgent(root, 'review', 10, false);
    expect(summarizeStageIsolation(root, DIR)?.estimate).toBe(false);
  });

  it('is null, and there is no evidence, when no stage agent was recorded', () => {
    const root = tempRoot();
    appendFeatureStageRow(root, 'ses_orch', DIR, { kind: 'open' }, clock);
    expect(hasStageAgentEvidence(root, DIR)).toBe(false);
    expect(summarizeStageIsolation(root, DIR)).toBeNull();
  });

  it('never lets a stage-agent row change the stage fold', () => {
    const root = tempRoot();
    appendFeatureStageRow(root, 'ses_orch', DIR, { kind: 'open' }, clock);
    const before = foldFeature(root, 'ses_orch', DIR);
    stageAgent(root, 'planning', 10);
    expect(foldFeature(root, 'ses_orch', DIR).stages).toEqual(before.stages);
    expect(foldFeature(root, 'ses_orch', DIR).completeness).toEqual(before.completeness);
  });
});

describe('tokens not re-carried, once per agent', () => {
  function completed(root: string, stage: string, notRecarried: number, agentId?: string): void {
    appendFeatureStageRow(
      root,
      'ses_orch',
      DIR,
      {
        kind: 'stage-agent',
        stage,
        agent: `paqad-${stage}`,
        ...(agentId === undefined ? {} : { agent_id: agentId }),
        event_status: 'completed',
        tokens_used: 100,
        tokens_not_recarried: notRecarried,
        estimate: false,
      },
      clock,
    );
  }

  it('AC-37: counts one row unchanged', () => {
    const root = tempRoot();
    completed(root, 'development', 4000, 'dev-1');
    expect(summarizeStageIsolation(root, DIR)?.tokensNotRecarried).toBe(4000);
  });

  it('AC-37: counts cumulative rows from one resumed agent once, at their max', () => {
    const root = tempRoot();
    completed(root, 'development', 4000, 'dev-1');
    completed(root, 'development', 9000, 'dev-1');
    completed(root, 'development', 12000, 'dev-1');
    expect(summarizeStageIsolation(root, DIR)).toMatchObject({
      stages: 1,
      tokensNotRecarried: 12000,
    });
  });

  it('AC-37: still sums rows from different agents', () => {
    const root = tempRoot();
    completed(root, 'planning', 3000, 'plan-1');
    completed(root, 'development', 4000, 'dev-1');
    completed(root, 'development', 9000, 'dev-1');
    expect(summarizeStageIsolation(root, DIR)?.tokensNotRecarried).toBe(12000);
  });

  it('AC-37: counts each row with no agent id, never merging them into one bucket', () => {
    const root = tempRoot();
    completed(root, 'planning', 3000);
    completed(root, 'specification', 5000);
    completed(root, 'development', 7000, 'dev-1');
    expect(summarizeStageIsolation(root, DIR)?.tokensNotRecarried).toBe(15000);
  });

  it('AC-38: gives a legacy bundle with no agent ids the same per-row sum as before', () => {
    const root = tempRoot();
    stageAgent(root, 'planning', 1500);
    stageAgent(root, 'development', 2500);
    stageAgent(root, 'development', 2500);
    expect(summarizeStageIsolation(root, DIR)?.tokensNotRecarried).toBe(6500);
  });
});

describe('a started stage-agent row (hud-live-run-truth)', () => {
  it('adds no isolated stage and no evidence while the agent is still running', () => {
    const root = tempRoot();
    appendFeatureStageRow(
      root,
      'ses_orch',
      DIR,
      {
        kind: 'stage-agent',
        stage: 'planning',
        agent: 'paqad-planning',
        agent_id: 'agent_plan_1',
        event_status: 'started',
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      },
      clock,
    );
    expect(readStageAgentRows(root, DIR)).toEqual([]);
    expect(hasStageAgentEvidence(root, DIR)).toBe(false);
    expect(summarizeStageIsolation(root, DIR)).toBeNull();
    stageAgent(root, 'development', 300);
    expect(summarizeStageIsolation(root, DIR)?.stages).toBe(1);
  });
});

describe('the stage-agent row schema', () => {
  it('requires the stage-agent fields on a stage-agent row', () => {
    const root = tempRoot();
    expect(() =>
      appendFeatureStageRow(root, 's', DIR, { kind: 'stage-agent', stage: 'planning' }, clock),
    ).toThrow(/tokens_used/);
  });

  it('rejects a negative token count', () => {
    const root = tempRoot();
    expect(() =>
      appendFeatureStageRow(
        root,
        's',
        DIR,
        {
          kind: 'stage-agent',
          stage: 'planning',
          tokens_used: -1,
          tokens_not_recarried: 0,
          estimate: true,
        },
        clock,
      ),
    ).toThrow(/tokens_used/);
  });

  it('is not a kind a legacy-shape row could carry', () => {
    const legacy = appendLegacyStageRow(tempRoot(), DIR, 's', { kind: 'stage-agent' });
    expect(validateStageEvidenceRow(legacy)).not.toEqual([]);
  });
});

describe('an old bundle with context-efficiency.jsonl (INV-8)', () => {
  it('still reads as isolation evidence and still feeds the context line', () => {
    const root = tempRoot();
    writeLegacy(root, [
      { stage: 'planning', carried_history_avoided_estimate: 700 },
      { stage: 'review', carried_history_avoided_estimate: 300 },
      { stage: 'review', carried_history_avoided_estimate: 'n/a' },
    ]);
    expect(hasStageAgentEvidence(root, DIR)).toBe(true);
    expect(summarizeStageIsolation(root, DIR)).toEqual({
      stages: 2,
      tokensNotRecarried: 1000,
      estimate: true,
    });
  });

  it('counts both sources when a change was upgraded part-way through', () => {
    const root = tempRoot();
    writeLegacy(root, [
      { stage: 'planning', carried_history_avoided_estimate: 100 },
      { stage: 'specification', carried_history_avoided_estimate: 200 },
      { stage: 'development', carried_history_avoided_estimate: 300 },
    ]);
    stageAgent(root, 'development', 5, false);
    stageAgent(root, 'review', 7, false);
    stageAgent(root, 'checks', 11, false);
    stageAgent(root, 'documentation_sync', 13, false);
    expect(summarizeStageIsolation(root, DIR)).toEqual({
      stages: 6,
      tokensNotRecarried: 636,
      estimate: true,
    });
  });
});

describe('the receipt context line', () => {
  it('uses the words the narration contract fixes', () => {
    expect(formatStageIsolationLine({ stages: 3, tokensNotRecarried: 1200, estimate: true })).toBe(
      'context: 3 stages isolated, ~1200 tokens not re-carried (estimate)',
    );
    expect(formatStageIsolationLine({ stages: 1, tokensNotRecarried: 5, estimate: false })).toBe(
      'context: 1 stage isolated, ~5 tokens not re-carried (exact)',
    );
  });

  it('is added to the receipt only when isolation was recorded', () => {
    const summary = { stages: 2, tokensNotRecarried: 40, estimate: true };
    const withLine = composeChangeReceipt({ verdictSummary: 'V', fold: null, isolation: summary });
    expect(withLine).toContain('> context: 2 stages isolated');
    expect(composeChangeReceipt({ verdictSummary: 'V', fold: null })).not.toContain('context:');
  });
});
