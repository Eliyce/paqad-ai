import { describe, expect, it } from 'vitest';

import { AGENT_ROLES } from '@/core/types/agent.js';
import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';
import { EXPERT_ROLES, expertBudget, isExpertRole } from '@/spec-pipeline/experts/roster.js';

// Issue #547 — the roster grows by three roles. qa-engineer and user-flow-writer are pickable
// experts; chief-architect never is (it runs automatically once any expert fired). ROLE_TOKEN_BUDGETS
// is the only exhaustive Record<AgentRole, number>, so it compiles only when every role has a budget.
describe('agent roles (issue #547)', () => {
  it('AGENT_ROLES carries the three new roles', () => {
    expect(AGENT_ROLES).toContain('qa-engineer');
    expect(AGENT_ROLES).toContain('user-flow-writer');
    expect(AGENT_ROLES).toContain('chief-architect');
  });

  it('every role has a token budget (exhaustive Record compiles)', () => {
    for (const role of AGENT_ROLES) {
      expect(ROLE_TOKEN_BUDGETS[role]).toBeGreaterThan(0);
    }
    expect(ROLE_TOKEN_BUDGETS['qa-engineer']).toBe(6000);
    expect(ROLE_TOKEN_BUDGETS['user-flow-writer']).toBe(5000);
    expect(ROLE_TOKEN_BUDGETS['chief-architect']).toBe(10000);
  });

  it('qa-engineer and user-flow-writer are pickable experts', () => {
    expect(EXPERT_ROLES).toContain('qa-engineer');
    expect(EXPERT_ROLES).toContain('user-flow-writer');
    expect(isExpertRole('qa-engineer')).toBe(true);
    expect(isExpertRole('user-flow-writer')).toBe(true);
    expect(expertBudget('qa-engineer')).toBe(6000);
    expect(expertBudget('user-flow-writer')).toBe(5000);
  });

  it('chief-architect is never a pickable expert', () => {
    expect(EXPERT_ROLES).not.toContain('chief-architect');
    expect(isExpertRole('chief-architect')).toBe(false);
    expect(() => expertBudget('chief-architect')).toThrow(/not an expert role/);
  });
});
