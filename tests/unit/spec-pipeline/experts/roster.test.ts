import { describe, expect, it } from 'vitest';

import { AGENT_ROLES } from '@/core/types/agent.js';
import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';
import {
  DEFAULT_STANDING_EXPERTS,
  EXPERT_ROLES,
  expertBudget,
  expertTier,
  isExpertRole,
} from '@/spec-pipeline/experts/roster.js';

describe('EXPERT_ROLES', () => {
  it('is the expert subset of AGENT_ROLES (FR-1 / INV-3)', () => {
    for (const role of EXPERT_ROLES) {
      expect(AGENT_ROLES).toContain(role);
    }
    expect(EXPERT_ROLES).toContain('db-expert');
    expect(EXPERT_ROLES).toContain('security-auditor');
    expect(EXPERT_ROLES).toContain('ux-ui-analyst');
  });

  it('excludes the pipeline machinery roles, not on-demand experts', () => {
    expect(EXPERT_ROLES).not.toContain('implementer');
    expect(EXPERT_ROLES).not.toContain('reviewer');
    expect(EXPERT_ROLES).not.toContain('context-curator');
  });

  it('stays in lockstep order with AGENT_ROLES', () => {
    const expected = AGENT_ROLES.filter((role) => EXPERT_ROLES.includes(role));
    expect([...EXPERT_ROLES]).toEqual(expected);
  });
});

describe('isExpertRole', () => {
  it('accepts a roster role', () => {
    expect(isExpertRole('db-expert')).toBe(true);
  });

  it('rejects a non-expert AGENT_ROLE (AC-8)', () => {
    expect(isExpertRole('implementer')).toBe(false);
  });

  it('rejects an invented role outside AGENT_ROLES (AC-8)', () => {
    expect(isExpertRole('blockchain-wizard')).toBe(false);
  });
});

describe('expertBudget', () => {
  it('reads the canonical ROLE_TOKEN_BUDGETS (no parallel table)', () => {
    expect(expertBudget('db-expert')).toBe(ROLE_TOKEN_BUDGETS['db-expert']);
  });

  it('throws on a non-expert role rather than guessing a default', () => {
    // @ts-expect-error — deliberately passing a non-expert role to prove it throws.
    expect(() => expertBudget('implementer')).toThrow(/not an expert role/);
  });
});

describe('standing tier (issue #558)', () => {
  it('the four defaults are all expert roles (FR-1.3)', () => {
    expect(DEFAULT_STANDING_EXPERTS).toEqual([
      'product-owner',
      'application-architect',
      'user-flow-writer',
      'qa-engineer',
    ]);
    for (const role of DEFAULT_STANDING_EXPERTS) {
      expect(isExpertRole(role)).toBe(true);
    }
  });

  it('product-owner and application-architect are pickable experts (FR-1.2), thirteen in all', () => {
    expect(isExpertRole('product-owner')).toBe(true);
    expect(isExpertRole('application-architect')).toBe(true);
    expect(EXPERT_ROLES).toHaveLength(13);
  });

  it('expertTier reads a role against the run standing list', () => {
    expect(expertTier('qa-engineer', DEFAULT_STANDING_EXPERTS)).toBe('standing');
    expect(expertTier('db-expert', DEFAULT_STANDING_EXPERTS)).toBe('on-call');
    expect(expertTier('qa-engineer', [])).toBe('on-call');
  });
});
