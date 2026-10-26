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
import { PATHS } from '@/core/constants/paths.js';

import { createVerificationContext, ownInFlightChange } from '../shared.fixture.js';
import { seedGitChangedFiles } from '../../pipeline/changed-files.fixture.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-repo-verify-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad/session'), { recursive: true });
  return root;
}

function writeTraceabilityMap(root: string, map: TraceabilityMap): void {
  mkdirSync(join(root, '.paqad/traceability'), { recursive: true });
  writeFileSync(join(root, '.paqad/traceability/map.json'), JSON.stringify(map));
}

afterEach(() => {});

describe('runRepositoryVerification receipt', () => {
  it('composes verdict.receipt with the per-stage evidence block from the fold', async () => {
    const root = makeProject();
    const context = createVerificationContext({
      project_root: root,
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
    });
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

describe('runRepositoryVerification mandatory-stage reconcile', () => {
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

  function recordMutationStage(root: string, stage: string, ses: string, ordinal: number): void {
    startStage(root, stage, { sessionId: ses, ordinal, adapter: 'claude-code' });
    endStage(root, stage, {}, { sessionId: ses, ordinal, adapter: 'claude-code' });
  }

  function featureDevContext(root: string) {
    return createVerificationContext({
      project_root: root,
      verification_origin: 'ci-backstop',
      verification_stage: 'backstop-completion',
      code_changed: true,
      test_files_changed: true,
      changed_files: ['src/feature.ts', 'tests/feature.test.ts'],
      changed_files_source: 'git',
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

    expect(verdict.ok).toBe(true);
    expect(verdict.summary).toContain('Inconclusive');
    expect(verdict.summary).not.toContain('Safe to merge');
    expect(verdict.summary).toContain('No record yet for');
    expect(verdict.summary).toContain('review');
    expect(verdict.summary).toContain('checks');
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
    expect(verdict.summary).not.toContain('No record yet for');
  });
});

describe('runRepositoryVerification (prebuilt context)', () => {
  it('returns a machine-readable ok verdict and streams it on the event bus', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
    });
    ownInFlightChange(context.project_root);
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
    expect(verdict.gates.find((g) => g.gate === 'story-quality')?.status).toBe('skipped');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: 'verification-verdict', ok: true });
    expect(received[0].gates.some((g) => g.gate === 'ac-test-mapping')).toBe(true);
  });

  it('refreshes module health for the touched modules after the gates run', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      modules: ['core'],
      changed_files: ['src/core/thing.ts'],
    });
    ownInFlightChange(context.project_root);

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
    });

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
      changed_files_source: 'git',
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

describe('runRepositoryVerification checks-evidence honesty', () => {
  it('records code-tests-lint INCONCLUSIVE for a feature-dev code change with no checks report', async () => {
    const context = createVerificationContext({
      verification_origin: 'ci-backstop',
      verification_stage: 'backstop-completion',
      code_changed: true,
      changed_files: ['src/feature.ts'],
      changed_files_source: 'git',
    });

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'ci-backstop',
      prebuiltContext: { context, escalations: [] },
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const checks = verdict.gates.find((gate) => gate.gate === 'code-tests-lint');
    expect(checks?.status).toBe('inconclusive');
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
      changed_files_source: 'git',
    });
    ownInFlightChange(context.project_root);

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const checks = verdict.gates.find((gate) => gate.gate === 'code-tests-lint');
    expect(checks?.status).toBe('skipped');
    expect(checks?.skip_kind).toBe('not-required');
    expect(checks?.detail).toBe('No code changed, so there were no tests to check.');
    expect(verdict.gates.find((gate) => gate.gate === 'story-quality')?.skip_kind).toBe(
      'did-not-run',
    );
    expect(verdict.summary).toContain(': did not run (not checked in this run)');
    expect(verdict.summary).not.toContain('code tests lint');
  });

  it('inconclusiveChecksGate is a non-blocking inconclusive gate naming the remediation', () => {
    const gate = inconclusiveChecksGate();
    expect(gate.name).toBe('code-tests-lint');
    expect(gate.status).toBe('inconclusive');
    expect(gate.detail).toContain('paqad-ai checks run');
  });

  it('FAILS a feature-dev change whose applicable rules were never loaded', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      code_changed: true,
      changed_files: ['src/feature.ts'],
      changed_files_source: 'git',
    });
    mkdirSync(join(context.project_root, '.paqad'), { recursive: true });
    writeFileSync(
      join(context.project_root, PATHS.COMPILED_RULES),
      JSON.stringify({
        schema_version: 1,
        generated_at: 'now',
        source_hash: 'x',
        rules: [
          {
            rule_id: 'RULE-2',
            title: 'Constitution',
            source_path: 'a.md',
            trigger_patterns: ['**'],
            severity: 'must',
            summary: 's',
            raw_text: '# body',
          },
        ],
      }),
    );
    const SES = 'rv-rules-loaded-sess';
    const sessionId = resolveSessionId(context.project_root, SES);
    openFeatureChange(context.project_root, sessionId, {
      adapter: 'claude-code',
      title: 'Feature',
      issue: null,
    });
    ownInFlightChange(context.project_root, SES);

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const rules = verdict.gates.find((gate) => gate.gate === 'rules-loaded');
    expect(rules?.status).toBe('fail');
    expect(rules?.remediation).toContain('paqad-ai rules load');
    expect(verdict.ok).toBe(false);
  });
});

describe('runRepositoryVerification change-shape metrics', () => {
  it('records a change-metrics row and renders the change-shape line for a feature-dev change', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      code_changed: true,
      changed_files: ['src/feature.ts'],
      changed_files_source: 'git',
    });
    const SES = 'rv-metrics-sess';
    const sessionId = resolveSessionId(context.project_root, SES);
    const dir = openFeatureChange(context.project_root, sessionId, {
      adapter: 'claude-code',
      title: 'Feature',
      issue: null,
    });
    ownInFlightChange(context.project_root, SES);

    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.receipt).toContain('change shape');
    expect(readChangeMetrics(context.project_root, dir).length).toBe(1);
  });

  it('emits no change-shape line and no row for a docs-only (non-feature-dev) change', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      code_changed: false,
      changed_files: ['docs/thing.md'],
      changed_files_source: 'git',
    });
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
    seedGitChangedFiles(root, ['README.md']);

    const verdict = await runRepositoryVerification({ projectRoot: root, origin: 'ci-backstop' });

    expect(verdict.ok).toBe(true);
    expect(verdict.evidence_path).not.toBeNull();
    expect(existsSync(join(root, '.paqad/session/verification-evidence.json'))).toBe(true);
  });

  it('AC-32: a whole-tree map on disk with no frozen spec does not decide the AC gate: it reads not required', async () => {
    const root = makeProject();
    seedGitChangedFiles(root, ['src/feature.ts']);
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

    const acGate = verdict.gates.find((gate) => gate.gate === 'ac-test-mapping');
    expect(acGate).toMatchObject({ status: 'skipped', skip_kind: 'not-required' });
    expect(acGate?.detail).toBe('No frozen spec, so no acceptance criteria to map.');
  });
});
