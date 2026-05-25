import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildRepoStateForIntake, findIntakePriorMatch } from '@/planning/intake-prior-resolver.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { computeDecisionFingerprint } from '@/planning/decision-fingerprint.js';
import type { DecisionOption, DecisionPacket } from '@/planning/decision-packet.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-intake-prior-'));
}

function makeOptions(): DecisionOption[] {
  return [
    {
      option_key: 'yes',
      label: 'Yes',
      one_line_preview: 'Open a PR now.',
      trade_off: 'You give up: more polishing time.',
      evidence: {},
    },
    {
      option_key: 'no',
      label: 'No',
      one_line_preview: 'Hold the PR for now.',
      trade_off: 'You give up: faster review.',
      evidence: {},
    },
  ];
}

describe('intake-prior-resolver', () => {
  it('returns null when no prior matches the fingerprint', () => {
    const projectRoot = tempProject();
    new DecisionStore(projectRoot).initialize();

    const match = findIntakePriorMatch(projectRoot, {
      category: 'delivery.open_pr',
      question: 'Open a pull request now (yes / draft / no)?',
      options: makeOptions(),
      repoState: buildRepoStateForIntake(['content'], 'laravel', []),
    });

    expect(match).toBeNull();
  });

  it('reuses a prior resolved decision when fingerprints match', () => {
    const projectRoot = tempProject();
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const options = makeOptions();
    const fingerprint = computeDecisionFingerprint({
      category: 'delivery.open_pr',
      question: 'Open a pull request now (yes / draft / no)?',
      option_keys: options.map((option) => option.option_key),
      repo_state: buildRepoStateForIntake(['content'], 'laravel', []),
    });
    const now = new Date().toISOString();
    const futureTtl = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const priorPacket: DecisionPacket = {
      decision_id: 'D-42',
      fingerprint,
      category: 'delivery.open_pr',
      question: 'Open a pull request now (yes / draft / no)?',
      context: 'Prior context.',
      options,
      recommendation: 'yes',
      recommendation_reason: 'Safer to open the PR.',
      confidence: 0.9,
      requested_by: 'agent',
      task_session_id: 'session-1',
      created_at: now,
      status: 'resolved',
      ttl_until: futureTtl,
      invalidation_watch: [],
      human_response: {
        chosen_option_key: 'yes',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: now,
        responded_by: 'user',
        carry_over_scope: 'task',
      },
    };

    // Mirror the file shape that the DecisionStore expects.
    mkdirSync(join(projectRoot, '.paqad/decisions/resolved'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad/decisions/resolved/D-42.json'),
      JSON.stringify(priorPacket, null, 2),
    );
    // Register the fingerprint in the index so the lookup hits the exact-match path.
    writeFileSync(
      join(projectRoot, '.paqad/decisions/index.json'),
      JSON.stringify(
        {
          fingerprints: { [fingerprint]: 'D-42' },
          decisions: {
            'D-42': {
              decision_id: 'D-42',
              fingerprint,
              category: 'delivery.open_pr',
              chosen_option_key: 'yes',
              responded_at: now,
              status: 'resolved',
              option_keys: ['yes', 'no'],
            },
          },
        },
        null,
        2,
      ),
    );

    const match = findIntakePriorMatch(projectRoot, {
      category: 'delivery.open_pr',
      question: 'Open a pull request now (yes / draft / no)?',
      options,
      repoState: buildRepoStateForIntake(['content'], 'laravel', []),
    });

    expect(match).not.toBeNull();
    expect(match!.priorDecisionId).toBe('D-42');
    expect(match!.chosenOptionKey).toBe('yes');
    expect(match!.rationale).toContain('D-42');
  });
});
