import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { autoDecide } from '../../../../src/onboarding/journey/auto-decide.js';
import { readChoices } from '../../../../src/onboarding/journey/choices.js';
import { DecisionStore } from '../../../../src/planning/decision-store.js';

import { PACKET_ID, journeyPacket } from './fixtures/packets.js';
import { clockAt, seedRun, tempRoot } from './fixtures/journey.js';

describe('onboarding decide', () => {
  let root: string;
  let store: DecisionStore;

  beforeEach(() => {
    root = tempRoot();
    seedRun(root);
    store = new DecisionStore(root);
    store.initialize();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('INV-8: answers a journey packet with its recommendation, delegated, and records a choice', () => {
    store.writePending(journeyPacket());
    const decided = autoDecide(root, PACKET_ID, clockAt(6));
    expect(decided.chosen_option_key).toBe('keep-existing');
    const resolved = store.readResolved(PACKET_ID);
    expect(resolved?.human_response?.responded_by).toBe('paqad-onboarding');
    expect(resolved?.human_response?.intent).toBe('delegated');
    const row = readChoices(root).find((choice) => choice.decision_id === PACKET_ID);
    expect(row?.by).toBe('paqad-onboarding');
    expect(row?.reviewed).toBeUndefined();
  });

  it('records "no earlier answer fits" before resolving when the earlier check is required', () => {
    store.writePending(journeyPacket({ earlier_check: { status: 'required', candidates: [] } }));
    autoDecide(root, PACKET_ID, clockAt(6));
    expect(store.readResolved(PACKET_ID)?.earlier_check?.status).toBe('done');
  });

  it('refuses a packet opened before the journey and one with no recommendation', () => {
    store.writePending(journeyPacket({ created_at: '2025-01-01T00:00:00.000Z' }));
    expect(() => autoDecide(root, PACKET_ID, clockAt(6))).toThrow('before this journey');
    store.deletePending(PACKET_ID);
    store.writePending(journeyPacket({ recommendation: null }));
    expect(() => autoDecide(root, PACKET_ID, clockAt(6))).toThrow('no recommended option');
  });
});
