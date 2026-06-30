import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aggregateSiemEvents } from '@/audit/aggregate';
import type { SiemEvent } from '@/audit/types';
import { appendEvidenceRows, buildEvidenceRow } from '@/evidence/ledger';
import { recordDeliveryEvidence } from '@/delivery/delivery-ledger';
import { detectDelivery } from '@/delivery/detection';
import { recordDecisionOpened } from '@/planning/decision-ledger';
import { recordRuleDrift, recordRuleFindings } from '@/rule-scripts/rule-ledger';
import { recordDisabledSession } from '@/session-ledger/disabled-audit';
import { appendSessionEvent, openSessionDoc } from '@/session-ledger/ledger';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types';

// Buildout F6 (last increment) — the SIEM export unions the always-on #249
// session-ledger doc types into the fold-view, so an external SOC sees the same
// governance feed the dashboard does, not just the enterprise-gated #118 ledger.

const GITHUB = detectDelivery({
  remoteUrl: 'git@github.com:o/r.git',
  defaultBranch: 'origin/main',
  branchNames: ['feat/a'],
  recentCommitSubjects: ['feat: a'],
});

function bySource(events: SiemEvent[], docType: string): SiemEvent[] {
  return events.filter((e) => e.kind === 'session' && e.doc_type === docType);
}

/** The session event for a doc type with a given verdict (skips the open-marker row). */
function withVerdict(events: SiemEvent[], docType: string, verdict: string): SiemEvent {
  const match = bySource(events, docType).find((e) => e.verdict === verdict);
  if (match === undefined) throw new Error(`no ${docType} event with verdict ${verdict}`);
  return match;
}

describe('aggregateSiemEvents — #249 session-ledger fold', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-audit-session-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('folds a decision lifecycle event as an informational session event', () => {
    recordDecisionOpened(root, {
      decisionId: 'D-1',
      category: 'scope',
      title: 'Reuse?',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    const event = withVerdict(aggregateSiemEvents(root), 'decision-evidence', 'opened');
    expect(event.kind).toBe('session');
    expect(event.code).toBe('decision-evidence');
    expect(event.session_id).toBe('_project');
    expect(event.detail).toBe('opened D-1');
    expect(event.content_hash).toBeDefined();
  });

  it('folds delivery detection with the host in detail', () => {
    recordDeliveryEvidence(root, GITHUB);
    const event = withVerdict(aggregateSiemEvents(root), 'delivery-evidence', 'detected');
    expect(event.detail).toBe('detected host=github');
  });

  it('grades a blocking rule-compliance row as blocked (a SOC finding)', () => {
    recordRuleFindings(root, {
      counts: { deterministic: 3, heuristic: 0, skipped: 1 },
      blocking: true,
    });
    const event = withVerdict(aggregateSiemEvents(root), 'rule-evidence', 'blocked');
    expect(event.detail).toBe('findings blocking');
  });

  it('grades a blocked rule-drift row as blocked', () => {
    recordRuleDrift(root, { blocked: true, counts: { 'RS-001': 2 } });
    const event = withVerdict(aggregateSiemEvents(root), 'rule-evidence', 'blocked');
    expect(event.detail).toBe('drift blocked');
  });

  it('records a disabled session as a visible bypass (verdict disabled)', () => {
    recordDisabledSession(root, { sessionId: 'ses-x', origin: 'hook-completion' });
    const [event] = bySource(aggregateSiemEvents(root), 'disabled-session');
    expect(event.verdict).toBe('disabled');
    expect(event.session_id).toBe('ses-x');
    expect(event.detail).toBe('disabled (paqad-disabled)');
  });

  it('grades stage event_status into pass/fail', () => {
    const { ordinal } = openSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, 'ses-s', {
      kind: 'open',
      adapter: 'claude-code',
    });
    appendSessionEvent(root, STAGE_EVIDENCE_DOC_TYPE, 'ses-s', ordinal, {
      kind: 'stage_end',
      stage: 'development',
      event_status: 'completed',
    });
    appendSessionEvent(root, STAGE_EVIDENCE_DOC_TYPE, 'ses-s', ordinal, {
      kind: 'stage_end',
      stage: 'verification',
      event_status: 'failed',
    });
    appendSessionEvent(root, STAGE_EVIDENCE_DOC_TYPE, 'ses-s', ordinal, {
      kind: 'stage_start',
      stage: 'review',
      event_status: 'started',
    });
    const verdicts = bySource(aggregateSiemEvents(root), STAGE_EVIDENCE_DOC_TYPE).map(
      (e) => e.verdict,
    );
    expect(verdicts).toContain('pass'); // completed
    expect(verdicts).toContain('fail'); // failed
    expect(verdicts).toContain('started'); // other event_status passes through
  });

  it('merges session events into one chronological stream with evidence + ledger ts order', () => {
    appendEvidenceRows(root, [
      buildEvidenceRow({
        ts: '2026-06-10T00:00:00.000Z',
        engine: 'verification-gate',
        code: 'code-tests-lint',
        subject_digest: 's',
        verdict: 'pass',
        strength_class: 'deterministic',
      }),
    ]);
    recordDecisionOpened(root, {
      decisionId: 'D-9',
      category: 'scope',
      title: 'later',
      createdAt: '2026-06-25T00:00:00.000Z',
    });
    const events = aggregateSiemEvents(root);
    // Both kinds present, sorted oldest-first by ts.
    expect(events.some((e) => e.kind === 'evidence')).toBe(true);
    expect(events.some((e) => e.kind === 'session')).toBe(true);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].ts <= events[i].ts).toBe(true);
    }
  });

  it('adds nothing when the session-ledger is empty (additive over #118)', () => {
    appendEvidenceRows(root, [
      buildEvidenceRow({
        ts: '2026-06-10T00:00:00.000Z',
        engine: 'verification-gate',
        code: 'x',
        subject_digest: 's',
        verdict: 'pass',
        strength_class: 'deterministic',
      }),
    ]);
    const events = aggregateSiemEvents(root);
    expect(events).toHaveLength(1);
    expect(events.every((e) => e.kind === 'evidence')).toBe(true);
  });
});
