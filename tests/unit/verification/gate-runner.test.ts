import { describe, expect, it } from 'vitest';

import { VerificationGateRunner } from '@/verification/gate-runner.js';

import { createVerificationContext } from './shared.fixture.js';

describe('VerificationGateRunner', () => {
  const strongStructuredResult = {
    schema_version: '1.0.0' as const,
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
      parse_strategy: 'structured' as const,
      parse_warnings: [],
    },
    errors: [],
    evidence_scope: {
      related_paths: ['src/service.ts'],
    },
  };

  it('runs all 14 gates in order', async () => {
    const results = await new VerificationGateRunner().run(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
        structured_test_results: [strongStructuredResult],
      }),
    );
    expect(results.map((result) => result.gate)).toEqual([
      'change-completeness',
      'requirement-completeness',
      'story-quality',
      'ac-test-mapping',
      'spec-review',
      'architecture-compliance',
      'code-tests-lint',
      'implementation-review',
      'behavioral-correctness',
      'mutation-testing',
      'database-quality',
      'module-docs-structure',
      'instructions-docs-structure',
      'documentation-freshness',
    ]);
  });

  it('stops on first failure', async () => {
    const results = await new VerificationGateRunner().run(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
        structured_test_results: [strongStructuredResult],
        story_quality_passed: false,
      }),
    );
    expect(results.map((result) => result.gate)).toEqual(['change-completeness']);
    expect(results.at(-1)?.passed).toBe(false);
  });

  it('still runs instruction docs structure after an earlier failure when instruction docs changed', async () => {
    const results = await new VerificationGateRunner().run(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts', 'docs/instructions/random/foo.md'],
        structured_test_results: [strongStructuredResult],
        story_quality_passed: false,
        documentation_files_changed: true,
      }),
    );

    expect(results.map((result) => result.gate)).toEqual([
      'change-completeness',
      'instructions-docs-structure',
    ]);
    expect(results.at(-1)).toEqual({
      gate: 'instructions-docs-structure',
      passed: false,
      detail: 'Invalid instruction documentation path docs/instructions/random/foo.md',
      remediation:
        'Move instruction documentation under an approved docs/instructions/{rules,stack,architecture,design-system,registries,workflows,tools,benchmarks,tech-debt}/ path.',
    });
  });

  it('returns detailed results per gate', async () => {
    const results = await new VerificationGateRunner().run(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
        structured_test_results: [strongStructuredResult],
      }),
    );
    expect(results[0]).toEqual(
      expect.objectContaining({
        gate: 'change-completeness',
        passed: true,
        detail: expect.any(String),
      }),
    );
  });

  it('blocks default provider verification when touched feature docs are incomplete', async () => {
    const results = await new VerificationGateRunner().run(
      createVerificationContext({
        changed_files: ['docs/modules/billing/features/invoices/business.md'],
        documentation_files_changed: true,
      }),
    );

    expect(results.at(-1)).toEqual({
      gate: 'module-docs-structure',
      passed: false,
      detail: 'Missing docs/modules/billing/features/invoices/business.md',
      remediation:
        'Create the missing feature-level business documentation file before completing the provider request.',
    });
  });

  it('builds verification delta payloads against a baseline run', async () => {
    const runner = new VerificationGateRunner();
    const baseline = await runner.run(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
        structured_test_results: [strongStructuredResult],
        story_quality_passed: false,
      }),
    );
    const withDelta = await runner.runWithDelta(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
        structured_test_results: [strongStructuredResult],
      }),
      baseline,
    );

    expect(withDelta.results.at(-1)?.gate).toBe('documentation-freshness');
    expect(withDelta.delta_payload.payload.metadata.delta_mode_used).toBe(true);
    expect(withDelta.delta_payload.delta.changed_gate_outcomes.length).toBeGreaterThan(0);
  });

  it('does not treat not-yet-executed gates as changed when current run stops early', async () => {
    const runner = new VerificationGateRunner();
    const baseline = await runner.run(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
        structured_test_results: [strongStructuredResult],
      }),
    );
    const withDelta = await runner.runWithDelta(
      createVerificationContext({
        code_changed: true,
        test_files_changed: false,
        changed_files: ['src/service.ts'],
        structured_test_results: [strongStructuredResult],
        story_quality_passed: false,
      }),
      baseline,
    );

    expect(withDelta.results.map((result) => result.gate)).toEqual(['change-completeness']);
    expect(withDelta.delta_payload.delta.changed_gate_outcomes).toEqual([
      {
        gate: 'change-completeness',
        before_passed: true,
        after_passed: false,
      },
    ]);
    expect(withDelta.delta_payload.delta.changed_evidence.map((entry) => entry.gate)).toEqual([
      'change-completeness',
    ]);
    expect(
      withDelta.delta_payload.delta.changed_recommended_actions.some(
        (entry) => entry.gate === 'architecture-compliance',
      ),
    ).toBe(false);
  });
});
