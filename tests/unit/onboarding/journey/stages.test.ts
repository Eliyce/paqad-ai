import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_STAGES,
  STAGE_COUNT,
  isStageId,
  nextStage,
  stagesBefore,
  statusLine,
} from '../../../../src/onboarding/journey/stages.js';
import { DEGRADED_CODES, STAGE_IDS } from '../../../../src/onboarding/journey/types.js';

const YML = join(process.cwd(), 'docs/instructions/workflows/onboarding-stages.yml');

function stripForCompare(stage: (typeof ONBOARDING_STAGES)[number]): Record<string, unknown> {
  return {
    id: stage.id,
    index: stage.index,
    name: stage.name,
    label: stage.label,
    running: stage.running,
    workflow: stage.workflow,
    runs_in: stage.runs_in,
    agent: stage.agent,
    unit: stage.unit,
    allowed_degraded: [...stage.allowed_degraded],
  };
}

function readYmlStages(): Array<Record<string, unknown>> {
  const doc = parse(readFileSync(YML, 'utf8')) as { stages: Array<Record<string, unknown>> };
  return doc.stages;
}

describe('onboarding stage registry', () => {
  it('AC-18: onboarding-stages.yml mirrors ONBOARDING_STAGES exactly (drift test)', () => {
    expect(readYmlStages()).toEqual(ONBOARDING_STAGES.map(stripForCompare));
  });

  it('AC-18: the drift comparison fails when one field differs', () => {
    const tampered = readYmlStages().map((stage, i) =>
      i === 5 ? { ...stage, label: 'Analyze' } : stage,
    );
    expect(tampered).not.toEqual(ONBOARDING_STAGES.map(stripForCompare));
  });

  it('FR-3: runs eight stages in the fixed order', () => {
    expect(STAGE_COUNT).toBe(8);
    expect(ONBOARDING_STAGES.map((stage) => stage.id)).toEqual([...STAGE_IDS]);
    expect(ONBOARDING_STAGES.map((stage) => stage.label)).toEqual([
      'Read',
      'Set up',
      'Docs',
      'Modules',
      'Research',
      'Triage',
      'Checks',
      'Wrap up',
    ]);
    expect(ONBOARDING_STAGES.map((stage) => stage.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('FR-4: Triage is the one label not derived from the step name', () => {
    const notDerived = ONBOARDING_STAGES.filter((stage) => {
      const name = stage.name.toLowerCase();
      const label = stage.label.toLowerCase();
      return !(name.includes(label) || name.includes(label.replace(/s$/u, '')));
    });
    expect(notDerived.map((stage) => stage.label)).toEqual(['Triage']);
    expect(notDerived[0]?.name).toBe('Check which rules can be automated');
  });

  it('FR-25: allowed gaps are exactly the five named ones', () => {
    const allowed = ONBOARDING_STAGES.flatMap((stage) => stage.allowed_degraded);
    expect([...allowed].sort()).toEqual([...DEGRADED_CODES].sort());
  });

  it('FR-9: orders stages and builds the status line from the table words', () => {
    expect(stagesBefore('module_docs').map((stage) => stage.id)).toEqual([
      'detect',
      'setup',
      'project_docs',
    ]);
    expect(nextStage('finish')).toBeNull();
    expect(isStageId('skip')).toBe(false);
    expect(statusLine('module_docs', '7 of 23 · billing')).toBe(
      '**▸ paqad** · Step 4 of 8 · Writing the module docs · 7 of 23 · billing',
    );
  });
});
