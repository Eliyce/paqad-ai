import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { computeDecisionFingerprint } from '@/planning/decision-fingerprint.js';
import { validateDecisionPacket } from '@/planning/decision-packet.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';

describe('decision performance helpers', () => {
  it('computes decision fingerprints quickly across repeated calls', () => {
    const start = performance.now();
    for (let index = 0; index < 2000; index += 1) {
      computeDecisionFingerprint({
        category: 'create-vs-reuse',
        question: `Reuse this or make new ${index % 3}?`,
        option_keys: ['reuse-existing', 'make-new'],
        repo_state: {
          active_capabilities: ['coding'],
          stack: 'node',
          packs: ['planning'],
        },
      });
    }
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('validates decision packets quickly across repeated calls', () => {
    const packet: DecisionPacket = {
      decision_id: 'D-2',
      fingerprint: 'sha256:test',
      category: 'create-vs-reuse',
      question: 'Reuse this or make new?',
      context: 'Choose the path before implementation continues.',
      options: [
        {
          option_key: 'reuse-existing',
          label: 'Reuse what exists',
          one_line_preview: 'If you pick this, we will update src/existing.ts.',
          trade_off: 'You give up: a blank-slate implementation.',
          evidence: { file: 'src/existing.ts', callers: 4, similarity: 0.91 },
        },
        {
          option_key: 'make-new',
          label: 'Make a new one',
          one_line_preview: 'If you pick this, we will create src/new.ts.',
          trade_off: 'You give up: the shared path that already exists.',
          evidence: { file: 'src/new.ts', similarity: 0.42, evidence_partial: true },
        },
      ],
      recommendation: 'reuse-existing',
      recommendation_reason: 'This path already matches the way the repo works today.',
      confidence: 0.91,
      requested_by: 'codex-cli',
      task_session_id: 'task-a',
      linked_requirements: ['FR-1'],
      linked_slice_id: 'SL-1',
      created_at: '2026-04-27T12:00:00Z',
      status: 'pending',
      ttl_until: '2099-12-31T12:00:00Z',
      invalidation_watch: ['src/existing.ts', 'docs/instructions/design-system'],
    };

    const start = performance.now();
    for (let index = 0; index < 2000; index += 1) {
      expect(validateDecisionPacket(packet)).toEqual([]);
    }
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
