import { describe, expect, it } from 'vitest';

import { validateExpertNeed } from '@/spec-pipeline/experts/need.js';

describe('validateExpertNeed', () => {
  it('accepts a well-formed artifact naming roster roles (FR-3)', () => {
    const result = validateExpertNeed({
      experts: [
        { role: 'db-expert', reason: 'the request adds an invoices migration' },
        { role: 'security-auditor', reason: 'it changes the auth boundary' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.artifact?.experts).toHaveLength(2);
    expect(result.artifact?.experts[0]?.role).toBe('db-expert');
  });

  it('accepts an empty experts[] — nothing needed is valid (issue #521 §4)', () => {
    const result = validateExpertNeed({ experts: [] });
    expect(result.ok).toBe(true);
    expect(result.artifact?.experts).toEqual([]);
  });

  it('parses a JSON string input', () => {
    const result = validateExpertNeed(
      '{"experts":[{"role":"ux-ui-analyst","reason":"new screen"}]}',
    );
    expect(result.ok).toBe(true);
    expect(result.artifact?.experts[0]?.role).toBe('ux-ui-analyst');
  });

  it('trims the reason', () => {
    const result = validateExpertNeed({
      experts: [{ role: 'db-expert', reason: '  migration  ' }],
    });
    expect(result.artifact?.experts[0]?.reason).toBe('migration');
  });

  it('rejects a role outside the roster (AC-8)', () => {
    const result = validateExpertNeed({
      experts: [{ role: 'blockchain-wizard', reason: 'made up' }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not an expert in the roster/);
  });

  it('rejects a non-expert AGENT_ROLE (AC-8)', () => {
    const result = validateExpertNeed({ experts: [{ role: 'implementer', reason: 'x' }] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not an expert in the roster/);
  });

  it('rejects an empty reason (FR-7)', () => {
    const result = validateExpertNeed({ experts: [{ role: 'db-expert', reason: '   ' }] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/non-empty reason/);
  });

  it('rejects a duplicate role', () => {
    const result = validateExpertNeed({
      experts: [
        { role: 'db-expert', reason: 'a' },
        { role: 'db-expert', reason: 'b' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/twice/);
  });

  it('rejects invalid JSON', () => {
    expect(validateExpertNeed('{not json').ok).toBe(false);
    expect(validateExpertNeed('{not json').error).toMatch(/not valid JSON/);
  });

  it('rejects a non-object', () => {
    expect(validateExpertNeed(42).ok).toBe(false);
    expect(validateExpertNeed([]).ok).toBe(false);
    expect(validateExpertNeed(null).ok).toBe(false);
  });

  it('rejects a missing experts[] array', () => {
    const result = validateExpertNeed({ nope: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/experts\[\] array/);
  });

  it('rejects a non-object entry', () => {
    expect(validateExpertNeed({ experts: ['db-expert'] }).ok).toBe(false);
  });

  it('rejects an entry missing a string role', () => {
    const result = validateExpertNeed({ experts: [{ reason: 'no role' }] });
    expect(result.ok).toBe(false);
  });

  it('rejects chief-architect with its own message — it is never picked (FR-2.4)', () => {
    const result = validateExpertNeed({
      experts: [{ role: 'chief-architect', reason: 'run the chief' }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      '"chief-architect" is never picked: it runs automatically when any expert fires',
    );
  });

  it('accepts the two new pickable experts (issue #547)', () => {
    const result = validateExpertNeed({
      experts: [
        { role: 'qa-engineer', reason: 'observable behaviour' },
        { role: 'user-flow-writer', reason: 'a multi-step user path' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.artifact?.experts.map((e) => e.role)).toEqual([
      'qa-engineer',
      'user-flow-writer',
    ]);
  });
});
