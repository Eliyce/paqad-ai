import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';
import { syncFrameworkConfig } from '@/core/framework-config.js';
import type { QualityRatchetResult } from '@/core/types/quality-ratchet.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import type { VerificationContext } from '@/core/types/verification.js';
import { decodeReceiptStatement } from '@/evidence/receipt/project.js';
import { readFeatureEvidence } from '@/feature-evidence/bundle-ledgers.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { readFeatureReceipt } from '@/feature-evidence/receipt.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { hudReceiptPath, hudVerdictPath } from '@/hud/files.js';
import { writeHudReceipt } from '@/hud/receipt-file.js';
import { buildHudSnapshot, computeHudHeadline } from '@/hud/snapshot.js';
import type { HudVerdictRecord } from '@/hud/receipt-file.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { endStage, isArtifactBearingStage, startStage } from '@/stage-evidence/index.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { createVerificationContext, ownInFlightChange } from './shared.fixture.js';

const DIST = resolve(process.cwd(), 'dist/index.js');
const SES = 'ses-agree-669';
const NOW = new Date('2026-10-19T12:00:00.000Z');

const UNMEASURED_RATCHET: QualityRatchetResult = {
  status: 'pass',
  lane: 'full',
  verdicts: [
    {
      measure: 'dead_code',
      module: '(project)',
      baseline_value: 3,
      current_value: null,
      outcome: 'blocked',
      confidence: 'lower',
      kind: 'quality.dead_code',
      detail: 'dead_code @ (project): could not be measured this run.',
    },
  ],
  blocking_regressions: [],
  excepted_regressions: [],
  tightened: [],
  captured_baseline: false,
  skipped_reason: null,
};

const WORD_FOR_RESULT = {
  PASSED: PAQAD_VERDICT.pass,
  FAILED: PAQAD_VERDICT.fail,
  INCONCLUSIVE: PAQAD_VERDICT.inconclusive,
} as const;

const PASSING_CHECKS: StructuredTestResult = {
  schema_version: '1.0.0',
  summary: {
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    errored: 0,
    duration_ms: 5,
    timestamp: '1970-01-01T00:00:00.000Z',
    runner_id: 'vitest',
  },
  failures: [],
  warnings: [],
  parse_metadata: {
    raw_byte_size: 10,
    structured_byte_size: 10,
    compression_ratio: 0,
    original_size: 10,
    compact_size: 10,
    reduction_ratio: 0,
    delta_mode_used: false,
    escalation_occurred: false,
    escalation_reason: null,
    delta_summary: null,
    parse_strategy: 'structured',
    parse_warnings: [],
  },
  errors: [],
  evidence_scope: { related_paths: ['src/feature.ts'] },
};

function enableBundleReceipt(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.paqad', 'project-profile.yaml'),
    'project:\n  name: demo\nactive_capabilities:\n  - content\n',
  );
  syncFrameworkConfig(projectRoot, {
    enterprise: {
      enabled: true,
      evidence_ledger: true,
      ai_bom: false,
      compliance_citations: false,
    },
  });
}

function relaxStageAndBundleGates(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.paqad', 'configs'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.paqad', 'configs', '.config.app'),
    'stages_mode=warn\nbundle_completeness=off\nevidence_existence_gate=off\n',
  );
}

describe('HUD verdict, HUD receipt and bundle receipt agree at the end of a change', () => {
  let context: VerificationContext;
  let dir: string;
  let sessionId: string;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      changed_files: ['src/feature.ts'],
      changed_files_source: 'git',
    });
    sessionId = resolveSessionId(context.project_root, SES);
    dir = openFeatureChange(context.project_root, sessionId, {
      adapter: 'claude-code',
      title: 'agree',
      issue: '669',
    });
    ownInFlightChange(context.project_root, sessionId, dir);
    enableBundleReceipt(context.project_root);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock(DIST);
    rmSync(context.project_root, { recursive: true, force: true });
  });

  async function stop(): Promise<number> {
    vi.doMock(DIST, () => ({
      runRepositoryVerification: (options: Parameters<typeof runRepositoryVerification>[0]) =>
        runRepositoryVerification({ ...options, prebuiltContext: { context, escalations: [] } }),
      writeHudReceipt,
    }));
    const { runVerificationBackstop } =
      await import('../../../runtime/scripts/verify-backstop.mjs');
    const sink = { write: () => true };
    return runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot: context.project_root,
      hostSessionId: SES,
      loopActive: false,
      stdout: sink,
      stderr: sink,
    });
  }

  function featureDevTurn(): void {
    writeWorkflowState(context.project_root, sessionId, {
      active: { workflow: 'feature-development', lane: 'full' },
      paused: [],
      turn_started_at: '2000-01-01T00:00:00.000Z',
    });
  }

  function threeWords(): { hudVerdict: string; hudReceipt: string; bundleReceipt: string } {
    const root = context.project_root;
    const hud = JSON.parse(readFileSync(hudVerdictPath(root, sessionId), 'utf8')) as {
      word: string;
    };
    const receiptText = readFileSync(hudReceiptPath(root, sessionId), 'utf8');
    const hudReceipt =
      Object.values(PAQAD_VERDICT).find((word) => receiptText.includes(word)) ?? 'none';
    const envelope = readFeatureReceipt(root, dir);
    const result = decodeReceiptStatement(envelope!)!.predicate.verification_result;
    return { hudVerdict: hud.word, hudReceipt, bundleReceipt: WORD_FOR_RESULT[result] };
  }

  function expectAgreement(): string {
    const words = threeWords();
    expect(words.hudReceipt).toBe(words.hudVerdict);
    expect(words.bundleReceipt).toBe(words.hudVerdict);
    return words.hudVerdict;
  }

  it('AC-9: all three carry the same verdict word after the end-of-change check', async () => {
    featureDevTurn();

    expect(await stop()).toBe(0);

    const word = expectAgreement();
    expect(word).not.toBe(PAQAD_VERDICT.pass);
  });

  it('AC-9: a change failing only the stage and bundle gates reads Needs your attention in all three', async () => {
    featureDevTurn();

    await stop();

    expect(expectAgreement()).toBe(PAQAD_VERDICT.fail);
    const statement = decodeReceiptStatement(readFeatureReceipt(context.project_root, dir)!)!;
    const rows = readFeatureEvidence(context.project_root, dir);
    expect(statement.predicate.evidence_line_count).toBe(rows.length);
    expect(rows.map((row) => row.code)).toEqual(
      expect.arrayContaining(['stage-evidence', 'bundle-completeness']),
    );
  });

  it('AC-9: a change whose only gap is an unrecorded stage reads Inconclusive in all three', async () => {
    relaxStageAndBundleGates(context.project_root);
    context.structured_test_results = [PASSING_CHECKS];
    context.code_tests_lint_passed = true;
    context.code_changed = true;
    featureDevTurn();

    expect(await stop()).toBe(0);

    expect(expectAgreement()).toBe(PAQAD_VERDICT.inconclusive);
    const gapRow = readFeatureEvidence(context.project_root, dir).find(
      (row) => row.code === 'unrecorded-mandatory-stages',
    );
    expect(gapRow?.verdict).toBe('inconclusive');
    expect(gapRow?.detail).toContain('specification');
  });

  it('AC-9: a change every gate passed reads Safe to merge in all three', async () => {
    relaxStageAndBundleGates(context.project_root);
    context.changed_files = ['docs/guide.md'];
    featureDevTurn();

    expect(await stop()).toBe(0);

    expect(expectAgreement()).toBe(PAQAD_VERDICT.pass);
    expect(
      readFeatureEvidence(context.project_root, dir).some(
        (row) => row.code === 'unrecorded-mandatory-stages',
      ),
    ).toBe(false);
  });

  it('AC-9: a quality measure that could not be taken is listed, and all three read Safe to merge', async () => {
    relaxStageAndBundleGates(context.project_root);
    context.changed_files = ['docs/guide.md'];
    context.quality_ratchet_result = UNMEASURED_RATCHET;
    featureDevTurn();

    expect(await stop()).toBe(0);

    expect(expectAgreement()).toBe(PAQAD_VERDICT.pass);
    const statement = decodeReceiptStatement(readFeatureReceipt(context.project_root, dir)!)!;
    expect(statement.predicate.graded_results.blocked).toBe(1);
    expect(statement.predicate.verification_result).toBe('PASSED');
    const blockedRow = readFeatureEvidence(context.project_root, dir).find(
      (row) => row.verdict === 'blocked',
    );
    expect(blockedRow?.detail).toContain('dead_code');
  });

  function expectHeadlineAgreement(lead: string): string {
    const word = expectAgreement();
    const snapshot = buildHudSnapshot(context.project_root, SES, { now: () => NOW });
    expect(snapshot.headline.word).toBe(lead);
    expect(snapshot.headline.gap).toMatch(/^(paqad could not record |No record yet for: )/);
    expect(snapshot.headline.text).not.toContain('Fix it');
    expect(Object.values(PAQAD_VERDICT)).toContain(word);
    return word;
  }

  it('AC-15: a change failing only on paqad records reads Needs your attention on the receipts, and the HUD keys on the work with the gap in a neutral line', async () => {
    featureDevTurn();

    await stop();

    expect(expectHeadlineAgreement('Inconclusive')).toBe(PAQAD_VERDICT.fail);
  });

  it('AC-15: an unrecorded-stage change reads Inconclusive on the receipts and Done on the HUD headline', async () => {
    relaxStageAndBundleGates(context.project_root);
    context.structured_test_results = [PASSING_CHECKS];
    context.code_tests_lint_passed = true;
    context.code_changed = true;
    featureDevTurn();

    await stop();

    expect(expectHeadlineAgreement('Done')).toBe(PAQAD_VERDICT.inconclusive);
  });

  it('AC-15: a change whose ratchet did not run still reads one word everywhere, never a new pass', async () => {
    relaxStageAndBundleGates(context.project_root);
    context.changed_files = ['docs/guide.md'];
    context.quality_ratchet_result = UNMEASURED_RATCHET;
    featureDevTurn();

    await stop();

    const word = expectAgreement();
    expect(word).toBe(PAQAD_VERDICT.pass);
    const record = JSON.parse(
      readFileSync(hudVerdictPath(context.project_root, sessionId), 'utf8'),
    ) as HudVerdictRecord;
    const headline = computeHudHeadline({
      route: 'feature-development',
      active: true,
      stages: [],
      pendingDecisions: 0,
      verdict: record,
      flags: [],
      paused: 0,
    });
    expect(headline.word).toBe('Inconclusive');
    expect(headline.text).not.toContain(PAQAD_VERDICT.pass);
    const ratchetRow = readFeatureEvidence(context.project_root, dir).find(
      (row) => row.code === 'quality-ratchet',
    );
    expect(ratchetRow?.verdict).toBe('skipped');
    expect(ratchetRow?.skip_kind).toBe('did-not-run');
  });

  function recordEveryStage(): void {
    const root = context.project_root;
    for (const stage of [
      'planning',
      'specification',
      'development',
      'review',
      'checks',
      'documentation_sync',
    ]) {
      const owner = { sessionId, dirName: dir, adapter: 'claude-code' };
      startStage(root, stage, owner);
      if (!isArtifactBearingStage(stage)) {
        endStage(root, stage, {}, owner);
        continue;
      }
      const file =
        stage === 'planning' ? 'plan' : stage === 'specification' ? 'specification' : null;
      const rel = file ? featureFilePath(dir, file) : `.paqad/artifacts/${stage}.md`;
      mkdirSync(join(root, dirname(rel)), { recursive: true });
      writeFileSync(join(root, rel), file ? '{"real":true}\n' : `# ${stage} artifact\n`);
      endStage(root, stage, { artifactPaths: [rel] }, owner);
    }
  }

  function hudVerdictRecord(): HudVerdictRecord {
    return JSON.parse(
      readFileSync(hudVerdictPath(context.project_root, sessionId), 'utf8'),
    ) as HudVerdictRecord;
  }

  it('AC-1: a passing change that the check closes keeps its own change on the HUD verdict', async () => {
    relaxStageAndBundleGates(context.project_root);
    context.structured_test_results = [PASSING_CHECKS];
    context.code_tests_lint_passed = true;
    context.code_changed = true;
    featureDevTurn();
    recordEveryStage();

    expect(await stop()).toBe(0);

    expect(currentFeature(context.project_root, sessionId)).toBeNull();
    expect(hudVerdictRecord()).toMatchObject({ change: dir, kind: 'pass' });
  });

  it('AC-20: an inconclusive change that the check closes keeps its own change on the HUD verdict', async () => {
    relaxStageAndBundleGates(context.project_root);
    context.code_changed = true;
    featureDevTurn();
    recordEveryStage();

    expect(await stop()).toBe(0);

    expect(currentFeature(context.project_root, sessionId)).toBeNull();
    expect(hudVerdictRecord()).toMatchObject({ change: dir, kind: 'inconclusive' });
  });

  it('AC-9: a later skipped detour turn leaves all three still agreeing', async () => {
    featureDevTurn();
    await stop();
    const graded = expectAgreement();

    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    writeWorkflowState(context.project_root, sessionId, {
      active: { workflow: 'project-question' },
      paused: [{ workflow: 'feature-development', lane: 'full' }],
      turn_started_at: new Date().toISOString(),
    });
    vi.resetModules();
    expect(await stop()).toBe(0);

    expect(expectAgreement()).toBe(graded);
  });
});
