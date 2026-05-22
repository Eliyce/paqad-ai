import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CONTENT_SKILLS = [
  'runtime/capabilities/content/skills/content-writer/SKILL.md',
  'runtime/capabilities/content/skills/content-planner/SKILL.md',
  'runtime/capabilities/content/skills/content-reviewer/SKILL.md',
  'runtime/capabilities/content/skills/script-writer/SKILL.md',
  'runtime/capabilities/content/skills/seo-optimizer/SKILL.md',
  'runtime/capabilities/content/skills/style-enforcer/SKILL.md',
] as const;

describe('content runtime', () => {
  it('ships non-placeholder content skills', () => {
    for (const file of CONTENT_SKILLS) {
      const content = readFileSync(file, 'utf8');
      expect(content).toMatch(/^# /m);
      expect(content.toLowerCase()).not.toContain('placeholder');
    }
  });
});
