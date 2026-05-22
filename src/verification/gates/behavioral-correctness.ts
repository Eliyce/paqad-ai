import type { Gate } from './gate.interface.js';
import { assessTestEvidence } from '@/verification/test-evidence.js';

import { checkBooleanGate, createFail, createInconclusive, createPass } from './shared.js';

export class BehavioralCorrectnessGate implements Gate {
  readonly gate = 'behavioral-correctness' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    const evidence = assessTestEvidence({
      changed_files: context.changed_files,
      modules: context.modules,
      test_files_changed: context.test_files_changed,
      structured_test_results: context.structured_test_results,
    });

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
        `Behavioral tests failed under ${structuredFailure.summary.runner_id}`,
        'Validate the implementation against the specified behavior.',
      );
    }

    if (context.code_changed && evidence.strength !== 'strong') {
      return createInconclusive(
        this.gate,
        evidence.detail,
        'Re-run behavior verification with structured test evidence mapped to the affected scope.',
      );
    }

    if (context.structured_test_results && context.structured_test_results.length > 0) {
      return createPass(this.gate, 'Structured behavioral test results report no failures');
    }

    return checkBooleanGate(
      this.gate,
      context.behavioral_correctness_passed,
      'Behavioral correctness checks passed',
      'Behavioral correctness checks failed',
      'Validate the implementation against the specified behavior.',
    );
  }
}
