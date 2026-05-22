import type { WorkflowTemplate, TemplateStep, ParallelGroup } from './types.js';

export class WorkflowTemplateValidator {
  validate(
    template: WorkflowTemplate,
    availableSkills: Set<string>,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!template.name) errors.push('Template must have a name');
    if (!template.steps || template.steps.length === 0)
      errors.push('Template must have at least one step');

    for (let i = 0; i < (template.steps ?? []).length; i++) {
      const step = template.steps[i];
      if (this.isParallelGroup(step)) {
        for (const subStep of step.parallel) {
          if (!availableSkills.has(subStep.skill)) {
            errors.push(`Step ${i}: unknown skill "${subStep.skill}" in parallel group`);
          }
          if (subStep.on_failure && !['skip', 'abort', 'retry'].includes(subStep.on_failure)) {
            errors.push(`Step ${i}: invalid on_failure value "${subStep.on_failure}"`);
          }
        }
      } else {
        if (!availableSkills.has(step.skill)) {
          errors.push(`Step ${i}: unknown skill "${step.skill}"`);
        }
        if (step.on_failure && !['skip', 'abort', 'retry'].includes(step.on_failure)) {
          errors.push(`Step ${i}: invalid on_failure value "${step.on_failure}"`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  isParallelGroup(step: TemplateStep): step is ParallelGroup {
    return 'parallel' in step;
  }
}
