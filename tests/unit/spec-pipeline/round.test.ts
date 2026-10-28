import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readinessLine } from '@/cli/commands/plan.js';
import { createPendingDecision, resolvePendingDecision } from '@/decisions/authoring.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import { openFeatureChange, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';
import {
  fixProofMethodLine,
  raiseFixProofMethodDecision,
} from '@/fix-protocol/fix-proof-method-decision.js';
import { mintExpertConflictDecisions } from '@/spec-pipeline/experts/conflicts.js';
import { buildQuestionRound, questionRoundAhead, roundOpener } from '@/spec-pipeline/round.js';
import { writeExpertSynthesis } from '@/spec-pipeline/run-store.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-round-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function openFix(root: string, session: string, title: string, ulid: string): string {
  const dir = openFeatureChange(root, session, { adapter: 'claude-code', title, ulid });
  recordChangeConstants(root, dir, { kind: 'fix', lane: 'full' });
  return dir;
}

function packet(root: string, category: string, title: string, change: string | null): string {
  return createPendingDecision(root, {
    category,
    title,
    context: 'x',
    options: [
      { option_key: 'a', label: 'a' },
      { option_key: 'b', label: 'b' },
    ],
    recommendation: 'a',
    ...(change ? { change } : {}),
  }).id;
}

const twoConflicts = {
  findings: [],
  conflicts: [
    {
      target: 'orders',
      roles: ['db-expert', 'performance-analyst'] as const,
      claims: ['stream the CSV in pages', 'generate in a background job'],
      finding_ids: ['EX-db-expert-1', 'EX-performance-analyst-1'],
    },
    {
      target: 'tokens',
      roles: ['security-auditor', 'performance-analyst'] as const,
      claims: ['rotate hourly', 'cache for a day'],
      finding_ids: ['EX-security-auditor-1', 'EX-performance-analyst-2'],
    },
  ].map((conflict) => ({ ...conflict, roles: [...conflict.roles] })),
};

describe('one question round per change', () => {
  it('AC-16: offers attribution, proof method, readiness and two conflicts in one round, nothing from another change', () => {
    const root = tempRoot();
    const dir = openFix(root, 'ses_round_a', 'round a', '01JABCDEFGHJKMNPQRSTVWXYZ1');
    const other = openFix(root, 'ses_round_b', 'round b', '01JABCDEFGHJKMNPQRSTVWXYZ2');
    const change = featureChangeKey(dir);

    const attribution = packet(root, 'architecture-path', 'Which module?', change);
    const readiness = packet(root, 'workflow-or-tool', 'Visual evidence readiness', change);
    const minted = mintExpertConflictDecisions(
      root,
      twoConflicts,
      [
        {
          target: 'orders',
          ruling: 'pick',
          recommendation: 'generate in a background job',
          rationale: 'x',
        },
        { target: 'tokens', ruling: 'pick', recommendation: 'rotate hourly', rationale: 'x' },
      ],
      dir,
    );
    const proof = raiseFixProofMethodDecision(root, dir)!;
    packet(root, 'architecture-path', 'Which module for b?', featureChangeKey(other));

    const round = buildQuestionRound(root, dir);
    const ids = round.packets.map((entry) => entry.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids)).toEqual(
      new Set([attribution, readiness, ...minted.minted.map((m) => m.id), proof.id]),
    );
    expect(ids).toEqual([...ids].sort());
    expect(round.batches).toEqual([ids.slice(0, 4), ids.slice(4)]);
    expect(round.packets.map((entry) => entry.category).sort()).toEqual([
      'architecture-path',
      'fix.proof_method',
      'spec.expert_conflict',
      'spec.expert_conflict',
      'workflow-or-tool',
    ]);
  });

  it('AC-16: neither plan compile nor experts synthesis asks when a round lies ahead', () => {
    expect(fixProofMethodLine('D-1', { deferred: true })).not.toContain('Answer');
    expect(fixProofMethodLine('D-1', { deferred: true })).toContain('spec questions step');
    expect(readinessLine('D-2', true)).not.toContain('Answer');
    expect(readinessLine('D-2', true)).toContain('spec questions step');
    expect(readinessLine('D-2', false)).toContain('Answer D-2');
  });

  it('AC-17: on the full lane with the pipeline on, a round lies ahead; on the fast lane it does not', () => {
    const root = tempRoot();
    const full = openFix(root, 'ses_lane_full', 'lane full', '01JABCDEFGHJKMNPQRSTVWXYZ3');
    expect(questionRoundAhead(root, full)).toBe(true);
    const fast = openFeatureChange(root, 'ses_lane_fast', {
      adapter: 'claude-code',
      title: 'lane fast',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ4',
    });
    recordChangeConstants(root, fast, { kind: 'fix', lane: 'fast' });
    expect(questionRoundAhead(root, fast)).toBe(false);
  });

  it('a partly answered round asks only what is still pending', () => {
    const root = tempRoot();
    const dir = openFix(root, 'ses_partial', 'partial', '01JABCDEFGHJKMNPQRSTVWXYZ5');
    const first = packet(root, 'architecture-path', 'one', featureChangeKey(dir));
    const second = packet(root, 'workflow-or-tool', 'two', featureChangeKey(dir));
    resolvePendingDecision(root, first, 'a');
    expect(buildQuestionRound(root, dir).packets.map((entry) => entry.id)).toEqual([second]);
  });
});

describe('the round opener', () => {
  it('AC-18: with N compatible rulings it opens with the agreed line and a details list', () => {
    const root = tempRoot();
    const dir = openFix(root, 'ses_opener', 'opener', '01JABCDEFGHJKMNPQRSTVWXYZ6');
    writeExpertSynthesis(root, dir, {
      verdict: 'ready',
      accepted: [],
      declined: [],
      conflicts: [
        { target: 'orders', ruling: 'pick', recommendation: 'a', rationale: 'x' },
        {
          target: 'tokens',
          ruling: 'compatible',
          merged_claim: 'rotate and cache',
          rationale: 'x',
        },
        { target: 'export', ruling: 'compatible', merged_claim: 'name by date', rationale: 'x' },
      ],
      gaps: [],
      questions: [],
      tokens: 0,
    });
    const round = buildQuestionRound(root, dir);
    expect(round.opener).not.toBeNull();
    const lines = round.opener!.split('\n');
    expect(lines[0]).toBe('The experts agreed on 2 points after merging overlaps');
    expect(round.opener).toContain('<details>');
    expect(round.opener).toContain('- tokens: rotate and cache');
    expect(round.opener).toContain('- export: name by date');
    expect(round.opener).toContain('</details>');
  });

  it('AC-18: with no compatible rulings the line is left out', () => {
    expect(roundOpener([])).toBeNull();
    const root = tempRoot();
    const dir = openFix(root, 'ses_no_opener', 'no opener', '01JABCDEFGHJKMNPQRSTVWXYZ7');
    expect(buildQuestionRound(root, dir).opener).toBeNull();
  });

  it('AC-18: one merged claim reads as one point', () => {
    expect(roundOpener([{ target: 't', merged_claim: 'c' }])!.split('\n')[0]).toBe(
      'The experts agreed on 1 point after merging overlaps',
    );
  });
});
