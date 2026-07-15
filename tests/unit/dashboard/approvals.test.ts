import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  acceptModuleProposal,
  ApprovalConflictError,
  ApprovalNotFoundError,
  buildApprovalsFeed,
  rejectModuleProposal,
  resolvePauseDecision,
} from '@/dashboard/approvals.js';
import { readDecision, writeDecision } from '@/module-decisions/store.js';
import type { ModuleDecision } from '@/module-decisions/schema.js';
import { DecisionStore } from '@/planning/decision-store.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';

// Issue #387 — packets written through DecisionStore.writePending must carry a strict
// `D-<ULID>` id. The corrupt-packet test below writes a legacy `D-1.json` straight to disk
// on purpose, proving the read/resolve path stays tolerant of legacy ids.
const WID = 'D-01J000000000000000000000A1';
const WID2 = 'D-01J000000000000000000000A2';

function makePacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
  return {
    decision_id: WID,
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

function makeProposal(over: Partial<ModuleDecision> = {}): ModuleDecision {
  return {
    id: 'MD-0001',
    state: 'proposed',
    proposed_slug: 'payments',
    proposed_name: 'Payments',
    proposed_layer: null,
    proposed_features: [],
    source_of_decision: {
      type: 'pasted-ticket',
      prompt_excerpt: 'add a payments adapter',
      detected_at: '2026-05-28T00:00:00.000Z',
    },
    confidence: 'medium',
    reasoning: 'Prompt names a module that is not on the map.',
    disposition: { collision_with: null, alternatives_offered: [] },
    created_at: '2026-05-28T00:00:00.000Z',
    updated_at: '2026-05-28T00:00:00.000Z',
    expires_at: '2099-12-31T00:00:00.000Z',
    approved_by: null,
    applied_to_map_at: null,
    applied_to_map_commit: null,
    events_log_ref: null,
    ...over,
  };
}

describe('dashboard approvals', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-approvals-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('buildApprovalsFeed', () => {
    it('returns an empty feed on a project with no decisions', () => {
      const feed = buildApprovalsFeed(root);
      expect(feed.pauses).toEqual([]);
      expect(feed.proposals).toEqual([]);
      expect(feed.pendingCount).toBe(0);
    });

    it('unifies pending pauses and proposed module decisions, newest first', () => {
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket({ decision_id: WID, created_at: '2026-04-27T12:00:00Z' }));
      store.writePending(
        makePacket({
          decision_id: WID2,
          fingerprint: 'sha256:test-2',
          task_session_id: 'session-2',
          created_at: '2026-04-28T12:00:00Z',
        }),
      );
      writeDecision(root, makeProposal());

      const feed = buildApprovalsFeed(root);
      expect(feed.pauses.map((p) => p.id)).toEqual([WID2, WID]);
      expect(feed.pauses[0]).toMatchObject({
        kind: 'pause',
        category: 'component-reuse',
        question: 'Use the Button we have?',
        recommendation: null,
        requested_by: 'codex-cli',
      });
      expect(feed.pauses[0].options[0]).toEqual({
        option_key: 'reuse-button',
        label: 'Reuse Button',
        one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
        trade_off: 'You give up: a fresh design.',
      });
      expect(feed.proposals).toHaveLength(1);
      expect(feed.proposals[0]).toMatchObject({
        kind: 'module-proposal',
        id: 'MD-0001',
        proposed_slug: 'payments',
        confidence: 'medium',
        prompt_excerpt: 'add a payments adapter',
      });
      expect(feed.pendingCount).toBe(3);
    });

    it('skips corrupt pause packets and expired proposals', () => {
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());
      writeFileSync(join(root, PATHS.DECISIONS_PENDING_DIR, 'D-9.json'), '{not json');
      writeDecision(root, makeProposal({ expires_at: '2020-01-01T00:00:00.000Z' }));

      const feed = buildApprovalsFeed(root);
      expect(feed.pauses.map((p) => p.id)).toEqual([WID]);
      expect(feed.proposals).toEqual([]);
      expect(feed.pendingCount).toBe(1);
    });
  });

  describe('resolvePauseDecision', () => {
    it('resolves through the agent store and audits the dashboard actor', () => {
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());

      const result = resolvePauseDecision(root, {
        decisionId: WID,
        chosenOptionKey: 'reuse-button',
        note: 'looks right',
      });

      expect(result).toEqual({
        id: WID,
        status: 'resolved',
        chosen_option_key: 'reuse-button',
      });
      expect(store.readPending(WID)).toBeNull();
      const resolved = store.readResolved(WID);
      expect(resolved?.status).toBe('resolved');
      expect(resolved?.human_response).toMatchObject({
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        responded_by: 'dashboard',
        note: 'looks right',
      });
      const audit = readFileSync(join(root, PATHS.AUDIT_LOG), 'utf8');
      expect(audit).toMatch(/dashboard-decision-resolved/);
      expect(audit).toMatch(/actor="dashboard"/);
      expect(audit).toMatch(new RegExp(`decision_id="${WID}"`));
    });

    it('throws ApprovalNotFoundError for an unknown id', () => {
      new DecisionStore(root).initialize();
      expect(() =>
        resolvePauseDecision(root, { decisionId: 'D-404', chosenOptionKey: 'reuse-button' }),
      ).toThrow(ApprovalNotFoundError);
    });

    it('throws ApprovalConflictError for an option the packet does not offer', () => {
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());
      expect(() =>
        resolvePauseDecision(root, { decisionId: WID, chosenOptionKey: 'nope' }),
      ).toThrow(ApprovalConflictError);
      // and the packet is still pending
      expect(store.readPending(WID)).not.toBeNull();
    });

    it('throws ApprovalConflictError when the pending packet is corrupt', () => {
      const store = new DecisionStore(root);
      store.initialize();
      writeFileSync(join(root, PATHS.DECISIONS_PENDING_DIR, 'D-1.json'), '{"decision_id":"D-1"}');
      expect(() =>
        resolvePauseDecision(root, { decisionId: 'D-1', chosenOptionKey: 'reuse-button' }),
      ).toThrow(ApprovalConflictError);
    });
  });

  describe('module proposal transitions', () => {
    it('accepts a proposed decision, records the actor, and appends the map event', () => {
      writeDecision(root, makeProposal());

      const result = acceptModuleProposal(root, 'MD-0001');

      expect(result).toEqual({ id: 'MD-0001', state: 'accepted', proposed_slug: 'payments' });
      const updated = readDecision(root, 'MD-0001');
      expect(updated?.state).toBe('accepted');
      expect(updated?.approved_by).toBe('dashboard');
      const events = readFileSync(join(root, PATHS.MODULE_MAP_EVENTS_LOG), 'utf8');
      expect(events).toMatch(/"type":"module.declared"/);
      expect(events).toMatch(/"via":"MD-0001"/);
      const audit = readFileSync(join(root, PATHS.AUDIT_LOG), 'utf8');
      expect(audit).toMatch(/dashboard-module-proposal-accepted/);
    });

    it('rejects a proposed decision without claiming approval', () => {
      writeDecision(root, makeProposal());

      const result = rejectModuleProposal(root, 'MD-0001');

      expect(result.state).toBe('rejected');
      const updated = readDecision(root, 'MD-0001');
      expect(updated?.state).toBe('rejected');
      expect(updated?.approved_by).toBeNull();
      const events = readFileSync(join(root, PATHS.MODULE_MAP_EVENTS_LOG), 'utf8');
      expect(events).toMatch(/"type":"module.decision.rejected"/);
    });

    it('throws ApprovalNotFoundError for a missing proposal', () => {
      expect(() => acceptModuleProposal(root, 'MD-9999')).toThrow(ApprovalNotFoundError);
    });

    it('throws ApprovalConflictError on an illegal state transition', () => {
      writeDecision(root, makeProposal({ state: 'rejected' }));
      expect(() => acceptModuleProposal(root, 'MD-0001')).toThrow(ApprovalConflictError);
      expect(existsSync(join(root, PATHS.MODULE_MAP_EVENTS_LOG))).toBe(false);
    });
  });
});
