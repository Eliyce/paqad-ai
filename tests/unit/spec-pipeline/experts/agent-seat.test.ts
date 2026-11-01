import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';
import {
  AGENT_PATH_EXPERT,
  pathTriggeredSeats,
  seatExpertsForLane,
} from '@/spec-pipeline/experts/need.js';
import {
  DEFAULT_STANDING_EXPERTS,
  EXPERT_OWNS,
  EXPERT_ROLES,
  expertOwns,
  expertTier,
  isExpertRole,
} from '@/spec-pipeline/experts/roster.js';
import { roleInitials } from '../../../../runtime/claude-plugin/mod/instruments.js';

const AGENT = '.claude/agents/migration-reviewer.md';
const SKILL = '.claude/skills/processing-invoices/SKILL.md';

function rosterOwns(): Record<string, string> {
  const text = readFileSync(
    join(process.cwd(), 'runtime/base/skills/expert-need-detector/references/roster.md'),
    'utf8',
  );
  const owns: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const role = /^`([a-z-]+)`$/u.exec(cells[1] ?? '')?.[1];
    if (role !== undefined && cells.length >= 5) owns[role] = cells[3]!;
  }
  return owns;
}

describe('the agent-orchestrator seat (FR-1, AC-23)', () => {
  it('is an on-call expert with an 8000-token budget and the initials AO', () => {
    expect(AGENT_PATH_EXPERT).toBe('agent-orchestrator');
    expect(isExpertRole('agent-orchestrator')).toBe(true);
    expect(expertTier('agent-orchestrator', DEFAULT_STANDING_EXPERTS)).toBe('on-call');
    expect(ROLE_TOKEN_BUDGETS['agent-orchestrator']).toBe(8000);
    expect(roleInitials('agent-orchestrator')).toBe('AO');
  });

  it('AC-23: seats agent-orchestrator for a planned agent path, and both orchestrators beside each other', () => {
    const seated = seatExpertsForLane({
      detectorNeeds: [],
      standing: [],
      standingSits: false,
      pathSeats: pathTriggeredSeats({
        standingSits: false,
        sensitivePath: null,
        skillPath: SKILL,
        agentPath: AGENT,
      }),
    });
    expect(seated.map((need) => [need.role, need.reason])).toEqual([
      ['skill-orchestrator', `a planned file is a skill: ${SKILL}`],
      ['agent-orchestrator', `a planned file is an agent: ${AGENT}`],
    ]);
  });

  it('names an edited agent path as edited, and seats nothing without one', () => {
    const seats = pathTriggeredSeats({
      standingSits: true,
      sensitivePath: null,
      skillPath: null,
      agentPath: AGENT,
      agentPathEdited: true,
    });
    expect(seats[2]).toEqual({
      role: 'agent-orchestrator',
      path: AGENT,
      reason: `an edited file is an agent: ${AGENT}`,
    });
    const none = seatExpertsForLane({
      detectorNeeds: [],
      standing: [],
      standingSits: false,
      pathSeats: pathTriggeredSeats({ standingSits: false, sensitivePath: null, skillPath: null }),
    });
    expect(none).toEqual([]);
  });
});

describe('the Owns column (FR-36)', () => {
  it('gives every expert role exactly one Owns phrase', () => {
    expect(Object.keys(EXPERT_OWNS).sort()).toEqual([...EXPERT_ROLES].sort());
    for (const role of EXPERT_ROLES) expect(expertOwns(role).length).toBeGreaterThan(0);
    expect(() => expertOwns('chief-architect')).toThrow(/not an expert role/);
  });

  it('the roster reference carries the same Owns phrase for every role (drift)', () => {
    expect(rosterOwns()).toEqual(EXPERT_OWNS);
  });

  it('the roster row for agent-orchestrator matches the issue', () => {
    const text = readFileSync(
      join(process.cwd(), 'runtime/base/skills/expert-need-detector/references/roster.md'),
      'utf8',
    );
    expect(text).toContain(
      "A new or changed agent (subagent file) in any host's agents folder, or a stage or expert agent of paqad.",
    );
  });
});
