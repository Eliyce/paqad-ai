import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  inconclusiveChecksGate,
  runRepositoryVerification,
} from '@/verification/repository/run-repository-verification.js';
import { EngineEventBus } from '@/event-bus/engine-event-bus.js';
import type { EngineEvent, VerificationVerdictEvent } from '@/event-bus/types.js';
import type { TraceabilityMap } from '@/core/types/traceability.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';

import { endStage, openStageEvidence, startStage } from '@/stage-evidence/index.js';
import { readChangeMetrics } from '@/feature-evidence/bundle-ledgers.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { createVerificationContext } from '../shared.fixture.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-repo-verify-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad/session'), { recursive: true });
  return root;
}

function setChangedFiles(root: string, files: string[]): void {
  writeFileSync(join(root, '.paqad/session/changed-files.json'), JSON.stringify(files));
}

function writeTraceabilityMap(root: string, map: TraceabilityMap): void {
  mkdirSync(join(root, '.paqad/traceability'), { recursive: true });
  writeFileSync(join(root, '.paqad/traceability/map.json'), JSON.stringify(map));
}

afterEach(() => {
  // temp dirs are left for the OS to reap; nothing to restore.
});

describe('runRepositoryVerification receipt (#325)', () => {
  it('composes verdict.receipt with the per-stage evidence block from the fold', async () => {
    const root = makeProject();
    const context = createVerificationContext({
      project_root: root,
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
    });
    // Open a change and record a proven planning stage under a known session.
    const SES = 'rv-receipt-sess';
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    startStage(root, 'planning', { sessionId: SES, ordinal, adapter: 'claude-code' });
    const rel = '.paqad/artifacts/plan.md';
    mkdirSync(join(root, '.paqad/artifacts'), { recursive: true });
    writeFileSync(join(root, rel), '# plan\n');
    endStage(
      root,
      'planning',
      { artifactPaths: [rel] },
      {
        sessionId: SES,
        ordinal,
        adapter: 'claude-code',
      },
    );

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.receipt).toBeDefined();
    expect(verdict.receipt).toContain(verdict.summary);
    expect(verdict.receipt).toContain('planning — done');
  });
});

// Issue #472 — reconcile: a feature-development change whose gates pass but whose
// mandatory stages are not all recorded reads "Inconclusive", not "Safe to merge".
describe('runRepositoryVerification mandatory-stage reconcile (#472)', () => {
  function passingChecks(): StructuredTestResult {
    return {
      schema_version: '1.0.0',
      summary: {
        total: 12,
        passed: 12,
        failed: 0,
        skipped: 0,
        errored: 0,
        duration_ms: 0,
        timestamp: '2026-01-01T00:00:00.000Z',
        runner_id: 'vitest',
      },
      failures: [],
      warnings: [],
      parse_metadata: {
        raw_byte_size: 0,
        structured_byte_size: 0,
        compression_ratio: 1,
        original_size: 0,
        compact_size: 0,
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
  }

  /** Record a proven artifact-bearing stage (planning/specification) under a session. */
  function recordStage(root: string, stage: string, ses: string, ordinal: number): void {
    startStage(root, stage, { sessionId: ses, ordinal, adapter: 'claude-code' });
    const rel = `.paqad/artifacts/${stage}.md`;
    mkdirSync(join(root, '.paqad/artifacts'), { recursive: true });
    writeFileSync(join(root, rel), `# ${stage}\n`);
    endStage(
      root,
      stage,
      { artifactPaths: [rel] },
      { sessionId: ses, ordinal, adapter: 'claude-code' },
    );
  }

  /** Record a mutation stage (development/documentation_sync) — no artifact needed. */
  function recordMutationStage(root: string, stage: string, ses: string, ordinal: number): void {
    startStage(root, stage, { sessionId: ses, ordinal, adapter: 'claude-code' });
    endStage(root, stage, {}, { sessionId: ses, ordinal, adapter: 'claude-code' });
  }

  // ci-backstop is a non-hard origin, so the stage-evidence gate is informational
  // (skipped) even in strict mode — isolating the receipt reconcile: verdict.ok stays
  // true (gates + passing checks) while the fold still shows unrecorded stages. The
  // expected-module lists are cleared so change-completeness does not block on the
  // fixture's placeholder module-doc structure (unrelated to this reconcile).
  function featureDevContext(root: string) {
    return createVerificationContext({
      project_root: root,
      verification_origin: 'ci-backstop',
      verification_stage: 'backstop-completion',
      code_changed: true,
      test_files_changed: true,
      changed_files: ['src/feature.ts', 'tests/feature.test.ts'],
      changed_files_source: 'git-status',
      structured_test_results: [passingChecks()],
      modules: [],
      expected_ui_modules: [],
      expected_api_modules: [],
      expected_integration_modules: [],
      expected_error_catalog_modules: [],
    });
  }

  it('downgrades "Safe to merge" to Inconclusive and names the unrecorded mandatory stages', async () => {
    const root = makeProject();
    const context = featureDevContext(root);
    const SES = 'rv-472-gap';
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    // Everything but review + checks is recorded.
    recordStage(root, 'planning', SES, ordinal);
    recordStage(root, 'specification', SES, ordinal);
    recordMutationStage(root, 'development', SES, ordinal);
    recordMutationStage(root, 'documentation_sync', SES, ordinal);

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'ci-backstop',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    // Gates held, so ok stays true (exit codes / warn-mode semantics untouched)...
    expect(verdict.ok).toBe(true);
    // ...but the developer-facing verdict word is honest about the missing stages.
    expect(verdict.summary).toContain('Inconclusive');
    expect(verdict.summary).not.toContain('Safe to merge');
    expect(verdict.summary).toContain('mandatory stage(s) not recorded');
    expect(verdict.summary).toContain('review');
    expect(verdict.summary).toContain('checks');
    // The composed receipt embeds the reconciled headline and agrees with its 🟡 lines.
    expect(verdict.receipt).toContain(verdict.summary);
    expect(verdict.receipt).toContain('review — not recorded');
    expect(verdict.receipt).toContain('checks — not recorded');
  });

  it('leaves "Safe to merge" intact when every mandatory stage is recorded', async () => {
    const root = makeProject();
    const context = featureDevContext(root);
    const SES = 'rv-472-complete';
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    recordStage(root, 'planning', SES, ordinal);
    recordStage(root, 'specification', SES, ordinal);
    recordMutationStage(root, 'development', SES, ordinal);
    recordStage(root, 'review', SES, ordinal);
    recordMutationStage(root, 'checks', SES, ordinal);
    recordMutationStage(root, 'documentation_sync', SES, ordinal);

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'ci-backstop',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.summary).toContain('Safe to merge');
    expect(verdict.summary).not.toContain('mandatory stage(s) not recorded');
  });
});

describe('runRepositoryVerification (prebuilt context)', () => {
  it('returns a machine-readable ok verdict and streams it on the event bus', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
    });
    const bus = new EngineEventBus();
    const received: VerificationVerdictEvent[] = [];
    bus.subscribe(
      (event: EngineEvent) => {
        if (event.kind === 'verification-verdict') received.push(event);
      },
      { kinds: ['verification-verdict'] },
    );

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      eventBus: bus,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.origin).toBe('hook-completion');
    expect(verdict.gates.length).toBeGreaterThan(0);
    // The model-judgment gates are not run by the backstop -> reported skipped.
    expect(verdict.gates.find((g) => g.gate === 'story-quality')?.status).toBe('skipped');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: 'verification-verdict', ok: true });
    expect(received[0].gates.some((g) => g.gate === 'ac-test-mapping')).toBe(true);
  });

  it('refreshes module health for the touched modules after the gates run (#80)', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      modules: ['core'],
      changed_files: ['src/core/thing.ts'],
    });

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
    });

    // The backstop is the chokepoint that folds verification reality into each
    // touched module's health profile — without it the profile stays frozen at
    // its onboarding stub.
    const profilePath = join(context.project_root, '.paqad/module-health/core.json');
    expect(existsSync(profilePath)).toBe(true);
    const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
      module: string;
      history?: { events_count?: number };
    };
    expect(profile.module).toBe('core');
    expect(profile.history?.events_count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('blocks (ok=false) when a computed judgment input fails', async () => {
    const context = createVerificationContext({
      verification_origin: 'ci-backstop',
      verification_stage: 'backstop-completion',
      code_changed: true,
      changed_files: ['src/feature.ts'],
      changed_files_source: 'git-status',
      ac_test_mapping_passed: false,
    });

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'ci-backstop',
      prebuiltContext: { context, escalations: [] },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain('ac-test-mapping');
  });

  it('blocks on an unresolved decision via the implementation-review finding', async () => {
    const context = createVerificationContext({
      verification_origin: 'git-backstop',
      verification_stage: 'backstop-completion',
      implementation_review_passed: false,
      implementation_review_findings: [
        {
          kind: 'decision-violation',
          severity: 'error',
          detail: 'Change landed against unresolved decision D-7',
          decision_id: 'D-7',
        },
      ],
    });

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'git-backstop',
      prebuiltContext: { context, escalations: [] },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain('D-7');
  });
});

describe('runRepositoryVerification checks-evidence honesty (#368, AC-A2)', () => {
  it('records code-tests-lint INCONCLUSIVE for a feature-dev code change with no checks report', async () => {
    // ci-backstop: the stage-evidence gate is informational at a non-local origin, so
    // this isolates the checks signal — the ONLY not-ok reason is the missing report.
    const context = createVerificationContext({
      verification_origin: 'ci-backstop',
      verification_stage: 'backstop-completion',
      code_changed: true,
      changed_files: ['src/feature.ts'],
      changed_files_source: 'git-status',
      // No structured_test_results → `paqad-ai checks run` was never run this change.
    });

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'ci-backstop',
      prebuiltContext: { context, escalations: [] },
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const checks = verdict.gates.find((gate) => gate.gate === 'code-tests-lint');
    expect(checks?.status).toBe('inconclusive');
    // Inconclusive flips ok=false → the headline is "Inconclusive", never "Safe to merge".
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain('Inconclusive');
    expect(verdict.summary).not.toContain('Safe to merge');
  });

  it('leaves code-tests-lint skipped for a docs-only change (not feature development)', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      code_changed: false,
      changed_files: ['docs/thing.md'],
      changed_files_source: 'git-status',
    });

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const checks = verdict.gates.find((gate) => gate.gate === 'code-tests-lint');
    expect(checks?.status).toBe('skipped');
  });

  it('inconclusiveChecksGate is a non-blocking inconclusive gate naming the remediation', () => {
    const gate = inconclusiveChecksGate();
    expect(gate.name).toBe('code-tests-lint');
    expect(gate.status).toBe('inconclusive');
    expect(gate.detail).toContain('paqad-ai checks run');
  });
});

describe('runRepositoryVerification change-shape metrics (#362)', () => {
  it('records a change-metrics row and renders the change-shape line for a feature-dev change', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      code_changed: true,
      changed_files: ['src/feature.ts'],
      changed_files_source: 'git-status',
    });
    // Issue #468 Phase C — the change-metrics row lands in the ACTIVE feature's bundle now
    // (the retired project-scoped ledger write is gone), so open a feature under a known session.
    const SES = 'rv-metrics-sess';
    const sessionId = resolveSessionId(context.project_root, SES);
    const dir = openFeatureChange(context.project_root, sessionId, {
      adapter: 'claude-code',
      title: 'Feature',
      issue: null,
    });

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.receipt).toContain('change shape');
    // A row was recorded into the feature bundle's change-metrics.jsonl (no caches present
    // → n/a parts, but still recorded).
    expect(readChangeMetrics(context.project_root, dir).length).toBe(1);
  });

  it('emits no change-shape line and no row for a docs-only (non-feature-dev) change', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      code_changed: false,
      changed_files: ['docs/thing.md'],
      changed_files_source: 'git-status',
    });
    // Open a feature so the bundle assertion is meaningful: even with an active bundle, a
    // docs-only (non-feature-dev) change computes no metrics, so no row lands (issue #468 Phase C).
    const SES = 'rv-metrics-docs';
    const sessionId = resolveSessionId(context.project_root, SES);
    const dir = openFeatureChange(context.project_root, sessionId, {
      adapter: 'claude-code',
      title: 'Feature',
      issue: null,
    });

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.receipt ?? '').not.toContain('change shape');
    expect(readChangeMetrics(context.project_root, dir)).toHaveLength(0);
  });
});

describe('runRepositoryVerification (built from repository reality)', () => {
  it('passes for a clean change in a freshly onboarded project and writes evidence', async () => {
    const root = makeProject();
    setChangedFiles(root, ['README.md']);

    const verdict = await runRepositoryVerification({ projectRoot: root, origin: 'ci-backstop' });

    expect(verdict.ok).toBe(true);
    expect(verdict.evidence_path).not.toBeNull();
    expect(existsSync(join(root, '.paqad/session/verification-evidence.json'))).toBe(true);
  });

  it('blocks when a frozen acceptance criterion has no proving check', async () => {
    const root = makeProject();
    setChangedFiles(root, ['src/feature.ts']);
    writeTraceabilityMap(root, {
      schema_version: '1.0.0',
      generated_at: '2026-01-01T00:00:00.000Z',
      lane: 'full',
      mode: 'full',
      anchors_known: true,
      blocked_reason: null,
      forward: [
        {
          promise_id: 'AC-1',
          source: 'acceptance-criterion',
          description: 'must work',
          delivering_code: ['src/feature.ts'],
          proving_checks: [],
          proven: false,
        },
      ],
      backward: [],
      findings: [],
      counts: {
        promises: 1,
        untested_promises: 1,
        delivers_promise: 0,
        shared_groundwork: 0,
        orphan_code: 0,
      },
    });

    const verdict = await runRepositoryVerification({ projectRoot: root, origin: 'ci-backstop' });

    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain('AC-1');
  });
});
