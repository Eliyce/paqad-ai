import { describe, expect, it } from 'vitest';

import { buildChangeClosureSummary } from '@/pipeline/change-closure-summary.js';

describe('buildChangeClosureSummary', () => {
  it('reports changed code, test evidence, canonical docs, and blockers', () => {
    const summary = buildChangeClosureSummary({
      changed_files: [
        'src/pipeline/lane-runner.ts',
        'tests/unit/pipeline/lane-runner.test.ts',
        'docs/modules/session/index/summary.md',
      ],
      phases: [
        {
          phase: 'verification-gates',
          status: 'fail',
          summary: 'Verification blocked',
          artifacts: [],
        },
      ],
      verification_results: [
        {
          gate: 'change-completeness',
          passed: false,
          detail: 'Change completeness: blocked. Blockers: Story quality checks failed.',
          remediation: 'Fix the review findings.',
        },
      ],
    });

    expect(summary).toEqual({
      code_changed: true,
      test_evidence_changed: true,
      canonical_docs_changed: true,
      blocked: true,
      primary_blocking_reason:
        'change-completeness: Change completeness: blocked. Blockers: Story quality checks failed.',
      summary:
        'Closure summary: code changed=yes; test evidence changed=yes; canonical docs changed=yes; blocked=yes; primary blocker=change-completeness: Change completeness: blocked. Blockers: Story quality checks failed..',
    });
  });

  it('falls back to phase failure when verification results are unavailable', () => {
    const summary = buildChangeClosureSummary({
      changed_files: ['docs/features/spec.md'],
      phases: [
        {
          phase: 'implementation',
          status: 'fail',
          summary: 'Implementation blocked by missing dependency',
          artifacts: [],
        },
      ],
    });

    expect(summary.blocked).toBe(true);
    expect(summary.primary_blocking_reason).toBe('Implementation blocked by missing dependency');
  });

  it('treats structured test results as test evidence even without changed test files', () => {
    const summary = buildChangeClosureSummary({
      changed_files: ['src/verification/gates/code-tests-lint.ts'],
      phases: [],
      verification_context: {
        project_root: '/tmp/project',
        modules: ['verification'],
        changed_files: ['src/verification/gates/code-tests-lint.ts'],
        changed_files_source: 'git-status',
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
              related_paths: ['src/verification/gates/code-tests-lint.ts'],
            },
          },
        ],
        expected_ui_modules: [],
        expected_api_modules: [],
        expected_integration_modules: [],
        expected_error_catalog_modules: [],
        registry_refreshed_at: new Date().toISOString(),
        glossary_updated: true,
      },
    });

    expect(summary).toMatchObject({
      code_changed: true,
      test_evidence_changed: true,
      canonical_docs_changed: false,
      blocked: false,
      primary_blocking_reason: null,
    });
    expect(summary.summary).toContain('test evidence changed=yes');
  });

  it('counts maintainer and instruction docs as canonical docs in the closure summary', () => {
    const summary = buildChangeClosureSummary({
      changed_files: [
        'docs/maintainers/architecture-map.md',
        'docs/instructions/workflows/quick-fix.yaml',
      ],
      phases: [],
    });

    expect(summary).toMatchObject({
      canonical_docs_changed: true,
      blocked: false,
    });
  });
});
