import { describe, expect, it } from 'vitest';

import { MANDATORY_STAGE_AGENTS } from '@/stage-isolation/stage-agents.js';
import { STAGE_AGENT_STAGES } from '@/stage-isolation/stage-agents.js';
import { resolveRecipe } from '@/stage-isolation/recipes.js';
import { buildStageBrief } from '@/stage-isolation/stage-brief.js';

const BUDGETS: Readonly<Record<string, number>> = {
  planning: 100,
  specification: 60,
  development: 170,
  review: 70,
  checks: 20,
  documentation_sync: 30,
};

const REPO = process.cwd();

function requiredCommands(text: string): string[] {
  return [...text.matchAll(/paqad-ai [a-z-]+(?: [a-z-]+)?/gu)].map((match) => match[0]);
}

describe('stage turn budgets', () => {
  it('holds the measured baseline plus half, rounded up to ten', () => {
    expect(
      Object.fromEntries(MANDATORY_STAGE_AGENTS.map((def) => [def.ledgerStage, def.maxTurns])),
    ).toEqual(BUDGETS);
  });

  it('asks the review stage for at most 25 commands', () => {
    const brief = buildStageBrief('review', REPO, 'ses_budget', { full: true });
    const recipe = resolveRecipe('review').body;
    expect(requiredCommands(`${brief}\n${recipe}`).length).toBeLessThanOrEqual(25);
  });

  it('names one way in on every stage', () => {
    for (const stage of STAGE_AGENT_STAGES) {
      const brief = buildStageBrief(stage, REPO, 'ses_budget');
      expect(brief).toContain(`stage begin ${stage}`);
      expect(brief).not.toContain(`paqad-ai stage start ${stage}`);
    }
  });
});
