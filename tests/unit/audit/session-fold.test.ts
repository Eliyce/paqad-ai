import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aggregateSiemEvents } from '@/audit/aggregate';
import type { SiemEvent } from '@/audit/types';
import type { EvidenceLedgerRow } from '@/core/types/evidence-ledger';
import { buildEvidenceRow } from '@/evidence/ledger';
import { recordDeliveryEvidence } from '@/delivery/delivery-ledger';
import { detectDelivery } from '@/delivery/detection';
import { recordDecisionOpened } from '@/planning/decision-ledger';
import { recordDisabledSession } from '@/session-ledger/disabled-audit';
import { recordHealthRun } from '@/codebase-health/ledger';
import {
  appendChangeMetrics,
  appendRuleRun,
  CHANGE_METRICS_RUN_DOC_TYPE,
  RULE_RUN_DOC_TYPE,
} from '@/feature-evidence/bundle-ledgers';
import { featureFilePath, formatFeatureDirName } from '@/feature-evidence/paths';
import { appendFeatureStageRow, openFeatureChange } from '@/feature-evidence/stage-ledger';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types';

/**
 * Seed graded evidence rows into a feature bundle WITHOUT a stage `open` row (issue #468
 * Phase B). Writing the bundle `evidence.jsonl` directly (rather than via openFeatureChange)
 * keeps these evidence-only assertions free of the stage-projection noise an opened feature
 * would add.
 */
function seedBundleEvidence(root: string, rows: EvidenceLedgerRow[]): void {
  const dir = formatFeatureDirName({ issue: null, slug: 'x', ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
  const path = join(root, featureFilePath(dir, 'evidence'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
}

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

  it('grades a blocking rule-run finding row as blocked (a SOC finding, #468 Phase B)', () => {
    // Findings now project from the per-feature bundle rule-run.jsonl (doc_type paqad.rule-run).
    openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    appendRuleRun(root, 'ses_1', {
      kind: 'findings',
      counts: { deterministic: 3, heuristic: 0, skipped: 1 },
      blocking: true,
    });
    const event = withVerdict(aggregateSiemEvents(root), RULE_RUN_DOC_TYPE, 'blocked');
    expect(event.detail).toBe('findings blocking');
  });

  // Rule DRIFT is no longer folded into the SIEM export (issue #468 Phase B, D2): drift
  // describes the project, not a change, so it stays in the reconciler's cache and never
  // enters a feature bundle. Only the bundle rule-run FINDINGS row reaches the export.

  it('folds a codebase-health run into the SIEM feed with a finding-count detail (#355 AC-7)', () => {
    recordHealthRun(
      root,
      {
        report_id: 'HEALTH-2026',
        workflow: 'codebase-health',
        offline: true,
        finding_count: 4,
        blocked_count: 1,
        new_since_baseline: 4,
        pre_existing: 0,
      },
      { sessionId: 'ses-h' },
    );
    const [event] = bySource(aggregateSiemEvents(root), 'codebase-health-run');
    expect(event.session_id).toBe('ses-h');
    expect(event.detail).toContain('health run HEALTH-2026');
    expect(event.detail).toContain('4 finding(s)');
  });

  it('folds a bundle change-metrics row into the SIEM feed with a change-shape detail (#362/#468)', () => {
    openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    appendChangeMetrics(root, 'ses_1', {
      dup_new_pct: 2,
      reuse_rate: 4.2,
      meaningful_changed_lines: 120,
      inputs: {
        flagged_lines: 3,
        reuse_calls: 5,
        duplication_report_present: true,
        index_present: true,
      },
    });
    const event = bySource(aggregateSiemEvents(root), CHANGE_METRICS_RUN_DOC_TYPE).find((e) =>
      e.detail.includes('change shape'),
    );
    expect(event).toBeDefined();
    expect(event!.detail).toContain('2% dup');
    expect(event!.detail).toContain('4.2 reuse/100');
    expect(event!.detail).toContain('120 lines');
  });

  it('renders n/a change-metrics parts in the SIEM detail (#468 Phase B)', () => {
    openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    appendChangeMetrics(root, 'ses_1', {
      dup_new_pct: null,
      reuse_rate: null,
      meaningful_changed_lines: 0,
      inputs: {
        flagged_lines: 0,
        reuse_calls: 0,
        duplication_report_present: false,
        index_present: false,
      },
    });
    const event = bySource(aggregateSiemEvents(root), CHANGE_METRICS_RUN_DOC_TYPE).find((e) =>
      e.detail.includes('change shape'),
    );
    expect(event!.detail).toContain('n/a dup, n/a reuse/100');
  });

  it('records a disabled session as a visible bypass (verdict disabled)', () => {
    recordDisabledSession(root, { sessionId: 'ses-x', origin: 'hook-completion' });
    const [event] = bySource(aggregateSiemEvents(root), 'disabled-session');
    expect(event.verdict).toBe('disabled');
    expect(event.session_id).toBe('ses-x');
    expect(event.detail).toBe('disabled (paqad-disabled)');
  });

  it('grades stage event_status into pass/fail (projected from feature bundles, #339)', () => {
    // Stage evidence now lives in the per-feature bundle (issue #339), so the SIEM
    // export projects it from there — seed via the feature stage ledger.
    const dir = openFeatureChange(root, 'ses-s', { adapter: 'claude-code', ulidSeed: 1 });
    appendFeatureStageRow(root, 'ses-s', dir, {
      kind: 'stage_end',
      stage: 'development',
      adapter: 'claude-code',
      event_status: 'completed',
    });
    appendFeatureStageRow(root, 'ses-s', dir, {
      kind: 'stage_end',
      stage: 'verification',
      adapter: 'claude-code',
      event_status: 'failed',
    });
    appendFeatureStageRow(root, 'ses-s', dir, {
      kind: 'stage_start',
      stage: 'review',
      adapter: 'claude-code',
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
    seedBundleEvidence(root, [
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
    seedBundleEvidence(root, [
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
