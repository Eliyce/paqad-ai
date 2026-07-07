import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ChangeCompletenessGate } from '@/verification/gates/change-completeness.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('ChangeCompletenessGate', () => {
  const gate = new ChangeCompletenessGate();

  it('passes when code, tests, docs, and blockers are all clear', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
        structured_test_results: [
          {
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
            evidence_scope: {
              related_paths: ['src/service.ts'],
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      passed: true,
      detail: expect.stringContaining('Change completeness: complete'),
    });
  });

  it('passes when no code changes were detected and no blockers remain', async () => {
    const result = await gate.check(createVerificationContext());

    expect(result.passed).toBe(true);
    expect(result.detail).toContain('Change completeness: complete');
    expect(result.detail).toContain('No code diff detected');
  });

  it('fails as incomplete when code changed without test evidence', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/billing/service.ts'],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Change completeness: incomplete');
    expect(result.detail).toContain('No test evidence recorded for changed code');
  });

  it('blocks on out-of-scope changes outside the spec boundary (issue #117 C-4)', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        changed_files: ['src/feature/a.ts', 'src/unrelated/x.ts'],
        spec_boundary: ['src/feature', 'tests', 'docs'],
      }),
    );

    expect(result.passed).toBe(false);
    const driftClause = result.detail.split('Remaining work')[0];
    expect(driftClause).toContain('Out-of-scope changes outside the spec boundary');
    expect(driftClause).toContain('src/unrelated/x.ts');
    expect(driftClause).not.toContain('src/feature/a.ts');
  });

  it('does not flag scope drift when every change sits inside the boundary', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        changed_files: ['src/feature/a.ts'],
        spec_boundary: ['src/feature'],
      }),
    );

    expect(result.detail).not.toContain('Out-of-scope');
  });

  it('accepts scope-mapped structured test results as test evidence', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
        structured_test_results: [
          {
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
            evidence_scope: {
              related_paths: ['src/service.ts'],
            },
          },
        ],
      }),
    );

    expect(result.passed).toBe(true);
  });

  it('fails as incomplete when only weak test evidence exists', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: true,
        changed_files: ['src/service.ts', 'tests/unit/service.test.ts'],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Only weak test evidence recorded for changed code');
  });

  it('includes unresolved stale doc targets as incomplete work when the drift doc exists', async () => {
    const context = createVerificationContext({
      code_changed: true,
      test_files_changed: true,
      changed_files: ['src/pipeline/router.ts'],
      stale_doc_targets: [
        {
          target_path: 'docs/maintainers/architecture-map.md',
          ownership_kind: 'implementation-drift',
          owners: ['src/pipeline/router.ts'],
          reason: 'Routing changes can stale architecture ownership mappings.',
        },
      ],
    });
    // The drift doc EXISTS, so a code change legitimately flags it for review.
    mkdirSync(join(context.project_root, 'docs/maintainers'), { recursive: true });
    writeFileSync(join(context.project_root, 'docs/maintainers/architecture-map.md'), '# Map\n');

    const result = await gate.check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Change completeness: incomplete');
    expect(result.detail).toContain('Canonical docs not updated for changed code');
    expect(result.detail).toContain('src/pipeline/router.ts');
  });

  it('does not flag a framework-assumed drift doc that the project never created', async () => {
    // docs/maintainers/architecture-map.md is NOT on disk (onboarding never seeds it)
    // and the diff did not create it — a code change cannot stale an uncreated doc, so
    // it is not blocking incomplete work. Weak test evidence still blocks in-session.
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/pipeline/router.ts'],
        structured_test_results: [],
        stale_doc_targets: [
          {
            target_path: 'docs/maintainers/architecture-map.md',
            ownership_kind: 'implementation-drift',
            owners: ['src/pipeline/router.ts'],
            reason: 'Routing changes can stale architecture ownership mappings.',
          },
        ],
      }),
    );

    expect(result.detail).not.toContain('Canonical docs not updated');
  });

  // Issue #307 dogfood — test-evidence strength is a provider-workflow concern the
  // agent-independent backstop cannot collect. It escalates there (see
  // repository-context), so change-completeness must NOT hard-block on it.
  it('does not block on missing test evidence at a backstop origin (hook-completion)', async () => {
    const result = await gate.check(
      createVerificationContext({
        verification_origin: 'hook-completion',
        code_changed: true,
        test_files_changed: true,
        changed_files: ['src/service.ts', 'tests/unit/service.test.ts'],
        structured_test_results: [],
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.detail).not.toContain('weak test evidence');
  });

  it('still blocks on missing test evidence in-session (provider-workflow origin)', async () => {
    const result = await gate.check(
      createVerificationContext({
        verification_origin: 'provider-workflow',
        code_changed: true,
        test_files_changed: true,
        changed_files: ['src/service.ts', 'tests/unit/service.test.ts'],
        structured_test_results: [],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Only weak test evidence recorded for changed code');
  });

  it('reports blockers before remaining incomplete work', async () => {
    const result = await gate.check(
      createVerificationContext({
        requirements_complete: false,
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Change completeness: blocked');
    expect(result.detail).toContain('Requirements are incomplete');
    expect(result.detail).toContain('Remaining work: No test evidence recorded for changed code');
  });

  it('surfaces mapping, spec review, and architecture blockers', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: true,
        changed_files: ['src/service.ts', 'tests/unit/service.test.ts'],
        ac_test_mapping_passed: false,
        spec_review_passed: false,
        architecture_compliant: false,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Acceptance criteria are not mapped to tests');
    expect(result.detail).toContain('Spec review failed');
    expect(result.detail).toContain('Architecture compliance failed');
  });

  it('treats structured test failures as blockers', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: true,
        changed_files: ['src/service.ts', 'tests/unit/service.test.ts'],
        structured_test_results: [
          {
            schema_version: '1.0.0',
            summary: {
              total: 1,
              passed: 0,
              failed: 1,
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
            evidence_scope: {
              related_paths: ['src/service.ts'],
            },
          },
        ],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Structured test results report failures for vitest');
  });

  it('treats degraded structured test parsing as a blocker', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: true,
        changed_files: ['src/service.ts', 'tests/unit/service.test.ts'],
        structured_test_results: [
          {
            schema_version: '1.0.0',
            summary: {
              total: 0,
              passed: 0,
              failed: 0,
              skipped: 0,
              errored: 0,
              duration_ms: 0,
              timestamp: '1970-01-01T00:00:00.000Z',
              runner_id: 'vitest',
            },
            failures: [],
            warnings: [],
            parse_metadata: {
              raw_byte_size: 10,
              structured_byte_size: 0,
              compression_ratio: 1,
              original_size: 10,
              compact_size: 0,
              reduction_ratio: 1,
              delta_mode_used: false,
              escalation_occurred: false,
              escalation_reason: null,
              delta_summary: null,
              parse_strategy: 'degraded',
              parse_warnings: ['empty'],
            },
            errors: [],
            evidence_scope: {
              related_paths: ['src/service.ts'],
            },
          },
        ],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('could not be fully parsed');
  });

  it('surfaces canonical documentation, registry, and glossary blockers', async () => {
    const context = createVerificationContext({
      code_changed: true,
      test_files_changed: false,
      changed_files: ['src/service.ts'],
      registry_refreshed_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(),
      glossary_updated: false,
      structured_test_results: [
        {
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
          evidence_scope: {
            related_paths: ['src/service.ts'],
          },
        },
      ],
    });
    rmSync(join(context.project_root, 'docs/modules/core/api/endpoints.md'));

    const result = await gate.check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Canonical documentation is missing or invalid');
    expect(result.detail).toContain('Registries are stale');
    expect(result.detail).toContain('Glossary is out of date');
  });

  it('surfaces lint, implementation review, behavioral correctness, and database blockers', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
        code_tests_lint_passed: false,
        implementation_review_passed: false,
        behavioral_correctness_passed: false,
        database_quality_passed: false,
        structured_test_results: [
          {
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
            evidence_scope: {
              related_paths: ['src/service.ts'],
            },
          },
        ],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Code, tests, or lint checks failed');
    expect(result.detail).toContain('Implementation review failed');
    expect(result.detail).toContain('Behavioral correctness checks failed');
    expect(result.detail).toContain('Database quality checks failed');
  });

  it('surfaces invalid canonical documentation as a blocker', async () => {
    const context = createVerificationContext({
      code_changed: true,
      test_files_changed: true,
      changed_files: ['src/service.ts', 'tests/unit/service.test.ts'],
    });
    writeFileSync(join(context.project_root, 'docs/modules/core/error-catalog.md'), '# broken');

    const result = await gate.check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Invalid error catalog');
  });

  it('falls back to unknown files in the missing-test-evidence reason', async () => {
    const result = await gate.check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: [],
      }),
    );

    expect(result.detail).toContain('unknown files');
  });
});
