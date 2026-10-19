import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';
import { syncFrameworkConfig } from '@/core/framework-config.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import type { VerificationContext } from '@/core/types/verification.js';
import { decodeReceiptStatement } from '@/evidence/receipt/project.js';
import { readFeatureEvidence } from '@/feature-evidence/bundle-ledgers.js';
import { readFeatureReceipt } from '@/feature-evidence/receipt.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { hudReceiptPath, hudVerdictPath } from '@/hud/files.js';
import { writeHudReceipt } from '@/hud/receipt-file.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { createVerificationContext, ownInFlightChange } from './shared.fixture.js';

// Issue #669 (acceptance) — at the end of a change, the HUD verdict file, the HUD receipt and
// the bundle `receipt.json` say the same verdict. This drives the real Stop backstop
// (runtime/scripts/verify-backstop.mjs) with the real verification and HUD writer behind its
// dist api, so the three files come from one end-of-turn run exactly as in a session.

const DIST = resolve(process.cwd(), 'dist/index.js');
const SES = 'ses-agree-669';

/** The verdict word each bundle receipt result stands for (the one verdict vocabulary). */
const WORD_FOR_RESULT = {
  PASSED: PAQAD_VERDICT.pass,
  FAILED: PAQAD_VERDICT.fail,
  INCONCLUSIVE: PAQAD_VERDICT.inconclusive,
} as const;

/** A passing `paqad-ai checks run` report that covers the changed source file. */
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

/**
 * Relax the stage and bundle gates in the team file (the enforced mode knobs take the team
 * value as their floor), so the only thing left to judge is what each case sets up.
 */
function relaxStageAndBundleGates(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.paqad', 'configs'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.paqad', 'configs', '.config.app'),
    'stages_mode=warn\nbundle_completeness=off\nevidence_existence_gate=off\n',
  );
}

describe('HUD verdict, HUD receipt and bundle receipt agree at the end of a change (#669)', () => {
  let context: VerificationContext;
  let dir: string;
  let sessionId: string;

  beforeEach(() => {
    vi.resetModules();
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
    vi.doUnmock(DIST);
    rmSync(context.project_root, { recursive: true, force: true });
  });

  /** One Stop: the real backstop, with the real verification + HUD writer behind its dist api. */
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

  /** The verdict word each of the three files carries. */
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
    // An unfinished change with no recorded stages is never Safe to merge.
    expect(word).not.toBe(PAQAD_VERDICT.pass);
  });

  it('AC-9: a change failing only the stage and bundle gates reads Needs your attention in all three', async () => {
    featureDevTurn();

    await stop();

    expect(expectAgreement()).toBe(PAQAD_VERDICT.fail);
    // The receipt seals the late-gate rows it was built from, so none sit outside the seal.
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
    // A docs-only change owes no feature-development stages, so nothing is left unjudged.
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

  it('AC-9: a later skipped detour turn leaves all three still agreeing', async () => {
    featureDevTurn();
    await stop();
    const graded = expectAgreement();

    // The next turn is a question: no edit this turn, so the check is skipped as a detour.
    writeWorkflowState(context.project_root, sessionId, {
      active: { workflow: 'project-question' },
      paused: [{ workflow: 'feature-development', lane: 'full' }],
      turn_started_at: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.resetModules();
    expect(await stop()).toBe(0);

    expect(expectAgreement()).toBe(graded);
  });
});
