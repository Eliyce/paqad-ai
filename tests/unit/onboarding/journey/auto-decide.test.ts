import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { autoDecide } from '../../../../src/onboarding/journey/auto-decide.js';
import { readChoices } from '../../../../src/onboarding/journey/choices.js';
import { appendEvent, readEvents } from '../../../../src/onboarding/journey/events.js';
import { updateRun } from '../../../../src/onboarding/journey/run-store.js';
import { DecisionStore } from '../../../../src/planning/decision-store.js';

import { PACKET_ID, journeyPacket } from './fixtures/packets.js';
import { clockAt, seedRun, tempRoot } from './fixtures/journey.js';

describe('onboarding decide', () => {
  let root: string;
  let store: DecisionStore;

  beforeEach(() => {
    root = tempRoot();
    seedRun(root);
    updateRun(root, (draft) => void (draft.stages.rules_discovery = { status: 'running' }));
    vi.stubEnv('SE_SESSION', 'session-a');
    store = new DecisionStore(root);
    store.initialize();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('INV-8: refuses a packet another session opened while the journey ran', () => {
    vi.stubEnv('SE_SESSION', 'feature-session');
    store.writePending(journeyPacket());
    expect(readEvents(root).some((event) => event.kind === 'decision_open')).toBe(false);
    expect(() => autoDecide(root, PACKET_ID, clockAt(6))).toThrow(
      'not opened by this onboarding journey',
    );
    expect(store.readPending(PACKET_ID)).not.toBeNull();
  });

  it('INV-8: tags the packets the journey sessions open, including after a hand-over', () => {
    appendEvent(root, {
      ts: '2026-01-01T10:03:00.000Z',
      run_id: 'run-1',
      kind: 'handover',
      session: 'session-b',
      note: 'from session-a',
    });
    vi.stubEnv('SE_SESSION', 'session-b');
    store.writePending(journeyPacket());
    const tag = readEvents(root).find((event) => event.kind === 'decision_open');
    expect(tag).toMatchObject({ decision_id: PACKET_ID, stage: 'rules_discovery' });
    expect(autoDecide(root, PACKET_ID, clockAt(6)).chosen_option_key).toBe('keep-existing');
  });

  it('INV-8: tags a packet opened with no session named, as the bare journey verbs run', () => {
    vi.stubEnv('SE_SESSION', '');
    vi.stubEnv('CLAUDE_SESSION_ID', '');
    store.writePending(journeyPacket());
    expect(autoDecide(root, PACKET_ID, clockAt(6)).chosen_option_key).toBe('keep-existing');
  });

  it('INV-8: does not tag a packet opened when no journey step is running', () => {
    updateRun(root, (draft) => void (draft.stages.rules_discovery = { status: 'done' }));
    store.writePending(journeyPacket());
    expect(() => autoDecide(root, PACKET_ID, clockAt(6))).toThrow(
      'not opened by this onboarding journey',
    );
  });
});
