import { getPackTestRunners } from '@/packs/project-packs.js';
import type { StackPackTestRunner } from '@/core/types/pack.js';
import type { DetectedStackProfile } from '@/core/types/introspection.js';

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
  return byCommand ?? runners[0]!;
}
