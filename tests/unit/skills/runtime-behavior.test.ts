import fg from 'fast-glob';

import type { ClassificationResult } from '@/core/types/classification.js';
import type { ResolvedArtifact } from '@/core/types/resolution.js';
import { SkillLoader } from '@/skills/loader.js';
import { SkillTriggerEvaluator } from '@/skills/trigger-evaluator.js';

describe('runtime skill behavior', () => {
  it('loads every runtime skill and has at least one matching trigger case', async () => {
    const files = await fg(
      [
        'runtime/base/skills/**/*',
        'runtime/capabilities/coding/skills/**/*',
        'runtime/capabilities/security/skills/**/*',
      ],
      {
        cwd: process.cwd(),
        absolute: true,
        onlyFiles: true,
      },
    );
    const artifacts: ResolvedArtifact[] = files.map((path) => ({
      path,
      level: 1,
      source: path,
    }));
    const skills = await new SkillLoader().load(artifacts);
    const evaluator = new SkillTriggerEvaluator();

    expect(skills.length).toBeGreaterThanOrEqual(34);

    for (const skill of skills) {
      expect(skill.body.trim().length).toBeGreaterThan(0);
      if (skill.triggers.length > 0) {
        expect(evaluator.shouldLoad(skill, matchingClassification(skill.triggers[0]))).toBe(true);
        continue;
      }

      expect(skill.request_routing?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

function matchingClassification(trigger: Record<string, string[]>): ClassificationResult {
  const classification: ClassificationResult = {
    request_text: 'Build a billing workflow change',
    domain: 'coding',
    stack: 'laravel',
    target_capability: 'coding',
    capability_gap: false,
    workflow: 'feature-development',
    custom_workflow_name: null,
    workflow_source: 'routing-skill',
    workflow_reason: 'Matched workflow-router rule "build".',
    matched_rule: 'build',
    complexity: 'medium',
    risk: 'medium',
    scope: 'single-module',
    affected_modules: ['billing'],
    process_depth: 'graduated lane',
    certainty: 'well-defined',
    output_type: 'code',
    database_impact: 'none',
    ui_impact: 'none',
    api_impact: 'none',
    compliance_sensitivity: 'none',
    customer_facing_impact: 'internal',
    reversibility: 'easily-reversible',
    data_sensitivity: 'none',
  };

  for (const [key, values] of Object.entries(trigger)) {
    classification[key as keyof ClassificationResult] = values[0] as never;
  }

  return classification;
}
