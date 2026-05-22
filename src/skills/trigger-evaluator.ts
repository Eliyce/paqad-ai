import type { ClassificationResult } from '@/core/types/classification.js';
import type { LoadedSkill, SkillTriggerCondition } from '@/core/types/skill.js';

export class SkillTriggerEvaluator {
  shouldLoad(skill: Pick<LoadedSkill, 'triggers'>, classification: ClassificationResult): boolean {
    return skill.triggers.some((trigger) => matchesTrigger(trigger, classification));
  }
}

function matchesTrigger(
  trigger: SkillTriggerCondition,
  classification: ClassificationResult,
): boolean {
  return Object.entries(trigger).every(([dimension, allowedValues]) => {
    const currentValue = classification[dimension as keyof ClassificationResult];

    if (Array.isArray(currentValue)) {
      return currentValue.some((value) => allowedValues.includes(String(value)));
    }

    return allowedValues.includes(String(currentValue));
  });
}
