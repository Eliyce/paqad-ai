import { describe, expect, it } from 'vitest';

import {
  allowedSkillFields,
  CLAUDE_CODE_SKILL_FIELDS,
  descriptionLength,
  descriptionWithinLimit,
  FIELDS_MAX_AGE_DAYS,
  OPEN_SPEC_SKILL_FIELDS,
} from '@/authoring/lint/fields.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('the skill frontmatter field lists', () => {
  it('lists the six open-spec fields and the twenty Claude Code fields', () => {
    expect(OPEN_SPEC_SKILL_FIELDS).toHaveLength(6);
    expect(CLAUDE_CODE_SKILL_FIELDS.fields).toHaveLength(20);
    expect(new Set(CLAUDE_CODE_SKILL_FIELDS.fields).size).toBe(20);
    for (const field of OPEN_SPEC_SKILL_FIELDS) {
      expect(CLAUDE_CODE_SKILL_FIELDS.fields).toContain(field);
    }
  });

  it('allows the Claude Code fields only when the host is Claude Code', () => {
    expect(allowedSkillFields(true).has('when_to_use')).toBe(true);
    expect(allowedSkillFields(false).has('when_to_use')).toBe(false);
    expect(allowedSkillFields(false).has('allowed-tools')).toBe(true);
    expect(allowedSkillFields(false).has('model_tier')).toBe(false);
    expect(allowedSkillFields(false, true).has('model_tier')).toBe(true);
  });

  it('was checked against the Claude Code skills reference in the last 60 days', () => {
    const checked = Date.parse(`${CLAUDE_CODE_SKILL_FIELDS.checked}T00:00:00Z`);
    const ageDays = Math.floor((Date.now() - checked) / DAY_MS);
    expect(
      ageDays,
      `CLAUDE_CODE_SKILL_FIELDS was checked ${ageDays} days ago. Recheck the field list at ` +
        `${CLAUDE_CODE_SKILL_FIELDS.source}, then set CLAUDE_CODE_SKILL_FIELDS.checked in ` +
        'src/authoring/lint/fields.ts to the date you checked it.',
    ).toBeLessThanOrEqual(FIELDS_MAX_AGE_DAYS);
  });
});

describe('the description limit', () => {
  it('AC-52: counts code points, so 1024 passes and 1025 fails', () => {
    expect(descriptionWithinLimit('a'.repeat(1023))).toBe(true);
    expect(descriptionWithinLimit('a'.repeat(1024))).toBe(true);
    expect(descriptionWithinLimit('a'.repeat(1025))).toBe(false);
    expect(descriptionLength('\u{1F600}'.repeat(1024))).toBe(1024);
    expect(descriptionWithinLimit('\u{1F600}'.repeat(1024))).toBe(true);
  });
});
