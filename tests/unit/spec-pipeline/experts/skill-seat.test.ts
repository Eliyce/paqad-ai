import { describe, expect, it } from 'vitest';

import {
  expertTier,
  isExpertRole,
  DEFAULT_STANDING_EXPERTS,
} from '@/spec-pipeline/experts/roster.js';
import {
  pathTriggeredSeats,
  seatExpertsForLane,
  SKILL_PATH_EXPERT,
} from '@/spec-pipeline/experts/need.js';
import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';

const SKILL = '.claude/skills/processing-invoices/SKILL.md';

describe('the skill-orchestrator role', () => {
  it('is an on-call expert with an 8000-token budget', () => {
    expect(SKILL_PATH_EXPERT).toBe('skill-orchestrator');
    expect(isExpertRole('skill-orchestrator')).toBe(true);
    expect(expertTier('skill-orchestrator', DEFAULT_STANDING_EXPERTS)).toBe('on-call');
    expect(ROLE_TOKEN_BUDGETS['skill-orchestrator']).toBe(8000);
  });
});

describe('path-triggered seats', () => {
  it('carries the sensitive-path seat and the skill-path seat in one list', () => {
    expect(
      pathTriggeredSeats({ standingSits: false, sensitivePath: 'src/auth/k.ts', skillPath: SKILL }),
    ).toEqual([
      {
        role: 'security-auditor',
        path: 'src/auth/k.ts',
        reason: 'a planned path is sensitive: src/auth/k.ts',
      },
      { role: 'skill-orchestrator', path: SKILL, reason: `a planned file is a skill: ${SKILL}` },
    ]);
  });

  it('names an edited skill path as edited', () => {
    expect(
      pathTriggeredSeats({
        standingSits: true,
        sensitivePath: null,
        skillPath: SKILL,
        skillPathEdited: true,
      })[1],
    ).toEqual({
      role: 'skill-orchestrator',
      path: SKILL,
      reason: `an edited file is a skill: ${SKILL}`,
    });
  });

  it('AC-31: seats skill-orchestrator on every lane, even when the standing experts sit', () => {
    for (const standingSits of [true, false]) {
      const seated = seatExpertsForLane({
        detectorNeeds: [],
        standing: ['product-owner'],
        standingSits,
        pathSeats: pathTriggeredSeats({
          standingSits,
          sensitivePath: 'src/auth/k.ts',
          skillPath: SKILL,
        }),
      });
      expect(seated.map((need) => need.role)).toEqual(
        standingSits
          ? ['product-owner', 'skill-orchestrator']
          : ['security-auditor', 'skill-orchestrator'],
      );
    }
  });

  it('does not seat a role twice when the detector already named it', () => {
    const seated = seatExpertsForLane({
      detectorNeeds: [{ role: 'skill-orchestrator', reason: 'a skill is added' }],
      standing: [],
      standingSits: false,
      pathSeats: pathTriggeredSeats({ standingSits: false, sensitivePath: null, skillPath: SKILL }),
    });
    expect(seated).toEqual([
      { role: 'skill-orchestrator', reason: 'a skill is added', origin: 'detector' },
    ]);
  });

  it('seats nothing extra without a triggering path', () => {
    expect(
      seatExpertsForLane({
        detectorNeeds: [],
        standing: [],
        standingSits: false,
        pathSeats: pathTriggeredSeats({
          standingSits: false,
          sensitivePath: null,
          skillPath: null,
        }),
      }),
    ).toEqual([]);
  });
});
