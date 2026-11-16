import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findEarlierQuestions } from '../../../src/decisions/earlier-answers.js';
import { autoDecide } from '../../../src/onboarding/journey/auto-decide.js';
import { markChoicesReviewed } from '../../../src/onboarding/journey/choices.js';
import { findDecisionPrecedents } from '../../../src/planning/decision-precedents.js';
import { DecisionStore } from '../../../src/planning/decision-store.js';
import { updateRun } from '../../../src/onboarding/journey/run-store.js';
import { listUnjudgedDecisions } from '../../../src/rules-discovery/decisions.js';

import { PACKET_ID, PACKET_ID_2, journeyPacket } from '../onboarding/journey/fixtures/packets.js';
import { clockAt, seedRun, tempRoot } from '../onboarding/journey/fixtures/journey.js';

describe('automatic onboarding answers and same-as-last-time reuse', () => {
  let root: string;
  let store: DecisionStore;

  beforeEach(() => {
    root = tempRoot('paqad-reuse-');
    seedRun(root);
    updateRun(root, (draft) => void (draft.stages.rules_discovery = { status: 'running' }));
    vi.stubEnv('SE_SESSION', 'session-a');
    store = new DecisionStore(root);
    store.initialize();
    store.writePending(journeyPacket());
    autoDecide(root, PACKET_ID, clockAt(6));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  const later = journeyPacket({ decision_id: PACKET_ID_2 });
  const query = {
    question: later.question,
    category: later.category,
    now: new Date('2026-02-01T00:00:00.000Z'),
  };

  it('AC-9: an unreviewed automatic answer is not reused anywhere', () => {
    expect(store.findReusableDecision(later)).toBeNull();
    expect(
      findDecisionPrecedents(root, {
        decision_id: PACKET_ID_2,
        question: later.question,
        category: later.category,
      }),
    ).toEqual([]);
    expect(findEarlierQuestions(root, query)).toEqual([]);
    expect(listUnjudgedDecisions(root).map((entry) => entry.id)).not.toContain(PACKET_ID);
  });

  it('AC-9 FR-10: once a person marks it reviewed it is reused', () => {
    markChoicesReviewed(root, 'all', clockAt(7));
    expect(store.findReusableDecision(later)).toBe(PACKET_ID);
    expect(findEarlierQuestions(root, query).map((entry) => entry.id)).toContain(PACKET_ID);
    expect(listUnjudgedDecisions(root).map((entry) => entry.id)).toContain(PACKET_ID);
  });
});
