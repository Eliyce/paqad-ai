import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createEvidence,
  persistEvidence,
  syncModuleHealth,
  syncModuleHealthFromVerification,
  toProjectRelative,
} from '@/planning/module-health-updater.js';
import { readModuleHealth, writeModuleHealth } from '@/planning/module-health.js';
import type { GateResult, VerificationContext } from '@/core/types/verification.js';

describe('module-health-updater', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'module-health-updater-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('updates change velocity from tracked changed files without inventing coverage', async () => {
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/session/changed-files.json'),
      JSON.stringify(['src/planning/a.ts']),
    );

    const result = await syncModuleHealth({
      projectRoot: root,
      provider: 'codex-cli',
      source: 'provider-hook',
      silent: true,
    });

    expect(result.updated_profiles).toEqual(['planning']);
    await expect(readModuleHealth(root, 'planning')).resolves.toMatchObject({
      module: 'planning',
      tier: 'unknown',
      metrics: {
        coverage_pct: null,
        change_velocity: 1,
      },
    });
  });

  it('counts repeated provider sessions with the same changed files as distinct velocity events', async () => {
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/session/changed-files.json'),
      JSON.stringify(['src/planning/a.ts']),
    );

    await syncModuleHealth({
      projectRoot: root,
      provider: 'codex-cli',
      source: 'provider-hook',
      silent: true,
    });
    await syncModuleHealth({
      projectRoot: root,
      provider: 'codex-cli',
      source: 'provider-hook',
      silent: true,
    });

    await expect(readModuleHealth(root, 'planning')).resolves.toMatchObject({
      metrics: { change_velocity: 2 },
    });
  });

  it('collects preflight changed-file evidence with default source metadata', async () => {
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    // Use a path that maps to no module so the collected evidence is not
    // consumed (and therefore not deleted) in the same sync — this test only
    // verifies collection metadata, not consumption.
    writeFileSync(join(root, '.paqad/session/changed-files.json'), JSON.stringify(['README.md']));

    await syncModuleHealth({
      projectRoot: root,
      preflight: true,
      silent: true,
    });

    const evidenceFiles = readdirSync(join(root, '.paqad/module-health-evidence'));
    const event = JSON.parse(
      readFileSync(join(root, '.paqad/module-health-evidence', evidenceFiles[0]!), 'utf8'),
    );
    expect(event.source).toBe('preflight');
  });

  it('deletes evidence files once they are consumed into module profiles', async () => {
    const event = createEvidence({
      source: 'provider-hook',
      provider: 'codex-cli',
      affectedFiles: ['src/planning/a.ts'],
    });
    await persistEvidence(root, event);
    const evidenceFile = join(root, '.paqad/module-health-evidence', `${event.event_id}.json`);
    expect(existsSync(evidenceFile)).toBe(true);

    const result = await syncModuleHealth({ projectRoot: root, silent: true });

    // The event was applied to the 'planning' profile, so its evidence file is
    // removed — but the metric it contributed survives in the profile.
    expect(result.processed_events).toBe(1);
    expect(existsSync(evidenceFile)).toBe(false);
    await expect(readModuleHealth(root, 'planning')).resolves.toMatchObject({
      metrics: { change_velocity: 1 },
    });
  });

  it('cleans up a backlog evidence file already recorded in the consumed index', async () => {
    const event = createEvidence({
      source: 'provider-hook',
      provider: 'codex-cli',
      affectedFiles: ['src/planning/a.ts'],
    });
    await persistEvidence(root, event);
    await syncModuleHealth({ projectRoot: root, silent: true });

    // Re-persist the same event (simulating a pre-cleanup backlog file) and sync
    // again: it is already in the consumed index, so it is skipped and removed.
    await persistEvidence(root, event);
    const evidenceFile = join(root, '.paqad/module-health-evidence', `${event.event_id}.json`);
    expect(existsSync(evidenceFile)).toBe(true);

    await syncModuleHealth({ projectRoot: root, silent: true });

    expect(existsSync(evidenceFile)).toBe(false);
  });

  it('creates empty evidence lists when no files or modules are supplied', () => {
    const event = createEvidence({ source: 'provider-hook' });

    expect(event.affected_files).toEqual([]);
    expect(event.affected_modules).toEqual([]);
  });

  it('does not double-count duplicate evidence events', async () => {
    const event = createEvidence({
      source: 'provider-hook',
      provider: 'codex-cli',
      affectedFiles: ['src/planning/a.ts'],
    });
    await persistEvidence(root, event);

    await syncModuleHealth({ projectRoot: root, silent: true });
    await syncModuleHealth({ projectRoot: root, silent: true });

    await expect(readModuleHealth(root, 'planning')).resolves.toMatchObject({
      metrics: { change_velocity: 1 },
    });
  });

  it('does not replay retained evidence after profile processed ids are capped', async () => {
    for (let index = 0; index < 51; index += 1) {
      await persistEvidence(
        root,
        createEvidence({
          source: 'provider-hook',
          provider: 'codex-cli',
          sessionId: `session-${index}`,
          affectedFiles: ['src/planning/a.ts'],
        }),
      );
    }

    await syncModuleHealth({ projectRoot: root, silent: true });
    await expect(readModuleHealth(root, 'planning')).resolves.toMatchObject({
      metrics: { change_velocity: 51 },
      history: { events_count: 51 },
    });

    await expect(syncModuleHealth({ projectRoot: root, silent: true })).resolves.toMatchObject({
      processed_events: 0,
      updated_profiles: [],
    });
    await expect(readModuleHealth(root, 'planning')).resolves.toMatchObject({
      metrics: { change_velocity: 51 },
      history: { events_count: 51 },
    });
  });

  it('applies failed verification to defect frequency and contract stability', async () => {
    const verificationContext = createVerificationContext({
      modules: ['health'],
      changed_files: ['src/health/checker.ts'],
    });
    const results: GateResult[] = [
      { gate: 'code-tests-lint', passed: false, detail: 'tests failed' },
      { gate: 'documentation-freshness', passed: true, detail: 'docs current' },
    ];

    await syncModuleHealthFromVerification({
      projectRoot: root,
      verificationContext,
      results,
      provider: 'claude-code',
    });

    await expect(readModuleHealth(root, 'health')).resolves.toMatchObject({
      tier: 'fragile',
      metrics: {
        defect_frequency: 1,
        contract_stability: 0.7,
        change_velocity: 1,
      },
      evidence: {
        last_provider: 'claude-code',
        last_verification_status: 'fail',
      },
    });
  });

  it('rolls a mature mutation kill rate into the module metric', async () => {
    const verificationContext = createVerificationContext({
      modules: ['health'],
      changed_files: ['src/health/checker.ts'],
      mutation_result: {
        tool: 'stryker',
        language: 'typescript',
        confidence: 'mature',
        scoped_files: ['src/health/checker.ts'],
        total_mutants: 4,
        killed: 3,
        survived: 1,
        equivalent_set_aside: 0,
        kill_rate: 75,
        surviving_mutants: [],
        tree_clean: true,
        status: 'survivors',
        skipped_reason: null,
      },
    });

    await syncModuleHealthFromVerification({
      projectRoot: root,
      verificationContext,
      results: [{ gate: 'documentation-freshness', passed: true, detail: 'ok' }],
    });

    await expect(readModuleHealth(root, 'health')).resolves.toMatchObject({
      metrics: { mutation_score: 75 },
    });
  });

  it('does not roll a lower-confidence or skipped mutation result into the metric', async () => {
    const verificationContext = createVerificationContext({
      modules: ['health'],
      changed_files: ['src/health/checker.ts'],
      mutation_result: {
        tool: null,
        language: 'elixir',
        confidence: 'lower',
        scoped_files: ['lib/health.ex'],
        total_mutants: 2,
        killed: 2,
        survived: 0,
        equivalent_set_aside: 0,
        kill_rate: 100,
        surviving_mutants: [],
        tree_clean: true,
        status: 'lower-confidence',
        skipped_reason: null,
      },
    });

    await syncModuleHealthFromVerification({
      projectRoot: root,
      verificationContext,
      results: [{ gate: 'documentation-freshness', passed: true, detail: 'ok' }],
    });

    expect((await readModuleHealth(root, 'health'))?.metrics.mutation_score ?? null).toBeNull();
  });

  it('uses coverage only when coverage evidence exists', async () => {
    const passWithoutCoverage = createEvidence({
      source: 'verification-gate',
      affectedFiles: ['src/planning/a.ts'],
      affectedModules: ['planning'],
      signals: {
        tests: { status: 'pass', passed: 3, failed: 0, errored: 0 },
        verification: { status: 'pass', gates_passed: ['code-tests-lint'], gates_failed: [] },
      },
    });
    await persistEvidence(root, passWithoutCoverage);
    await syncModuleHealth({ projectRoot: root, silent: true });
    expect((await readModuleHealth(root, 'planning'))?.metrics.coverage_pct).toBeNull();

    const passWithCoverage = createEvidence({
      source: 'verification-gate',
      affectedFiles: ['src/planning/a.ts'],
      affectedModules: ['planning'],
      signals: {
        tests: { status: 'pass', passed: 3, failed: 0, errored: 0, coverage_pct: 84 },
        verification: { status: 'pass', gates_passed: ['code-tests-lint'], gates_failed: [] },
      },
    });
    await persistEvidence(root, passWithCoverage);
    await syncModuleHealth({ projectRoot: root, silent: true });

    await expect(readModuleHealth(root, 'planning')).resolves.toMatchObject({
      tier: 'stable',
      metrics: {
        coverage_pct: 84,
        defect_frequency: 0,
        contract_stability: 0.9,
      },
    });
  });

  it('uses test-only verification status and preserves prior success history on later file evidence', async () => {
    await persistEvidence(
      root,
      createEvidence({
        source: 'verification-gate',
        affectedModules: ['planning'],
        signals: {
          tests: { status: 'pass', passed: 1, failed: 0, errored: 0 },
        },
      }),
    );
    await syncModuleHealth({ projectRoot: root, silent: true });

    const first = await readModuleHealth(root, 'planning');
    expect(first?.evidence?.last_verification_status).toBe('pass');
    expect(first?.history?.last_success_at).toBeTruthy();

    await persistEvidence(
      root,
      createEvidence({
        source: 'provider-hook',
        affectedFiles: ['src/planning/later.ts'],
      }),
    );
    await syncModuleHealth({ projectRoot: root, silent: true });

    expect((await readModuleHealth(root, 'planning'))?.history?.last_success_at).toBe(
      first?.history?.last_success_at,
    );
  });

  it('lowers contract stability when passing verification leaves docs stale', async () => {
    await persistEvidence(
      root,
      createEvidence({
        source: 'verification-gate',
        affectedModules: ['planning'],
        signals: {
          verification: {
            status: 'pass',
            gates_passed: ['documentation-freshness'],
            gates_failed: [],
          },
          docs: { doc_targets_total: 1, doc_targets_missing: 1 },
        },
      }),
    );

    await syncModuleHealth({ projectRoot: root, silent: true });

    expect((await readModuleHealth(root, 'planning'))?.metrics.contract_stability).toBe(0.8);
  });

  it('preserves corrupt profiles before repairing from evidence', async () => {
    mkdirSync(join(root, '.paqad/module-health'), { recursive: true });
    writeFileSync(join(root, '.paqad/module-health/planning.json'), '{bad');
    await persistEvidence(
      root,
      createEvidence({
        source: 'provider-hook',
        affectedFiles: ['src/planning/a.ts'],
      }),
    );

    await syncModuleHealth({ projectRoot: root, silent: true });

    expect(existsSync(join(root, '.paqad/module-health/planning.json'))).toBe(true);
    expect(
      readdirSync(join(root, '.paqad/module-health')).some((file) =>
        file.startsWith('planning.json.corrupt-'),
      ),
    ).toBe(true);
    expect(
      JSON.parse(readFileSync(join(root, '.paqad/module-health/planning.json'), 'utf8')),
    ).toMatchObject({ module: 'planning' });
  });

  it('is a no-op when no evidence exists', async () => {
    await expect(syncModuleHealth({ projectRoot: root, silent: true })).resolves.toMatchObject({
      processed_events: 0,
      updated_profiles: [],
      skipped: false,
    });
  });

  it('skips instead of corrupting json when the lock is held', async () => {
    mkdirSync(join(root, '.paqad/locks/module-health.lock'), { recursive: true });

    await expect(syncModuleHealth({ projectRoot: root, silent: true })).resolves.toMatchObject({
      skipped: true,
      reason: 'locked',
    });
  });

  it('keeps existing writer compatibility', async () => {
    await writeModuleHealth(root, 'planning', {
      coverage_pct: 80,
      defect_frequency: 2,
      contract_stability: 0.85,
    });

    await expect(readModuleHealth(root, 'planning')).resolves.toMatchObject({ tier: 'stable' });
  });

  it('reports malformed evidence and ignores non-array changed-file artifacts', async () => {
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    writeFileSync(join(root, '.paqad/session/changed-files.json'), JSON.stringify({ files: [] }));
    mkdirSync(join(root, '.paqad/module-health-evidence'), { recursive: true });
    writeFileSync(join(root, '.paqad/module-health-evidence/bad.json'), '{');
    writeFileSync(
      join(root, '.paqad/module-health-evidence/schema.json'),
      JSON.stringify({ schema_version: 1, event_id: 'mh-bad' }),
    );

    await expect(syncModuleHealth({ projectRoot: root, silent: true })).resolves.toMatchObject({
      processed_events: 0,
    });
    expect(readFileSync(join(root, '.paqad/logs/module-health.log'), 'utf8')).toContain(
      'evidence-ignored',
    );
  });

  it('reports unresolved evidence without creating noisy one-off profiles', async () => {
    await persistEvidence(
      root,
      createEvidence({
        source: 'provider-hook',
        affectedFiles: ['README.md'],
      }),
    );

    await expect(syncModuleHealth({ projectRoot: root, silent: true })).resolves.toMatchObject({
      processed_events: 0,
      updated_profiles: [],
    });
    expect(readFileSync(join(root, '.paqad/logs/module-health.log'), 'utf8')).toContain(
      'could not be mapped',
    );
  });

  it('handles unreadable evidence directories as an empty pending set', async () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/module-health-evidence'), '');

    await expect(syncModuleHealth({ projectRoot: root, silent: true })).resolves.toMatchObject({
      processed_events: 0,
      updated_profiles: [],
    });
  });

  it('maps known docs modules and compliance coverage into profiles', async () => {
    mkdirSync(join(root, 'docs/modules/billing'), { recursive: true });
    mkdirSync(join(root, 'docs/modules/accounts'), { recursive: true });
    await persistEvidence(
      root,
      createEvidence({
        source: 'workflow-phase',
        affectedFiles: ['src/domain/billing/service.ts'],
        signals: {
          compliance: {
            covered_obligations: 3,
            total_obligations: 4,
            uncovered_critical: 1,
          },
          defects: { new: 1, recurring: 1 },
          scope: { scope_violations: 1 },
        },
      }),
    );

    await syncModuleHealth({ projectRoot: root, silent: true });

    await expect(readModuleHealth(root, 'billing')).resolves.toMatchObject({
      metrics: {
        coverage_pct: 75,
        defect_frequency: 4,
      },
    });
  });

  it('covers fallback module resolution for common source roots', async () => {
    await persistEvidence(
      root,
      createEvidence({
        source: 'provider-hook',
        affectedFiles: [
          'lib/reporting/index.ts',
          'app/api/users.ts',
          'tests/unit/session/handoff.test.ts',
          'README.md',
        ],
      }),
    );

    await syncModuleHealth({ projectRoot: root, silent: true });

    await expect(readModuleHealth(root, 'reporting')).resolves.toMatchObject({
      metrics: { change_velocity: 1 },
    });
    await expect(readModuleHealth(root, 'api')).resolves.toMatchObject({
      metrics: { change_velocity: 1 },
    });
    await expect(readModuleHealth(root, 'session')).resolves.toMatchObject({
      metrics: { change_velocity: 1 },
    });
  });

  it('throws in non-silent mode when evidence cannot be written and audits the failure', async () => {
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    writeFileSync(join(root, '.paqad/session/changed-files.json'), JSON.stringify(['src/a.ts']));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/module-health-evidence'), '');

    await expect(syncModuleHealth({ projectRoot: root, silent: false })).rejects.toThrow();
    expect(readFileSync(join(root, '.paqad/audit.log'), 'utf8')).toContain('updater-failure');
  });

  it('returns failure details in silent mode when evidence cannot be written', async () => {
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    writeFileSync(join(root, '.paqad/session/changed-files.json'), JSON.stringify(['src/a.ts']));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/module-health-evidence'), '');

    await expect(syncModuleHealth({ projectRoot: root, silent: true })).resolves.toMatchObject({
      skipped: true,
      reason: 'failure',
    });
  });

  it('isolates verification evidence write failures as non-blocking updater failures', async () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/module-health-evidence'), '');

    await expect(
      syncModuleHealthFromVerification({
        projectRoot: root,
        verificationContext: createVerificationContext(),
        results: [{ gate: 'code-tests-lint', passed: true, detail: 'ok' }],
      }),
    ).resolves.toMatchObject({
      processed_events: 0,
      updated_profiles: [],
      skipped: true,
      reason: 'failure',
    });
    expect(readFileSync(join(root, '.paqad/audit.log'), 'utf8')).toContain('updater-failure');
  });

  it('normalizes absolute paths to project-relative paths', () => {
    expect(toProjectRelative(root, join(root, 'src/planning/file.ts'))).toBe(
      'src/planning/file.ts',
    );
  });
});

function createVerificationContext(
  overrides: Partial<VerificationContext> = {},
): VerificationContext {
  return {
    project_root: '/tmp/project',
    modules: ['planning'],
    changed_files: ['src/planning/a.ts'],
    changed_files_source: 'session-artifact',
    code_changed: true,
    test_files_changed: false,
    documentation_files_changed: false,
    stale_doc_targets: [],
    requirements_complete: true,
    story_quality_passed: true,
    ac_test_mapping_passed: true,
    spec_review_passed: true,
    architecture_compliant: true,
    code_tests_lint_passed: true,
    implementation_review_passed: true,
    behavioral_correctness_passed: true,
    database_quality_passed: true,
    expected_ui_modules: [],
    expected_api_modules: [],
    expected_integration_modules: [],
    expected_error_catalog_modules: [],
    registry_refreshed_at: new Date().toISOString(),
    glossary_updated: true,
    ...overrides,
  };
}
