import type { StructuredTestResult } from '@/core/types/test-output.js';
import { isBackstopVerificationOrigin } from '@/core/types/verification.js';
import { assessTestEvidence } from '@/verification/test-evidence.js';

import type { Gate } from './gate.interface.js';

import { collectScopeDriftPaths } from '@/verification/repository/scope-drift.js';

import {
  areRegistriesStale,
  collectCanonicalDocumentationFailures,
  collectUnresolvedDocTargets,
  formatCanonicalDocTarget,
} from './documentation-checks.js';
import { createFail, createPass } from './shared.js';

export class ChangeCompletenessGate implements Gate {
  readonly gate = 'change-completeness' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    const blockerReasons = await collectBlockerReasons(context);
    if (!context.code_changed && blockerReasons.length === 0) {
      return createPass(
        this.gate,
        'Change completeness: complete. No code diff detected, so no implementation delta remains open.',
      );
    }

    const incompleteReasons = await collectIncompleteReasons(context);

    if (blockerReasons.length === 0 && incompleteReasons.length === 0) {
      return createPass(
        this.gate,
        'Change completeness: complete. Code changed, test evidence exists, canonical docs are current, and no blockers remain.',
      );
    }

    return createFail(
      this.gate,
      buildFailureDetail(blockerReasons, incompleteReasons),
      blockerReasons.length > 0
        ? 'Resolve the blocking verification issues and finish the remaining change work before closing the task.'
        : 'Finish the remaining implementation, test, and documentation work before closing the task.',
    );
  }
}

async function collectIncompleteReasons(context: Parameters<Gate['check']>[0]): Promise<string[]> {
  const reasons: string[] = [];
  const testEvidence = assessTestEvidence({
    changed_files: context.changed_files,
    modules: context.modules,
    test_files_changed: context.test_files_changed,
    structured_test_results: context.structured_test_results,
  });

  // Test-evidence STRENGTH is a provider-workflow concern: it needs structured test
  // results, which only the in-session agent records. The agent-independent backstop
  // (hook-completion / git-backstop / ci-backstop) never collects them, so it cannot
  // prove strength either way — exactly like code-tests-lint, which the backstop
  // omits rather than hard-blocking on. At a backstop origin with no structured
  // results, this is surfaced as an ESCALATION by repository-context (not a silent
  // pass) instead of a false "incomplete" block. In-session (provider-workflow) and
  // any run that DID collect structured results still block on weak evidence.
  const backstopCannotProve =
    isBackstopVerificationOrigin(context.verification_origin) &&
    (context.structured_test_results?.length ?? 0) === 0;
  if (context.code_changed && testEvidence.strength !== 'strong' && !backstopCannotProve) {
    reasons.push(testEvidence.detail);
  }

  const unresolvedDocTargets = await collectUnresolvedDocTargets(
    context.project_root,
    context.changed_files,
    context.stale_doc_targets,
  );
  if (context.code_changed && unresolvedDocTargets.length > 0) {
    reasons.push(
      `Canonical docs not updated for changed code: ${unresolvedDocTargets.map(formatCanonicalDocTarget).join('; ')}`,
    );
  }

  return reasons;
}

async function collectBlockerReasons(context: Parameters<Gate['check']>[0]): Promise<string[]> {
  const reasons: string[] = [];

  if (!context.requirements_complete) {
    reasons.push('Requirements are incomplete');
  }
  if (!context.story_quality_passed) {
    reasons.push('Story quality checks failed');
  }
  if (!context.ac_test_mapping_passed) {
    reasons.push('Acceptance criteria are not mapped to tests');
  }
  if (!context.spec_review_passed) {
    reasons.push('Spec review failed');
  }
  if (!context.architecture_compliant) {
    reasons.push('Architecture compliance failed');
  }

  // Issue #117 (C-4) — scope drift. On the hook/backstop path the context
  // carries the frozen spec boundary; any changed file outside it is an
  // out-of-scope change the developer never asked for. Surface the specific
  // paths so a human can accept or reject them.
  if (context.spec_boundary && context.spec_boundary.length > 0) {
    const driftPaths = collectScopeDriftPaths(context.changed_files, context.spec_boundary);
    if (driftPaths.length > 0) {
      reasons.push(`Out-of-scope changes outside the spec boundary: ${driftPaths.join(', ')}`);
    }
  }

  const structuredTestIssue = getStructuredTestIssue(context.structured_test_results);
  if (structuredTestIssue) {
    reasons.push(structuredTestIssue);
  } else if (!context.code_tests_lint_passed) {
    reasons.push('Code, tests, or lint checks failed');
  }

  if (!context.implementation_review_passed) {
    reasons.push('Implementation review failed');
  }
  if (!structuredTestIssue && !context.behavioral_correctness_passed) {
    reasons.push('Behavioral correctness checks failed');
  }
  if (!context.database_quality_passed) {
    reasons.push('Database quality checks failed');
  }

  const documentationFailures = await collectCanonicalDocumentationFailures(
    context.project_root,
    context.expected_ui_modules,
    context.expected_api_modules,
    context.expected_integration_modules,
    context.expected_error_catalog_modules,
  );
  if (documentationFailures.length > 0) {
    reasons.push(
      `Canonical documentation is missing or invalid: ${documentationFailures.join(', ')}`,
    );
  }
  if (areRegistriesStale(context.registry_refreshed_at)) {
    reasons.push('Registries are stale');
  }
  if (!context.glossary_updated) {
    reasons.push('Glossary is out of date');
  }

  return reasons;
}

function getStructuredTestIssue(
  structuredTestResults: StructuredTestResult[] | undefined,
): string | null {
  const degradedResult = structuredTestResults?.find(
    (result) => result.parse_metadata.parse_strategy === 'degraded',
  );
  if (degradedResult) {
    return `Test results for "${degradedResult.summary.runner_id}" could not be fully parsed`;
  }

  const failingResult = structuredTestResults?.find(
    (result) => result.summary.failed > 0 || result.summary.errored > 0,
  );
  if (failingResult) {
    return `Structured test results report failures for ${failingResult.summary.runner_id}`;
  }

  return null;
}
function buildFailureDetail(blockerReasons: string[], incompleteReasons: string[]): string {
  if (blockerReasons.length > 0 && incompleteReasons.length > 0) {
    return `Change completeness: blocked. Blockers: ${blockerReasons.join('; ')}. Remaining work: ${incompleteReasons.join('; ')}.`;
  }

  if (blockerReasons.length > 0) {
    return `Change completeness: blocked. Blockers: ${blockerReasons.join('; ')}.`;
  }

  return `Change completeness: incomplete. Remaining work: ${incompleteReasons.join('; ')}.`;
}
