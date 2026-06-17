import { existsSync, mkdirSync, mkdtempSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';

import { PATHS } from '@/core/constants/paths.js';
import {
  DecisionCapExceededError,
  DecisionStore,
  readDecisionAuditEvents,
  type DecisionPacket,
  type DecisionPauseEvent,
} from '@/planning/index.js';

/** A `D-` id whose body is a 26-char Crockford-base32 ULID (issue #184). */
const ULID_DECISION_ID = /^D-[0-9A-HJKMNP-TV-Z]{26}$/;

describe('DecisionStore', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-decisions-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('initializes the decision workspace', () => {
    new DecisionStore(projectRoot).initialize();

    expect(existsSync(join(projectRoot, PATHS.DECISIONS_PENDING_DIR))).toBe(true);
    expect(existsSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR))).toBe(true);
    expect(existsSync(join(projectRoot, PATHS.DECISIONS_EXPIRED_DIR))).toBe(true);
    expect(existsSync(join(projectRoot, PATHS.DECISIONS_INDEX))).toBe(true);
    expect(existsSync(join(projectRoot, PATHS.DECISIONS_AUDIT_LOG))).toBe(true);
  });

  // Issue #184 — ids are `D-<ULID>`: collision-free, time-sortable, and never
  // derived from the directory contents.
  it('mints ULID decision ids without reading the directory or colliding', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();
    mkdirSync(join(projectRoot, PATHS.DECISIONS_PENDING_DIR), { recursive: true });
    mkdirSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR), { recursive: true });
    mkdirSync(join(projectRoot, PATHS.DECISIONS_EXPIRED_DIR), { recursive: true });
    // A high numeric id on disk must not influence allocation (the old walk
    // would have returned D-1000 here).
    writeFileSync(join(projectRoot, PATHS.DECISIONS_PENDING_DIR, 'D-2.json'), '{}');
    writeFileSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, 'D-999.json'), '{}');

    const first = store.nextDecisionId();
    const second = store.nextDecisionId();

    expect(first).toMatch(ULID_DECISION_ID);
    expect(second).toMatch(ULID_DECISION_ID);
    // Not derived from the directory's max numeric id.
    expect(first).not.toMatch(/^D-\d+$/);
    // Collision-free and lexicographically sortable in allocation order.
    expect(second).not.toBe(first);
    expect([second, first].sort()).toEqual([first, second]);
  });

  it('allocates ids lock-free and never collides across rapid calls (§12.3)', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const lockPath = join(projectRoot, PATHS.DECISIONS_LOCK);
    const ids = Array.from({ length: 50 }, () => store.nextDecisionId());

    // Every id is unique...
    expect(new Set(ids).size).toBe(ids.length);
    // ...sorting by id preserves allocation order (ULID monotonicity)...
    expect([...ids].sort()).toEqual(ids);
    // ...and allocation never touches a lock file (the walk it guarded is gone).
    expect(existsSync(lockPath)).toBe(false);
  });

  it('writes, resolves, and indexes decisions', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const packet = makePacket();
    store.writePending(packet);
    const resolvedPath = store.resolve({
      decisionId: packet.decision_id,
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });

    expect(existsSync(resolvedPath)).toBe(true);
    expect(store.findReusableDecision(packet)).toBe(packet.decision_id);
    expect(readDecisionAuditEvents(projectRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'decision-pending-written',
          decision_id: 'D-1',
          fingerprint: 'sha256:test',
          task_session_id: 'session-1',
          provider: 'codex-cli',
          category: 'component-reuse',
          chosen_option_key: null,
        }),
        expect.objectContaining({
          event: 'decision-resolved-by-human',
          decision_id: 'D-1',
          responded_by: 'haider',
          chosen_option_key: 'reuse-button',
          intent: 'explicit',
        }),
      ]),
    );
  });

  it('marks resolved decisions stale when watched files change', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();
    const watchedFile = join(projectRoot, 'src/components/Button.tsx');
    mkdirSync(join(projectRoot, 'src/components'), { recursive: true });
    writeFileSync(watchedFile, 'export const Button = 1;\n', { encoding: 'utf8' });

    const packet = makePacket({
      invalidation_watch: ['src/components/Button.tsx'],
      status: 'resolved',
      human_response: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });
    store.writePending({ ...packet, status: 'pending', human_response: undefined });
    store.resolve({
      decisionId: packet.decision_id,
      humanResponse: packet.human_response!,
    });

    utimesSync(watchedFile, new Date('2026-04-28T00:00:00Z'), new Date('2026-04-28T00:00:00Z'));
    expect(store.hasInvalidation(store.readResolved(packet.decision_id)!)).toBe(true);
  });

  it('does not reuse expired indexed decisions', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const packet = makePacket({
      ttl_until: '2000-01-01T00:00:00Z',
      human_response: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });

    store.writePending({ ...packet, status: 'pending', human_response: undefined });
    store.resolve({
      decisionId: packet.decision_id,
      humanResponse: packet.human_response!,
    });

    expect(store.findReusableDecision(packet)).toBeNull();
    expect(existsSync(join(projectRoot, PATHS.DECISIONS_EXPIRED_DIR, 'D-1.json'))).toBe(true);
  });

  it('returns null for reusable decisions with no compatible chosen option', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const packet = makePacket();
    store.writePending(packet);
    store.resolve({
      decisionId: packet.decision_id,
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });

    expect(
      store.findReusableDecision({
        fingerprint: 'sha256:other',
        category: packet.category,
        options: [
          {
            option_key: 'another-option',
            label: 'Another option',
            one_line_preview: 'If you pick this, we will update src/other.ts.',
            trade_off: 'You give up: reuse.',
            evidence: { file: 'src/other.ts', evidence_partial: true },
          },
          {
            option_key: 'make-new',
            label: 'Make new Button',
            one_line_preview: 'If you pick this, we will create src/components/ButtonV2.tsx.',
            trade_off: 'You give up: one shared place.',
            evidence: { file: 'src/components/ButtonV2.tsx', evidence_partial: true },
          },
        ],
      }),
    ).toBeNull();
  });

  it('marks older conflicting decisions as superseded', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const first = makePacket();
    store.writePending(first);
    store.resolve({
      decisionId: first.decision_id,
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });

    store.resolveExisting({
      packet: {
        ...first,
        decision_id: 'D-2',
      },
      humanResponse: {
        chosen_option_key: 'make-new',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:02:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
      event: 'decision-resolved-by-rule',
    });

    expect(store.readResolved('D-1')?.status).toBe('superseded');
    expect(store.readResolved('D-2')?.status).toBe('resolved');
    expect(readFileSync(join(projectRoot, PATHS.DECISIONS_AUDIT_LOG), 'utf8')).toContain(
      'decision-superseded',
    );
  });

  it('does not supersede a matching choice and supports delegated resolutions', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const first = makePacket();
    store.writePending(first);
    store.resolve({
      decisionId: first.decision_id,
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'delegated',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });

    store.resolveExisting({
      packet: {
        ...first,
        decision_id: 'D-2',
      },
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:02:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
      event: 'decision-resolved-by-rule',
    });

    expect(store.readResolved('D-1')?.status).toBe('delegated');
    expect(store.readResolved('D-2')?.status).toBe('resolved');
  });

  it('throws on missing pending or resolved decisions and invalid packets', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    expect(() =>
      store.resolve({
        decisionId: 'D-99',
        humanResponse: {
          chosen_option_key: 'reuse-button',
          intent: 'explicit',
          explanation_rounds_used: 0,
          responded_at: '2026-04-27T12:01:00Z',
          responded_by: 'haider',
          carry_over_scope: 'none',
        },
      }),
    ).toThrow(/Pending decision D-99 not found/);

    expect(() => store.expireResolvedDecision('D-99')).toThrow(/Resolved decision D-99 not found/);

    writeFileSync(
      join(projectRoot, PATHS.DECISIONS_PENDING_DIR, 'D-7.json'),
      '{"bad":true}',
      'utf8',
    );
    expect(() => store.readPending('D-7')).toThrow(/Decision packet at/);
  });

  it('writes memoization and undeclared-decision audit events with complete metadata', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const first = makePacket();
    store.writePending(first);
    store.resolve({
      decisionId: first.decision_id,
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });

    store.resolveExisting({
      packet: { ...first, decision_id: 'D-2' },
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:02:00Z',
        responded_by: 'paqad-system',
        carry_over_scope: 'none',
      },
      event: 'decision-resolved-by-memoization',
      respondedByProvider: 'paqad-system',
    });

    store.deferUndeclaredDecision({
      packet: makePacket({
        decision_id: 'D-3',
        requested_by: 'paqad-system',
        task_session_id: 'retroactive:planning:SL-1',
      }),
      provider: 'paqad-system',
    });

    expect(readDecisionAuditEvents(projectRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'decision-resolved-by-memoization',
          decision_id: 'D-2',
          fingerprint: 'sha256:test',
          provider: 'paqad-system',
          responded_by: 'paqad-system',
          chosen_option_key: 'reuse-button',
        }),
        expect.objectContaining({
          event: 'undeclared-decision-flagged',
          decision_id: 'D-3',
          task_session_id: 'retroactive:planning:SL-1',
          provider: 'paqad-system',
        }),
      ]),
    );
  });

  it('rejects writes for packets that fail the copy linter', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    expect(() =>
      store.writePending(
        makePacket({
          question:
            'Should we now choose the extraordinarily complicated implementation path for this dashboard button flow with extra coordination overhead today?',
        }),
      ),
    ).toThrow(/failed copy lint/);
  });

  it('rejects a second pending decision for the same task and reports malformed pending results', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const first = makePacket({ decision_id: 'D-1', task_session_id: 'session-1' });
    const second = makePacket({ decision_id: 'D-2', task_session_id: 'session-1' });
    store.writePending(first);

    expect(() => store.writePending(second)).toThrow(/already has a pending decision/);
    expect(store.findPendingDecisionForTask('session-1')).toBe('D-1');

    writeFileSync(join(projectRoot, PATHS.DECISIONS_PENDING_DIR, 'D-9.json'), '{bad', 'utf8');
    const malformed = store.readPendingResult('D-9');
    expect(malformed.packet).toBeNull();
    expect(malformed.error).toMatch(/Unexpected end of JSON input|Expected property name/);
    store.deletePending('D-9');
    expect(store.readPendingResult('D-9')).toEqual({ packet: null });
  });

  it('reuses similar option sets, ignores multi-file malformed fallback, and covers missing reusable packets', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    expect(store.listPendingDecisionIds()).toEqual([]);
    expect(store.findPendingDecisionForTask('missing')).toBeNull();

    const packet = makePacket();
    store.writePending(packet);
    store.resolve({
      decisionId: packet.decision_id,
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });

    writeFileSync(join(projectRoot, PATHS.DECISIONS_PENDING_DIR, 'D-9.json'), '{bad', 'utf8');
    writeFileSync(join(projectRoot, PATHS.DECISIONS_PENDING_DIR, 'D-10.json'), '{bad', 'utf8');
    expect(store.findPendingDecisionForTask('another-session')).toBeNull();

    expect(
      store.findReusableDecision({
        fingerprint: 'sha256:other',
        category: packet.category,
        options: [
          packet.options[1]!,
          {
            option_key: 'reuse-button',
            label: 'Reuse Button',
            one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
            trade_off: 'You give up: a fresh design.',
            evidence: { file: 'src/components/Button.tsx', callers: 3, similarity: 0.9 },
          },
        ],
      }),
    ).toBe('D-1');

    const missingResolved = makePacket({ decision_id: 'D-4', fingerprint: 'sha256:missing' });
    store.writePending(missingResolved);
    store.resolve({
      decisionId: missingResolved.decision_id,
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });
    unlinkSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, 'D-4.json'));
    expect(
      store.findReusableDecision({
        ...missingResolved,
        options: [
          {
            option_key: 'different-a',
            label: 'Different option',
            one_line_preview: 'If you pick this, we will update src/different-a.ts.',
            trade_off: 'You give up: reuse.',
            evidence: { file: 'src/different-a.ts', evidence_partial: true },
          },
          {
            option_key: 'different-b',
            label: 'Another option',
            one_line_preview: 'If you pick this, we will update src/different-b.ts.',
            trade_off: 'You give up: reuse.',
            evidence: { file: 'src/different-b.ts', evidence_partial: true },
          },
        ],
      }),
    ).toBeNull();
  });

  it('covers delegated null-choice and no-response invalidation branches', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const delegated = makePacket({ decision_id: 'D-20' });
    store.writePending(delegated);
    store.resolve({
      decisionId: delegated.decision_id,
      humanResponse: {
        chosen_option_key: null,
        intent: 'delegated',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });
    expect(store.findReusableDecision(delegated)).toBeNull();
    expect(
      store.hasInvalidation(
        makePacket({
          decision_id: 'D-21',
          status: 'resolved',
          human_response: undefined,
        }),
      ),
    ).toBe(false);
  });

  it('covers single-malformed fallback, invalid status reuse, invalid packet writes, missing directories, and missing supersede targets', () => {
    const bareRoot = mkdtempSync(join(tmpdir(), 'paqad-decisions-bare-'));
    try {
      const bareStore = new DecisionStore(bareRoot);
      expect(bareStore.nextDecisionId()).toMatch(ULID_DECISION_ID);
      mkdirSync(join(bareRoot, PATHS.DECISIONS_PENDING_DIR), { recursive: true });
      writeFileSync(join(bareRoot, PATHS.DECISIONS_PENDING_DIR, 'D-9.json'), '{bad', 'utf8');
      expect(bareStore.findPendingDecisionForTask('missing')).toBe('D-9');
    } finally {
      rmSync(bareRoot, { recursive: true, force: true });
    }

    const store = new DecisionStore(projectRoot);
    store.initialize();

    expect(() => store.writePending({ bad: true } as unknown as DecisionPacket)).toThrow(
      /is invalid/,
    );

    const invalidStatusPacket = makePacket({
      decision_id: 'D-30',
      fingerprint: 'sha256:superseded',
      status: 'superseded',
      human_response: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });
    mkdirSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR), { recursive: true });
    writeFileSync(
      join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, 'D-30.json'),
      JSON.stringify(invalidStatusPacket),
      'utf8',
    );
    writeFileSync(
      join(projectRoot, PATHS.DECISIONS_INDEX),
      JSON.stringify({
        fingerprints: { 'sha256:superseded': 'D-30' },
        decisions: {
          'D-30': {
            decision_id: 'D-30',
            fingerprint: 'sha256:superseded',
            category: 'component-reuse',
            chosen_option_key: 'reuse-button',
            responded_at: '2026-04-27T12:01:00Z',
            status: 'superseded',
            option_keys: ['reuse-button', 'make-new'],
          },
        },
      }),
      'utf8',
    );
    expect(store.findReusableDecision(invalidStatusPacket)).toBeNull();

    writeFileSync(
      join(projectRoot, PATHS.DECISIONS_INDEX),
      JSON.stringify({
        fingerprints: { 'sha256:ghost': 'D-99' },
        decisions: {
          'D-99': {
            decision_id: 'D-99',
            fingerprint: 'sha256:ghost',
            category: 'component-reuse',
            chosen_option_key: 'reuse-button',
            responded_at: '2026-04-27T12:01:00Z',
            status: 'resolved',
            option_keys: ['reuse-button', 'make-new'],
          },
        },
      }),
      'utf8',
    );
    expect(
      store.resolveExisting({
        packet: makePacket({ decision_id: 'D-31', fingerprint: 'sha256:ghost' }),
        humanResponse: {
          chosen_option_key: 'make-new',
          intent: 'explicit',
          explanation_rounds_used: 0,
          responded_at: '2026-04-27T12:02:00Z',
          responded_by: 'haider',
          carry_over_scope: 'none',
        },
        event: 'decision-resolved-by-rule',
      }),
    ).toContain('D-31.json');
  });

  it('expires invalidated reusable decisions during reuse lookup', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();
    mkdirSync(join(projectRoot, 'src/components'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/components/Button.tsx'),
      'export const Button = 1;\n',
      'utf8',
    );

    const packet = makePacket({
      decision_id: 'D-40',
      fingerprint: 'sha256:invalidate',
      invalidation_watch: ['src/components/Button.tsx'],
    });
    store.writePending(packet);
    store.resolve({
      decisionId: packet.decision_id,
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });

    utimesSync(
      join(projectRoot, 'src/components/Button.tsx'),
      new Date('2026-04-28T00:00:00Z'),
      new Date('2026-04-28T00:00:00Z'),
    );

    expect(store.findReusableDecision(packet)).toBeNull();
    expect(existsSync(join(projectRoot, PATHS.DECISIONS_EXPIRED_DIR, 'D-40.json'))).toBe(true);
  });

  it('prefers the higher-overlap reusable decision and reports non-Error malformed reads', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const broadPacket = makePacket({
      decision_id: 'D-50',
      fingerprint: 'sha256:broad',
      options: [
        makePacket().options[0]!,
        makePacket().options[1]!,
        {
          option_key: 'option-c',
          label: 'Use option c',
          one_line_preview: 'If you pick this, we will update src/c.ts.',
          trade_off: 'You give up: reuse.',
          evidence: { file: 'src/c.ts', evidence_partial: true },
        },
        {
          option_key: 'option-d',
          label: 'Use option d',
          one_line_preview: 'If you pick this, we will update src/d.ts.',
          trade_off: 'You give up: reuse.',
          evidence: { file: 'src/d.ts', evidence_partial: true },
        },
      ],
    });
    store.resolveExisting({
      packet: { ...broadPacket, status: 'pending' },
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
      event: 'decision-resolved-by-rule',
    });

    const exactPacket = makePacket({
      decision_id: 'D-51',
      fingerprint: 'sha256:exact',
      options: [
        ...broadPacket.options,
        {
          option_key: 'option-e',
          label: 'Use option e',
          one_line_preview: 'If you pick this, we will update src/e.ts.',
          trade_off: 'You give up: reuse.',
          evidence: { file: 'src/e.ts', evidence_partial: true },
        },
      ],
    });
    store.resolveExisting({
      packet: { ...exactPacket, status: 'pending' },
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:02:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
      event: 'decision-resolved-by-rule',
    });

    expect(
      store.findReusableDecision({
        fingerprint: 'sha256:candidate',
        category: exactPacket.category,
        options: exactPacket.options,
      }),
    ).toBe('D-51');

    writeFileSync(
      join(projectRoot, PATHS.DECISIONS_PENDING_DIR, 'D-99.json'),
      '{"ok":true}',
      'utf8',
    );
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'string-error';
    });
    expect(store.readPendingResult('D-99')).toEqual({
      packet: null,
      error: 'string-error',
    });
    parseSpy.mockRestore();

    store.resolveExisting({
      packet: makePacket({ decision_id: 'D-60', fingerprint: 'sha256:no-response' }),
      humanResponse: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_by: 'haider',
        carry_over_scope: 'none',
      } as unknown as DecisionPacket['human_response'] & {
        chosen_option_key: 'reuse-button';
        intent: 'explicit';
        explanation_rounds_used: 0;
        responded_by: 'haider';
        carry_over_scope: 'none';
      },
      event: 'decision-resolved-by-rule',
    });
    expect(readFileSync(join(projectRoot, PATHS.DECISIONS_INDEX), 'utf8')).toContain(
      '"responded_at": "2026-04-27T12:00:00Z"',
    );
  });

  describe('PQD-101 decision-pause events', () => {
    it('emits decision-paused with the full packet and a project-relative path on writePending', () => {
      const events: DecisionPauseEvent[] = [];
      const store = new DecisionStore(projectRoot, { onEvent: (event) => events.push(event) });
      store.initialize();

      store.writePending(makePacket());

      const paused = events.find((event) => event.kind === 'decision-paused');
      expect(paused).toMatchObject({
        kind: 'decision-paused',
        decisionId: 'D-1',
        question: 'Use the Button we have?',
        recommendation: null,
        packetPath: `${PATHS.DECISIONS_PENDING_DIR}/D-1.json`,
      });
      expect(paused?.kind === 'decision-paused' && paused.options).toHaveLength(2);
      // path must be relative — never leak an absolute (home-dir) path
      expect(paused?.kind === 'decision-paused' && paused.packetPath?.startsWith('/')).toBe(false);
    });

    it('emits decision-resolved with the chosen option, resolver, and intent on resolve', () => {
      const events: DecisionPauseEvent[] = [];
      const store = new DecisionStore(projectRoot, { onEvent: (event) => events.push(event) });
      store.initialize();
      const packet = makePacket();
      store.writePending(packet);

      store.resolve({
        decisionId: packet.decision_id,
        humanResponse: {
          chosen_option_key: 'reuse-button',
          intent: 'explicit',
          explanation_rounds_used: 0,
          responded_at: '2026-04-27T12:01:00Z',
          responded_by: 'haider',
          carry_over_scope: 'none',
        },
      });

      const resolved = events.find((event) => event.kind === 'decision-resolved');
      expect(resolved).toMatchObject({
        kind: 'decision-resolved',
        decisionId: 'D-1',
        chosenOptionKey: 'reuse-button',
        resolver: 'human',
        intent: 'explicit',
      });
    });

    it('maps resolveExisting audit events to resolver tokens', () => {
      const events: DecisionPauseEvent[] = [];
      const store = new DecisionStore(projectRoot, { onEvent: (event) => events.push(event) });
      store.initialize();

      store.resolveExisting({
        packet: makePacket(),
        event: 'decision-resolved-by-rag-confident',
        humanResponse: {
          chosen_option_key: 'reuse-button',
          intent: 'safer-default',
          explanation_rounds_used: 0,
          responded_at: '2026-04-27T12:01:00Z',
          responded_by: 'paqad-system',
          carry_over_scope: 'none',
        },
      });

      const resolved = events.find((event) => event.kind === 'decision-resolved');
      expect(resolved?.kind === 'decision-resolved' && resolved.resolver).toBe('rag-confident');
    });

    it('refuses a new pending packet past the cap and emits decision-cap-exceeded', () => {
      const events: DecisionPauseEvent[] = [];
      const store = new DecisionStore(projectRoot, { onEvent: (event) => events.push(event) });
      store.initialize();
      // Fill to the (low, profile-driven) cap.
      writeProfileMaxPending(projectRoot, 2);
      store.writePending(makePacket({ decision_id: 'D-1', task_session_id: 's-1' }));
      store.writePending(makePacket({ decision_id: 'D-2', task_session_id: 's-2' }));

      expect(() =>
        store.writePending(makePacket({ decision_id: 'D-3', task_session_id: 's-3' })),
      ).toThrow(DecisionCapExceededError);

      const capped = events.find((event) => event.kind === 'decision-cap-exceeded');
      expect(capped).toMatchObject({ kind: 'decision-cap-exceeded', pendingCount: 2, cap: 2 });
      // The refused packet must not have been written.
      expect(existsSync(join(projectRoot, PATHS.DECISIONS_PENDING_DIR, 'D-3.json'))).toBe(false);
    });

    it('re-writing an already-pending packet never trips the cap', () => {
      const store = new DecisionStore(projectRoot);
      store.initialize();
      writeProfileMaxPending(projectRoot, 1);
      store.writePending(makePacket({ decision_id: 'D-1' }));
      // Same id, same task — a refresh, not a new pause.
      expect(() => store.writePending(makePacket({ decision_id: 'D-1' }))).not.toThrow();
    });

    it('discards a pending packet: file removed, audit appended, no resolved entry, event emitted', () => {
      const events: DecisionPauseEvent[] = [];
      const store = new DecisionStore(projectRoot, { onEvent: (event) => events.push(event) });
      store.initialize();
      const packet = makePacket();
      store.writePending(packet);

      const removed = store.discard({
        decisionId: packet.decision_id,
        reason: 'no longer relevant',
      });

      expect(removed.decision_id).toBe('D-1');
      expect(existsSync(join(projectRoot, PATHS.DECISIONS_PENDING_DIR, 'D-1.json'))).toBe(false);
      expect(existsSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, 'D-1.json'))).toBe(false);
      const audit = readDecisionAuditEvents(projectRoot);
      expect(audit.some((event) => event.event === 'decision-discarded')).toBe(true);
      const discarded = events.find((event) => event.kind === 'decision-discarded');
      expect(discarded).toMatchObject({
        kind: 'decision-discarded',
        decisionId: 'D-1',
        reason: 'no longer relevant',
      });
    });

    it('throws when discarding a decision with no valid pending packet', () => {
      const store = new DecisionStore(projectRoot);
      store.initialize();
      expect(() => store.discard({ decisionId: 'D-99', reason: 'gone' })).toThrow(
        /no valid pending packet/,
      );
    });
  });
});

function writeProfileMaxPending(projectRoot: string, maxPending: number): void {
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.paqad', 'project-profile.yaml'),
    `custom:\n  decisions:\n    max_pending: ${maxPending}\n`,
  );
}

function makePacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
  return {
    decision_id: 'D-1',
    fingerprint: 'sha256:test',
    category: 'component-reuse',
    question: 'Use the Button we have?',
    context: 'We are adding a dashboard action.',
    options: [
      {
        option_key: 'reuse-button',
        label: 'Reuse Button',
        one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
        trade_off: 'You give up: a fresh design.',
        evidence: { file: 'src/components/Button.tsx', callers: 3, similarity: 0.9 },
      },
      {
        option_key: 'make-new',
        label: 'Make new Button',
        one_line_preview: 'If you pick this, we will create src/components/ButtonV2.tsx.',
        trade_off: 'You give up: one shared place.',
        evidence: { file: 'src/components/ButtonV2.tsx', evidence_partial: true },
      },
    ],
    confidence: 0.72,
    requested_by: 'codex-cli',
    task_session_id: 'session-1',
    created_at: '2026-04-27T12:00:00Z',
    status: 'pending',
    ttl_until: '2099-12-31T12:00:00Z',
    invalidation_watch: [],
    ...overrides,
  };
}
