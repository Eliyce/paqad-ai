// The one test-runner selector (issue #554, Part A.3). Both onboarding and the check runner pick
// the runner the same way, so there is a single implementation: prefer the runner whose id equals a
// detected trait (so a `phpunit` project selects the phpunit runner, not the pack's first), else the
// runner named in the command, else the first. Runners with no structured format are skipped — an
// unparseable runner is treated as "no runner" by the caller.

import { getPackTestRunners } from '@/packs/project-packs.js';
import type { StackPackTestRunner } from '@/core/types/pack.js';
import type { DetectedStackProfile } from '@/core/types/introspection.js';

/**
 * Select the test runner for a stack: trait-named first, then command-named, then the first
 * structured runner. Returns null when no structured runner resolves (no pack, or all `none`).
 */
export function selectTestRunner(
  stackProfile: Pick<DetectedStackProfile, 'frameworks' | 'traits'>,
  command: string,
  projectRoot?: string,
): StackPackTestRunner | null {
  const runners = getPackTestRunners(stackProfile.frameworks, projectRoot).filter(
    (runner) => runner.structured_format !== 'none',
  );
  if (runners.length === 0) return null;

  const traits = stackProfile.traits ?? [];
  const byTrait = runners.find((runner) =>
    traits.some((trait) => trait.toLowerCase() === runner.runner_id.toLowerCase()),
  );
  if (byTrait) return byTrait;

  const normalized = command.toLowerCase();
  const byCommand = runners.find((runner) => normalized.includes(runner.runner_id.toLowerCase()));
  return byCommand ?? runners[0] ?? null;
}
