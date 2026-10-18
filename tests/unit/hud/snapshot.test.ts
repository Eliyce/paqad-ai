import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { createPendingDecision } from '@/decisions/authoring.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { hudSnapshotPath } from '@/hud/files.js';
import { writeHudReceipt } from '@/hud/receipt-file.js';
import { isHudRefreshVerb, refreshHudSnapshot } from '@/hud/refresh.js';
import type { DuplicationReport } from '@/duplication/report.js';
import type { DuplicationFinding } from '@/duplication/types.js';
import {
  appendDuplicationRun,
  appendRuleRun,
  BUNDLE_FINDINGS_CAP,
} from '@/feature-evidence/bundle-ledgers.js';
import {
  buildHudSnapshot,
  computeHudFlags,
  computeHudHeadline,
  HUD_SNAPSHOT_SCHEMA,
  type HudFindingsScan,
  writeHudSnapshot,
  writeHudSnapshotSafe,
} from '@/hud/snapshot.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';

// Issue #639, Part 7 — the HUD snapshot, built only from paqad's own records. Fixtures follow
// the issue's made-up changes: ORD-490 (fast-lane copy fix), ORD-482 (graduated-lane bug fix)
// and ORD-501 (full-lane feature), plus a paused change.

const NOW = () => new Date('2026-10-18T09:00:00.000Z');
const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function onboardedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-hud-snapshot-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.FRAMEWORK_PATH), '~/.paqad-ai/current\n');
  return root;
}

function openChange(
  root: string,
  session: string,
  lane: 'fast' | 'graduated' | 'full',
  title: string,
): string {
  const dir = openFeatureChange(root, session, {
    adapter: 'claude-code',
    title,
    issue: title.split(' ')[0]!,
    lane,
  });
  persistLedgerSessionId(root, session);
  writeWorkflowState(root, session, {
    active: { workflow: 'feature-development', lane, reason: `a ${lane} change` },
    paused: [],
  });
  return dir;
}

function completeStage(root: string, session: string, stage: string, artifact?: string): void {
  startStage(root, stage, { sessionId: session, adapter: 'claude-code' });
  if (artifact) writeFileSync(join(root, artifact), `{"${stage}":true}`);
  endStage(
    root,
    stage,
    { artifactPaths: artifact ? [artifact] : [] },
    { sessionId: session, adapter: 'claude-code' },
  );
}

function writeBundleJson(
  root: string,
  dir: string,
  file: 'experts' | 'clarification' | 'specification',
  body: unknown,
): void {
  writeFileSync(join(root, featureFilePath(dir, file)), JSON.stringify(body));
}

function seats(roles: string[]): unknown {
  return {
    roster: roles.map((role) => ({
      role,
      reason: `${role} reason`,
      origin: 'standing',
      budget_tokens: 5000,
      tokens_used: 1200,
    })),
  };
}

function evidenceRow(code: string, verdict: string): string {
  return JSON.stringify({
    schema_version: 2,
    doc_type: 'paqad.evidence',
    recorded_at: '2026-10-18T08:59:00.000Z',
    engine: 'verification-gate',
    code,
    subject_digest: 'sd',
    verdict,
    strength_class: 'deterministic',
    content_hash: `h-${code}-${verdict}`,
    detail: `${code} ${verdict}`,
  });
}

describe('buildHudSnapshot (#639 Part 7, AC-8)', () => {
  it('ORD-490 fast lane: no High Table, a running build, the rules flag', () => {
    const root = onboardedRoot();
    const S = 'ses-490';
    openChange(root, S, 'fast', 'ORD-490 copy fix');
    completeStage(root, S, 'planning', 'plan-490.json');
    startStage(root, 'development', { sessionId: S, adapter: 'claude-code' });

    const snapshot = buildHudSnapshot(root, S, { now: NOW });

    expect(snapshot).toMatchObject({
      schema: HUD_SNAPSHOT_SCHEMA,
      session_id: S,
      generated_at: '2026-10-18T09:00:00.000Z',
      active: true,
      route: 'feature-development',
      lane: 'fast',
      lane_reason: 'a fast change',
      table: null,
      claims: [],
      last_block: null,
      cost: null,
      isolation: { status: 'not-applicable', stages: 0 },
      verdict: null,
    });
    expect(snapshot.change).toMatchObject({ issue: 'ORD-490' });
    expect(snapshot.headline).toEqual({
      text: 'Build in progress. Next: Review.',
      tone: 'working',
    });
    const planning = snapshot.stages.find((stage) => stage.stage === 'planning');
    expect(planning).toMatchObject({
      state: 'complete',
      proof_file: 'plan-490.json',
      mandatory: true,
      duration_unreliable: false,
    });
    expect(snapshot.stages.find((stage) => stage.stage === 'ticket_intake')?.mandatory).toBe(false);
    expect(snapshot.flags.map((flag) => flag.id)).toEqual(['rules-not-loaded']);
    expect(snapshot.rules).toEqual({ recorded: false, applicable: null, loaded_at: null });
    expect(snapshot.ship).toMatchObject({ commits: 0, push: null, pr: null, ci: null });
    const expected = Object.fromEntries(
      snapshot.evidence_expected.map((entry) => [entry.file, entry.expectation]),
    );
    expect(expected['feature.json']).toBe('always');
    expect(expected['checks.json']).toBe('if present');
    // Issue #640 (FR-13): the pipeline is on by default, but the fast lane never needs its files.
    expect(expected['request.md']).toBe('off here');
    expect(expected['clarification.json']).toBe('off here');
    expect(expected['experts.json']).toBe('off here');
    expect(snapshot.evidence_expected.find((e) => e.file === 'feature.json')?.present).toBe(true);
  });

  it('ORD-482 graduated lane: four seats, a waiting decision, isolation expected', () => {
    const root = onboardedRoot();
    const S = 'ses-482';
    const dir = openChange(root, S, 'graduated', 'ORD-482 keep copied phone');
    completeStage(root, S, 'planning', 'plan-482.json');
    writeBundleJson(
      root,
      dir,
      'experts',
      seats(['product-owner', 'application-architect', 'user-flow-writer', 'qa-engineer']),
    );
    writeBundleJson(root, dir, 'clarification', {
      questions: { counts: { asked: 2, answered: 1, auto_answered: 1, deferred: 0 } },
    });
    const { id } = createPendingDecision(root, {
      category: 'fix.proof_method',
      title: 'How do we prove the copied phone survives a re-sync?',
      context: 'The QA engineer recommends a failing test first.',
      options: [
        { option_key: 'test', label: 'Write a failing test first' },
        { option_key: 'manual', label: 'Check it by hand' },
      ],
    });

    const snapshot = buildHudSnapshot(root, S, { now: NOW });

    expect(snapshot.lane).toBe('graduated');
    expect(snapshot.table?.seats.map((seat) => seat.role)).toEqual([
      'product-owner',
      'application-architect',
      'user-flow-writer',
      'qa-engineer',
    ]);
    expect(snapshot.table?.seats[0]).toEqual({
      role: 'product-owner',
      reason: 'product-owner reason',
      origin: 'standing',
      budget_tokens: 5000,
      tokens_used: 1200,
    });
    expect(snapshot.questions).toEqual({ asked: 2, answered: 1, auto_answered: 1, deferred: 0 });
    expect(snapshot.decisions.pending).toEqual([
      {
        id,
        category: 'fix.proof_method',
        question: 'How do we prove the copied phone survives a re-sync?',
      },
    ]);
    expect(snapshot.headline).toEqual({
      text: 'Needs you: 1 decision waiting.',
      tone: 'needs-you',
    });
    expect(snapshot.isolation?.status).toBe('expected');
    expect(snapshot.flags.map((flag) => flag.id)).toContain('isolation-missing');
    // Issue #640 (FR-13): on the graduated lane the default-on pipeline needs its files.
    const expected = Object.fromEntries(
      snapshot.evidence_expected.map((entry) => [entry.file, entry.expectation]),
    );
    expect(expected['request.md']).toBe('on here');
    expect(expected['experts.json']).toBe('on here');
  });

  it('ORD-501 full lane: Safe to merge with an open flag reads amber, never green (Q19)', () => {
    const root = onboardedRoot();
    const S = 'ses-501';
    const dir = openChange(root, S, 'full', 'ORD-501 csv export');
    for (const stage of ['planning', 'specification', 'development', 'review', 'checks']) {
      completeStage(root, S, stage);
    }
    writeBundleJson(
      root,
      dir,
      'experts',
      seats([
        'product-owner',
        'application-architect',
        'user-flow-writer',
        'qa-engineer',
        'security-auditor',
        'db-expert',
        'performance-engineer',
      ]),
    );
    writeBundleJson(root, dir, 'specification', { pipeline: { produced: true } });
    writeFileSync(
      join(root, featureFilePath(dir, 'evidence')),
      [
        evidenceRow('code-tests-lint', 'pass'),
        evidenceRow('mutation-testing', 'inconclusive'),
        evidenceRow('spec-review', 'pass'),
        evidenceRow('visual-evidence', 'skipped'),
      ].join('\n') + '\n',
    );
    writeHudReceipt(root, S, {
      summary: 'Safe to merge',
      receipt: 'receipt',
      gates: [],
      kind: 'pass',
    });

    const snapshot = buildHudSnapshot(root, S, { now: NOW });

    expect(snapshot.table?.seats).toHaveLength(7);
    expect(snapshot.table?.skipped).toBe(false);
    expect(snapshot.gates).toEqual([
      { name: 'code-tests-lint', required: true, strength: 'deterministic', verdict: 'pass' },
      {
        name: 'mutation-testing',
        required: true,
        strength: 'deterministic',
        verdict: 'inconclusive',
      },
      { name: 'spec-review', required: true, strength: 'llm-judged', verdict: 'pass' },
      {
        name: 'visual-evidence',
        required: false,
        strength: 'deterministic',
        verdict: 'not-required',
      },
    ]);
    expect(snapshot.flags.map((flag) => flag.id)).toEqual(
      expect.arrayContaining(['gate:mutation-testing']),
    );
    expect(snapshot.verdict).toMatchObject({ word: 'Safe to merge', kind: 'pass' });
    expect(snapshot.receipt?.path).toContain(`${S}.receipt.md`);
    expect(snapshot.headline.tone).toBe('warn');
    expect(snapshot.headline.text).toMatch(/^Safe to merge\. \d+ flags? open\.$/);
  });

  it('a hand-written spec under the pipeline shows the High Table as skipped (Q11)', () => {
    const root = onboardedRoot();
    const S = 'ses-manual';
    const dir = openChange(root, S, 'graduated', 'ORD-777 manual spec');
    writeBundleJson(root, dir, 'specification', {
      pipeline: { produced: false, manual_reason: 'owner wrote it' },
    });

    const snapshot = buildHudSnapshot(root, S, { now: NOW });

    expect(snapshot.table).toEqual({ seats: [], skipped: true });
    expect(snapshot.flags.map((flag) => flag.id)).toContain('high-table-skipped');
  });

  it('a paused change with nothing active reads paused, with no stages or ship', () => {
    const root = onboardedRoot();
    const S = 'ses-paused';
    writeWorkflowState(root, S, {
      active: { workflow: 'project-question', reason: 'a question' },
      paused: [{ workflow: 'feature-development', lane: 'graduated' }],
    });

    const snapshot = buildHudSnapshot(root, S, { now: NOW });

    expect(snapshot).toMatchObject({
      active: false,
      route: 'project-question',
      lane_reason: 'a question',
      change: null,
      stages: [],
      ship: null,
      paused: [{ workflow: 'feature-development', lane: 'graduated' }],
    });
    expect(snapshot.headline).toEqual({
      text: 'A change is paused. Say "continue" to pick it up.',
      tone: 'neutral',
    });
  });

  it('two sessions on one checkout each get their own snapshot', () => {
    const root = onboardedRoot();
    writeWorkflowState(root, 'ses-a', { active: { workflow: 'pentest' }, paused: [] });
    writeWorkflowState(root, 'ses-b', { active: null, paused: [] });

    const a = writeHudSnapshot(root, 'ses-a', { now: NOW });
    const b = writeHudSnapshot(root, 'ses-b', { now: NOW });

    expect(a.path).not.toBe(b.path);
    expect(JSON.parse(readFileSync(a.path, 'utf8')).headline.text).toBe('Working on pentest.');
    expect(JSON.parse(readFileSync(b.path, 'utf8')).headline.text).toBe(
      'Ready. No change in progress.',
    );
  });
});

describe('findings kept in the bundle (#639 Part 12)', () => {
  const RULE_FINDING = {
    rule_id: 'no-raw-sql',
    file: 'src/orders/sync.ts',
    line: 42,
    message: 'Use the query builder, not raw SQL.',
    severity: 'high',
  };

  function nearCopy(i: number): DuplicationFinding {
    return {
      file: `src/orders/phone${i}.ts`,
      line_range: { start: 3, end: 14 },
      matched_file: 'src/customers/phone.ts',
      matched_symbol: 'normalizePhone',
      matched_line_range: { start: 8, end: 19 },
      similarity: 0.94,
      matched_callers: 6,
      corroborated: false,
      kind: 'deterministic',
      message: 'near copy',
    };
  }

  function duplicationReport(findings: DuplicationFinding[]): DuplicationReport {
    return {
      schema_version: 1,
      generated_at: '2026-10-18T08:58:00.000Z',
      mode: 'warn',
      similarity_threshold: 0.9,
      min_lines: 8,
      elapsed_ms: 3,
      findings,
      counts: { deterministic: findings.length, heuristic: 0 },
      blocking: false,
    };
  }

  /** Gate 3 (AC-30): a scan's kept findings plus its overflow equal its counts. */
  function expectCountsMatchFindings(scan: HudFindingsScan<unknown>): void {
    if (scan.status === 'did not run') {
      expect(scan.total).toBeNull();
      expect(scan.items).toBeNull();
      return;
    }
    expect(scan.items!.length + scan.overflow).toBe(scan.total);
  }

  it('names a rule finding and a near-copy in the snapshot, each raising a flag (AC-26, AC-27)', () => {
    const root = onboardedRoot();
    const S = 'ses-482-findings';
    openChange(root, S, 'graduated', 'ORD-482 keep copied phone');
    appendRuleRun(root, S, {
      kind: 'findings',
      counts: { deterministic: 1, heuristic: 0, skipped: 0 },
      blocking: true,
      findings: [RULE_FINDING],
    });
    appendDuplicationRun(root, S, duplicationReport([nearCopy(1)]));

    const snapshot = buildHudSnapshot(root, S, { now: NOW });

    expect(snapshot.findings?.rules).toMatchObject({
      status: 'open',
      total: 1,
      blocking: true,
      from_cache: false,
      items: [RULE_FINDING],
      overflow: 0,
    });
    expect(snapshot.findings?.rules.recorded_at).toEqual(expect.any(String));
    expect(snapshot.findings?.near_copies).toMatchObject({
      status: 'open',
      total: 1,
      items: [
        {
          file: 'src/orders/phone1.ts',
          matched_symbol: 'normalizePhone',
          similarity: 0.94,
          matched_callers: 6,
        },
      ],
    });
    expect(snapshot.flags).toEqual(
      expect.arrayContaining([
        { id: 'rule-findings', text: '1 rule finding is open.' },
        { id: 'near-copies', text: '1 near-copy of existing code is open.' },
      ]),
    );
    expectCountsMatchFindings(snapshot.findings!.rules);
    expectCountsMatchFindings(snapshot.findings!.near_copies);
  });

  it('shows the cap and the overflow, and the count only in a flag (AC-28, AC-29)', () => {
    const root = onboardedRoot();
    const S = 'ses-501-findings';
    openChange(root, S, 'full', 'ORD-501 loyalty points');
    const many = Array.from({ length: BUNDLE_FINDINGS_CAP + 2 }, (_, i) => ({
      ...RULE_FINDING,
      line: i + 1,
    }));
    appendRuleRun(root, S, {
      kind: 'findings',
      counts: { deterministic: 0, heuristic: many.length, skipped: 0 },
      blocking: false,
      findings: many,
      from_cache: true,
    });
    const copies = Array.from({ length: BUNDLE_FINDINGS_CAP + 1 }, (_, i) => nearCopy(i));
    appendDuplicationRun(root, S, duplicationReport(copies));

    const snapshot = buildHudSnapshot(root, S, { now: NOW });

    expect(snapshot.findings?.rules.items).toHaveLength(BUNDLE_FINDINGS_CAP);
    expect(snapshot.findings?.rules).toMatchObject({ overflow: 2, from_cache: true, total: 52 });
    expect(snapshot.findings?.near_copies).toMatchObject({ overflow: 1, total: 51 });
    expect(snapshot.flags.filter((flag) => /open\.$/.test(flag.text))).toEqual([
      { id: 'rule-findings', text: '52 rule findings are open.' },
      { id: 'near-copies', text: '51 near-copies of existing code are open.' },
    ]);
    expectCountsMatchFindings(snapshot.findings!.rules);
    expectCountsMatchFindings(snapshot.findings!.near_copies);
  });

  it('reads "did not run" for a scan with no row, never clean (Gate 3, AC-30)', () => {
    const root = onboardedRoot();
    const S = 'ses-490-findings';
    openChange(root, S, 'fast', 'ORD-490 copy fix');
    expect(buildHudSnapshot(root, S, { now: NOW }).findings).toBeNull();

    // A drift row from the reconciler is not a rule scan.
    appendRuleRun(root, S, { kind: 'drift', counts: { 'RS-X': 1 }, blocking: false });
    appendDuplicationRun(root, S, duplicationReport([]));
    const snapshot = buildHudSnapshot(root, S, { now: NOW });

    expect(snapshot.findings?.rules).toEqual({
      status: 'did not run',
      total: null,
      counts: null,
      blocking: false,
      from_cache: false,
      items: null,
      overflow: 0,
      recorded_at: null,
    });
    expect(snapshot.findings?.near_copies).toMatchObject({ status: 'clean', total: 0, items: [] });
    expect(snapshot.flags.map((flag) => flag.id)).not.toContain('rule-findings');
    expect(snapshot.flags.map((flag) => flag.id)).not.toContain('near-copies');
    expectCountsMatchFindings(snapshot.findings!.rules);
    expectCountsMatchFindings(snapshot.findings!.near_copies);
  });

  it('keeps an older row without findings as counts only, with no items to show', () => {
    const root = onboardedRoot();
    const S = 'ses-old-row';
    openChange(root, S, 'fast', 'ORD-470 older row');
    appendRuleRun(root, S, { kind: 'findings', counts: {}, blocking: false });

    const snapshot = buildHudSnapshot(root, S, { now: NOW });

    expect(snapshot.findings?.rules).toMatchObject({ status: 'clean', total: 0, items: null });
    expect(snapshot.findings?.near_copies.status).toBe('did not run');
  });
});

describe('computeHudFlags findings', () => {
  it('raises no findings flag when the input has none', () => {
    const flags = computeHudFlags({
      stages: [],
      gates: [],
      rulesRecorded: true,
      tableSkipped: false,
      isolationStatus: 'not-applicable',
      isolatedStages: 0,
    });
    expect(flags).toEqual([]);
  });
});

describe('computeHudHeadline', () => {
  const base = {
    route: 'feature-development',
    active: true,
    pendingDecisions: 0,
    flags: [],
    paused: 0,
  };
  const stage = (s: string, state: string, mandatory = true) => ({
    stage: s,
    state,
    mandatory,
    started_at: null,
    ended_at: null,
    duration_ms: null,
    duration_unreliable: false,
    agent: null,
    proof_file: null,
  });

  it('names the next stage after the last one done, then waits for the verdict', () => {
    expect(
      computeHudHeadline({
        ...base,
        stages: [stage('planning', 'complete'), stage('specification', 'missing')],
        verdict: null,
      }),
    ).toEqual({ text: 'Planning done. Next: Spec.', tone: 'working' });
    expect(
      computeHudHeadline({ ...base, stages: [stage('specification', 'missing')], verdict: null }),
    ).toEqual({ text: 'Next: Spec.', tone: 'working' });
    expect(
      computeHudHeadline({ ...base, stages: [stage('planning', 'complete')], verdict: null }),
    ).toEqual({ text: 'Every stage is recorded. Waiting for the verdict.', tone: 'working' });
  });

  it('colours the verdict: red on a fail, amber on Inconclusive, green only when clean', () => {
    const verdict = (kind: 'pass' | 'fail' | 'inconclusive', word: string) => ({
      schema: 'paqad.hud-verdict/1' as const,
      session_id: 's',
      word,
      kind,
      passed: kind === 'pass',
      reasons: [],
      written_at: 'x',
    });
    const stages = [stage('planning', 'complete')];
    expect(
      computeHudHeadline({ ...base, stages, verdict: verdict('fail', 'Needs your attention') })
        .tone,
    ).toBe('bad');
    expect(
      computeHudHeadline({ ...base, stages, verdict: verdict('inconclusive', 'Inconclusive') })
        .tone,
    ).toBe('warn');
    expect(
      computeHudHeadline({ ...base, stages, verdict: verdict('pass', 'Safe to merge') }),
    ).toEqual({
      text: 'Safe to merge.',
      tone: 'good',
    });
  });

  it('reads Ready with no route, and Working on a non-feature route', () => {
    const idle = { ...base, active: false, stages: [], verdict: null };
    expect(computeHudHeadline({ ...idle, route: null }).text).toBe('Ready. No change in progress.');
    expect(computeHudHeadline({ ...idle, route: 'no-workflow' }).text).toBe(
      'Ready. No change in progress.',
    );
    expect(computeHudHeadline({ ...idle, route: 'codebase-health' }).text).toBe(
      'Working on codebase health.',
    );
  });
});

describe('refreshHudSnapshot stand-downs (decision 5)', () => {
  it('writes nothing in a project that was never onboarded', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-hud-unonboarded-'));
    roots.push(root);
    expect(refreshHudSnapshot(root, 'ses', 'test')).toBeNull();
    expect(() => readFileSync(hudSnapshotPath(root, 'ses'))).toThrow();
  });

  it('writes nothing while paqad is disabled', () => {
    const root = onboardedRoot();
    expect(refreshHudSnapshot(root, 'ses', 'test', { PAQAD_DISABLED: '1' })).toBeNull();
  });

  it('writes the snapshot in an onboarded, enabled project', () => {
    const root = onboardedRoot();
    const path = refreshHudSnapshot(root, 'ses', 'test', {});
    expect(path).toBe(hudSnapshotPath(root, 'ses'));
    expect(JSON.parse(readFileSync(path!, 'utf8')).schema).toBe(HUD_SNAPSHOT_SCHEMA);
  });

  it('a failed write is logged, never thrown (guardrail rule 3)', () => {
    const root = onboardedRoot();
    // A directory where the snapshot file should be makes the rename fail.
    mkdirSync(hudSnapshotPath(root, 'ses'), { recursive: true });
    expect(writeHudSnapshotSafe(root, 'ses', 'test')).toBeNull();
    expect(readFileSync(join(root, '.paqad/logs/hook-failures.log'), 'utf8')).toContain(
      'hud-snapshot (test)',
    );
  });

  it('refreshes after the verbs that move a change, and no others', () => {
    for (const verb of [
      'decision create',
      'rules load',
      'spec pipeline experts notes',
      'stage',
      'deliver',
      'delivery-link commit',
    ]) {
      expect(isHudRefreshVerb(verb)).toBe(true);
    }
    for (const verb of [
      'status',
      'decision list',
      'rules compile',
      'delivery',
      'spec pipeline start',
    ]) {
      expect(isHudRefreshVerb(verb)).toBe(false);
    }
  });
});
