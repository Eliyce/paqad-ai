import type { Gate } from './gate.interface.js';
import { assessTestEvidence } from '@/verification/test-evidence.js';

import { checkBooleanGate, createFail, createInconclusive, createPass } from './shared.js';

export class CodeTestsLintGate implements Gate {
  readonly gate = 'code-tests-lint' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    const evidence = assessTestEvidence({
      changed_files: context.changed_files,
      modules: context.modules,
      test_files_changed: context.test_files_changed,
      structured_test_results: context.structured_test_results,
    });

    if (context.code_changed && evidence.strength === 'none') {
      return createFail(
        this.gate,
        evidence.detail,
        'Add verification evidence that explicitly covers the changed code before closing the work.',
      );
    }

    if (context.code_changed && evidence.strength === 'weak') {
      return createFail(
        this.gate,
        evidence.detail,
        'Record structured verification evidence mapped to the affected files or modules.',
      );
    }

    const degradedResult = context.structured_test_results?.find(
      (result) => result.parse_metadata.parse_strategy === 'degraded',
    );
    if (degradedResult) {
      return createInconclusive(
        this.gate,
        `Test results for "${degradedResult.summary.runner_id}" could not be fully parsed`,
        'Check the test runner output and re-run.',
      );
    }

    const structuredFailure = context.structured_test_results?.find(
      (result) => result.summary.failed > 0 || result.summary.errored > 0,
    );
    if (structuredFailure) {
      return createFail(
        this.gate,
        `Structured test results report failures for ${structuredFailure.summary.runner_id}`,
        'Fix the failing build, test, or lint signal.',
      );
    }

    if (context.structured_test_results && context.structured_test_results.length > 0) {
      const totals = context.structured_test_results.reduce(
        (aggregate, result) => {
          aggregate.total += result.summary.total;
          aggregate.passed += result.summary.passed;
          return aggregate;
        },
        { total: 0, passed: 0 },
      );
      return createPass(
        this.gate,
        `Structured test results show ${totals.passed}/${totals.total} passing checks`,
      );
    }

    return checkBooleanGate(
      this.gate,
      context.code_tests_lint_passed,
      'Code, tests, and lint checks passed',
      'Code, tests, or lint checks failed',
      'Fix the failing build, test, or lint signal.',
    );
  }
}
