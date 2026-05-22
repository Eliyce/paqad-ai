import { describe, expect, it } from 'vitest';

import type { LoadedSkill } from '@/core/types/skill.js';
import { SkillTriggerEvaluator } from '@/skills/trigger-evaluator.js';

import { fixtureClassification } from './shared.fixture.js';

function fixtureSkill(triggers: LoadedSkill['triggers']): Pick<LoadedSkill, 'triggers'> {
  return { triggers };
}

describe('SkillTriggerEvaluator', () => {
  it('database-design-review triggers on schema_change', () => {
    const evaluator = new SkillTriggerEvaluator();
    const skill = fixtureSkill([{ database_impact: ['schema-change', 'data-migration'] }]);

    expect(
      evaluator.shouldLoad(skill, fixtureClassification({ database_impact: 'schema-change' })),
    ).toBe(true);
  });

  it('database-design-review does not trigger on database impact none', () => {
    const evaluator = new SkillTriggerEvaluator();
    const skill = fixtureSkill([{ database_impact: ['schema-change', 'data-migration'] }]);

    expect(evaluator.shouldLoad(skill, fixtureClassification({ database_impact: 'none' }))).toBe(
      false,
    );
  });

  it('market-research triggers only on full lane', () => {
    const evaluator = new SkillTriggerEvaluator();
    const skill = fixtureSkill([{ process_depth: ['full lane'], output_type: ['report'] }]);

    expect(
      evaluator.shouldLoad(
        skill,
        fixtureClassification({ process_depth: 'full lane', output_type: 'report' }),
      ),
    ).toBe(true);
    expect(
      evaluator.shouldLoad(
        skill,
        fixtureClassification({ process_depth: 'graduated lane', output_type: 'report' }),
      ),
    ).toBe(false);
  });

  it('api-doc-maintainer triggers when api impact is additive-endpoint', () => {
    const evaluator = new SkillTriggerEvaluator();
    const skill = fixtureSkill([
      { api_impact: ['additive-endpoint', 'modified-endpoint', 'breaking-change'] },
    ]);

    expect(
      evaluator.shouldLoad(skill, fixtureClassification({ api_impact: 'additive-endpoint' })),
    ).toBe(true);
  });

  it('integration-doc-maintainer triggers on multi-module scope only', () => {
    const evaluator = new SkillTriggerEvaluator();
    const skill = fixtureSkill([{ scope: ['multi-module', 'system-wide'] }]);

    expect(evaluator.shouldLoad(skill, fixtureClassification({ scope: 'multi-module' }))).toBe(
      true,
    );
    expect(evaluator.shouldLoad(skill, fixtureClassification({ scope: 'single-file' }))).toBe(
      false,
    );
  });

  it('error-catalog-maintainer triggers on feature-development and bug-fix workflows', () => {
    const evaluator = new SkillTriggerEvaluator();
    const skill = fixtureSkill([{ workflow: ['feature-development', 'bug-fix'] }]);

    expect(
      evaluator.shouldLoad(skill, fixtureClassification({ workflow: 'feature-development' })),
    ).toBe(true);
    expect(evaluator.shouldLoad(skill, fixtureClassification({ workflow: 'bug-fix' }))).toBe(true);
    expect(
      evaluator.shouldLoad(skill, fixtureClassification({ workflow: 'documentation-update' })),
    ).toBe(false);
  });

  it('ux-design-research requires both full lane and qualifying ui impact', () => {
    const evaluator = new SkillTriggerEvaluator();
    const skill = fixtureSkill([
      {
        process_depth: ['full lane'],
        ui_impact: ['new-component', 'new-screen', 'redesign'],
      },
    ]);

    expect(
      evaluator.shouldLoad(
        skill,
        fixtureClassification({ process_depth: 'full lane', ui_impact: 'new-screen' }),
      ),
    ).toBe(true);
    expect(
      evaluator.shouldLoad(
        skill,
        fixtureClassification({ process_depth: 'full lane', ui_impact: 'none' }),
      ),
    ).toBe(false);
    expect(
      evaluator.shouldLoad(
        skill,
        fixtureClassification({ process_depth: 'graduated lane', ui_impact: 'new-screen' }),
      ),
    ).toBe(false);
  });

  it('matches trigger dimensions against array-valued classification fields', () => {
    const evaluator = new SkillTriggerEvaluator();
    const skill = fixtureSkill([{ affected_modules: ['billing', 'checkout'] }]);

    expect(
      evaluator.shouldLoad(skill, fixtureClassification({ affected_modules: ['core', 'billing'] })),
    ).toBe(true);
    expect(
      evaluator.shouldLoad(skill, fixtureClassification({ affected_modules: ['core', 'auth'] })),
    ).toBe(false);
  });

  it('loads a skill when any trigger entry matches', () => {
    const evaluator = new SkillTriggerEvaluator();
    const skill = fixtureSkill([{ workflow: ['migration'] }, { risk: ['high'] }]);

    expect(evaluator.shouldLoad(skill, fixtureClassification({ risk: 'high' }))).toBe(true);
  });
});
