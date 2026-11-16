import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendChoice,
  markChoicesReviewed,
  readChoices,
  unreviewedAutoDecisionIds,
} from '../../../../src/onboarding/journey/choices.js';

import { T0, clockAt, tempRoot } from './fixtures/journey.js';

describe('journey choices log', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function autoChoice(decisionId: string) {
    return appendChoice(root, {
      ts: T0,
      run_id: 'run-1',
      stage: 'rules_analyze',
      kind: 'decision',
      choice: 'recommended',
      reason: 'onboarding journey says auto-recommended',
      by: 'paqad-onboarding',
      decision_id: decisionId,
    });
  }

  it('FR-12: appends numbered rows and lists them', () => {
    expect(autoChoice('D-1').id).toBe('C-1');
    expect(autoChoice('D-2').id).toBe('C-2');
    expect(readChoices(root).map((row) => row.decision_id)).toEqual(['D-1', 'D-2']);
  });

  it('AC-9: unreviewed automatic decisions are listed until a person marks them reviewed', () => {
    autoChoice('D-1');
    autoChoice('D-2');
    expect([...unreviewedAutoDecisionIds(root)]).toEqual(['D-1', 'D-2']);
    const marked = markChoicesReviewed(root, ['C-1'], clockAt(3));
    expect(marked.map((row) => row.id)).toEqual(['C-1']);
    expect(marked[0]?.reviewed_at).toBe('2026-01-01T10:03:00.000Z');
    expect([...unreviewedAutoDecisionIds(root)]).toEqual(['D-2']);
    markChoicesReviewed(root, 'all', clockAt(4));
    expect(unreviewedAutoDecisionIds(root).size).toBe(0);
  });

  it('FR-7: rows answered by the tray or attested by the agent are never auto decisions', () => {
    appendChoice(root, {
      ts: T0,
      run_id: 'run-1',
      stage: 'start',
      kind: 'asked',
      choice: 'claude-code',
      reason: 'the agent says the person answered',
      by: 'agent-attested',
      decision_id: 'D-9',
    });
    expect(unreviewedAutoDecisionIds(root).size).toBe(0);
  });
});
