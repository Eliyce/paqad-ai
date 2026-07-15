import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isDecisionPacket, validateDecisionPacket } from '@/planning/decision-packet.js';
import { decisionQuestionForCategory } from '@/planning/decision-packet-builder.js';
import { defaultSimilarityFor } from '@/planning/decision-evidence.js';
import { DecisionStore, readDecisionAuditEvents } from '@/planning/index.js';
import {
  TRIAGE_DECISION_OPTION_TO_PILE,
  buildFindingTriagePacket,
  verdictFromTriageOption,
} from '@/triage/finding-triage-decision.js';

const BASE = {
  finding_id: 'F-1',
  kind: 'error-handling-style',
  task_session_id: 'sess-1',
  created_at: '2026-06-08T00:00:00Z',
};

// Issue #387 — a packet written through DecisionStore.writePending must carry a strict
// `D-<ULID>` id. The builder unit tests keep legacy `D-1`/`D-2` ids (validate-only, never
// written) to prove read tolerance stays intact.
const WRITTEN_ID = 'D-01J000000000000000000000A1';

describe('buildFindingTriagePacket', () => {
  it('produces a valid finding.triage packet with the four stable pile options', () => {
    const packet = buildFindingTriagePacket({ ...BASE, decision_id: 'D-1', detail: 'detail' });
    expect(validateDecisionPacket(packet)).toEqual([]);
    expect(isDecisionPacket(packet)).toBe(true);
    expect(packet.category).toBe('finding.triage');
    expect(packet.options.map((o) => o.option_key)).toEqual([
      'confirmed-problem',
      'unclear-spec',
      'false-alarm',
      'taste',
    ]);
    // ttl_days for finding.triage is 30.
    expect(packet.ttl_until).toBe('2026-07-08T00:00:00.000Z');
  });

  it('fingerprints by kind so the same kind shares a fingerprint regardless of detail', () => {
    const a = buildFindingTriagePacket({ ...BASE, decision_id: 'D-1', detail: 'first' });
    const b = buildFindingTriagePacket({
      ...BASE,
      decision_id: 'D-2',
      finding_id: 'F-99',
      detail: 'second, same kind',
    });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('exposes the category in the generic builder switches (typecheck guards)', () => {
    expect(decisionQuestionForCategory('finding.triage')).toContain('pile');
    expect(defaultSimilarityFor('finding.triage', true, 0)).toBe(0.5);
  });
});

describe('verdictFromTriageOption maps each pile back to a verdict', () => {
  it('maps every stable option key to its pile', () => {
    expect(TRIAGE_DECISION_OPTION_TO_PILE).toEqual({
      'confirmed-problem': 'confirmed',
      'unclear-spec': 'unclear-spec',
      'false-alarm': 'false-alarm',
      taste: 'taste',
    });
  });

  it('a human-confirmed problem still hands off to prove-it (#103) — needs-repro, no direct change', () => {
    const v = verdictFromTriageOption('F-1', 'confirmed-problem');
    expect(v.pile).toBe('confirmed');
    expect(v.confirmation).toBe('needs-repro');
    expect(v.route).toBe('await-repro');
  });

  it('maps unclear-spec, false-alarm and taste to their routes', () => {
    expect(verdictFromTriageOption('F-1', 'unclear-spec').route).toBe('spec');
    expect(verdictFromTriageOption('F-1', 'false-alarm').route).toBe('record');
    expect(verdictFromTriageOption('F-1', 'taste').route).toBe('record');
  });
});

describe('finding.triage reuse by kind (settle once, never re-raise)', () => {
  let projectRoot: string;

  beforeEach(() => {
    // Freeze the clock inside the packet's 30-day TTL window (created_at 2026-06-08)
    // so reuse is deterministic regardless of the real date — otherwise the fixture
    // rots the day its TTL lapses. Only Date is faked, so fs/timers are untouched.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T00:00:00.000Z'));
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-triage-decision-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reuses a same-kind taste verdict via fuzzy match and emits decision-reused', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const first = buildFindingTriagePacket({
      ...BASE,
      decision_id: WRITTEN_ID,
      detail: 'case one',
    });
    store.writePending(first);
    store.resolve({
      decisionId: WRITTEN_ID,
      humanResponse: {
        chosen_option_key: 'taste',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-06-08T01:00:00Z',
        responded_by: 'human',
        carry_over_scope: 'task',
      },
    });

    // A later finding of the SAME kind but different detail must not be re-raised.
    const second = buildFindingTriagePacket({
      ...BASE,
      decision_id: 'D-2',
      finding_id: 'F-2',
      detail: 'case two, same kind',
    });
    expect(store.findReusableDecision(second)).toBe(WRITTEN_ID);

    const resolved = store.readResolved(WRITTEN_ID);
    expect(resolved?.human_response?.chosen_option_key).toBe('taste');
    const reusedVerdict = verdictFromTriageOption(
      'F-2',
      resolved!.human_response!.chosen_option_key!,
    );
    expect(reusedVerdict.pile).toBe('taste');

    const reuseEvents = readDecisionAuditEvents(projectRoot).filter(
      (event) => event.event === 'decision-reused',
    );
    expect(reuseEvents).toHaveLength(1);
  });
});
