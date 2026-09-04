import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { computeDecisionFingerprint } from '@/planning/decision-fingerprint.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { buildRepoStateForIntake } from '@/planning/intake-prior-resolver.js';
import { autoAnswerQuestions } from '@/spec-pipeline/auto-answer.js';
import type { PipelineQuestion } from '@/spec-pipeline/types.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-sp-aa-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function question(overrides: Partial<PipelineQuestion> = {}): PipelineQuestion {
  return {
    business_text: 'Should exports include archived orders?',
    why_it_matters: 'It changes which rows appear in the file.',
    options: ['Include archived orders', 'Exclude archived orders'],
    grounded_in: null,
    ...overrides,
  };
}

/** Write a resolved decision packet straight to the resolved directory (the precedent seam). */
function writeResolved(root: string, packet: DecisionPacket): void {
  const dir = join(root, PATHS.DECISIONS_RESOLVED_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${packet.decision_id}.json`), JSON.stringify(packet, null, 2), 'utf8');
}

function resolvedPacket(
  partial: Partial<DecisionPacket> & { decision_id: string },
): DecisionPacket {
  const now = '2026-09-04T00:00:00.000Z';
  return {
    decision_id: partial.decision_id,
    fingerprint: `sha256:${partial.decision_id}`,
    category: 'intake.requirement',
    question: 'Should exports include archived orders?',
    context:
      'It changes which rows appear in the file. Include archived orders Exclude archived orders',
    options: [
      {
        option_key: 'include-archived-orders',
        label: 'Include archived orders',
        one_line_preview: 'include them',
        trade_off: 'bigger export',
        evidence: {},
      },
      {
        option_key: 'exclude-archived-orders',
        label: 'Exclude archived orders',
        one_line_preview: 'omit them',
        trade_off: 'fewer rows',
        evidence: {},
      },
    ],
    confidence: 0.9,
    requested_by: 'agent',
    task_session_id: 'task-aa',
    created_at: now,
    status: 'resolved',
    ttl_until: '2026-12-31T00:00:00.000Z',
    invalidation_watch: [],
    human_response: {
      chosen_option_key: 'include-archived-orders',
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: now,
      responded_by: 'human',
      carry_over_scope: 'task',
      note: 'archived orders are part of the audit trail',
    },
    ...partial,
  };
}

describe('autoAnswerQuestions', () => {
  it('auto-answers a question matching a resolved decision (precedent seam) and drops it from remaining', () => {
    const root = tempRoot();
    writeResolved(root, resolvedPacket({ decision_id: 'D-501' }));

    const q = question();
    const { answered, remaining } = autoAnswerQuestions(root, [q]);

    expect(remaining).toHaveLength(0);
    expect(answered).toHaveLength(1);
    expect(answered[0]).toEqual({
      question: q.business_text,
      answer: 'Include archived orders',
      source: 'D-501',
    });
  });

  it('auto-answers via the exact/fingerprint reuse seam when the ledger index has a match', () => {
    const root = tempRoot();
    const q = question({
      business_text: 'Cache the compiled rule manifest between runs?',
      why_it_matters: 'It trades freshness for speed.',
      options: ['Cache it', 'Recompile every run'],
    });
    const optionKeys = ['cache-it', 'recompile-every-run'];
    const fingerprint = computeDecisionFingerprint({
      category: 'intake.requirement',
      question: q.business_text,
      option_keys: optionKeys,
      repo_state: buildRepoStateForIntake([], null, undefined),
    });
    const packet = resolvedPacket({
      decision_id: 'D-777',
      fingerprint,
      question: q.business_text,
      context: 'caching decision',
      options: [
        {
          option_key: 'cache-it',
          label: 'Cache it',
          one_line_preview: 'reuse the manifest',
          trade_off: 'staleness',
          evidence: {},
        },
        {
          option_key: 'recompile-every-run',
          label: 'Recompile every run',
          one_line_preview: 'always fresh',
          trade_off: 'slower',
          evidence: {},
        },
      ],
      human_response: {
        chosen_option_key: 'cache-it',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-09-04T00:00:00.000Z',
        responded_by: 'human',
        carry_over_scope: 'task',
      },
    });
    writeResolved(root, packet);
    writeFileSync(
      join(root, PATHS.DECISIONS_INDEX),
      JSON.stringify({
        fingerprints: { [fingerprint]: 'D-777' },
        decisions: {
          'D-777': {
            decision_id: 'D-777',
            fingerprint,
            category: 'intake.requirement',
            chosen_option_key: 'cache-it',
            responded_at: '2026-09-04T00:00:00.000Z',
            status: 'resolved',
            option_keys: optionKeys,
          },
        },
      }),
      'utf8',
    );

    const { answered, remaining } = autoAnswerQuestions(root, [q]);
    expect(remaining).toHaveLength(0);
    expect(answered).toEqual([{ question: q.business_text, answer: 'Cache it', source: 'D-777' }]);
  });

  it('leaves a question with no ledger match in remaining', () => {
    const root = tempRoot();
    const q = question({ business_text: 'What colour should the banner be?' });
    const { answered, remaining } = autoAnswerQuestions(root, [q]);
    expect(answered).toHaveLength(0);
    expect(remaining).toEqual([q]);
  });

  it('splits a mixed batch — matched removed, unmatched kept', () => {
    const root = tempRoot();
    writeResolved(root, resolvedPacket({ decision_id: 'D-502' }));
    const matched = question();
    const unmatched = question({
      business_text: 'How long should the onboarding banner stay visible?',
      why_it_matters: 'It affects first-run UX.',
      options: ['Until dismissed', 'For 10 seconds'],
    });

    const { answered, remaining } = autoAnswerQuestions(root, [matched, unmatched]);
    expect(answered.map((a) => a.question)).toEqual([matched.business_text]);
    expect(remaining).toEqual([unmatched]);
  });

  it('is a pure, synchronous, deterministic lookup (no model call)', () => {
    const root = tempRoot();
    writeResolved(root, resolvedPacket({ decision_id: 'D-503' }));
    const batch = [question()];

    const result = autoAnswerQuestions(root, batch);
    // A synchronous return value structurally cannot have awaited a model call (AC-2 / INV-1).
    expect(result).not.toBeInstanceOf(Promise);
    // Same inputs → byte-identical split (determinism / NFR-1).
    expect(autoAnswerQuestions(root, batch)).toEqual(result);
  });

  it('every injected answer carries a non-empty ledger source (INV-2 / AC-5)', () => {
    const root = tempRoot();
    writeResolved(root, resolvedPacket({ decision_id: 'D-504' }));
    const { answered } = autoAnswerQuestions(root, [question()]);
    expect(answered[0]!.source).toBe('D-504');
    expect(answered[0]!.source.length).toBeGreaterThan(0);
  });
});
