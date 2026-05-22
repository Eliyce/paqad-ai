import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { SkillModelTier } from '@/core/types/skill.js';

export function selectModelForTier(
  profile: Pick<ProjectProfile, 'model_routing'>,
  tier: SkillModelTier,
): string {
  if (tier === 'fast') {
    return profile.model_routing.fast_model;
  }

  if (tier === 'reasoning') {
    return profile.model_routing.reasoning_model;
  }

  return profile.model_routing.default_model;
}
