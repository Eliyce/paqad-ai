import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RECIPES = [
  'planning-recipe',
  'specification-recipe',
  'development-recipe',
  'review-recipe',
  'documentation-sync-recipe',
  'checks-recipe',
];

const skillDir = (name: string) => join(process.cwd(), 'runtime/base/skills', name);

describe('the six stage recipes', () => {
  it.each(RECIPES)('%s stays small, restates first, and has no triggers', (name) => {
    const body = readFileSync(join(skillDir(name), 'SKILL.md'), 'utf8');
    expect(body.length).toBeLessThanOrEqual(5_000);
    expect(body).toContain(
      '1. Restate the request and its acceptance criteria in two lines at the top of your return.',
    );
    expect(body).not.toContain('—');
    const meta = readFileSync(join(skillDir(name), 'skill.meta.yaml'), 'utf8');
    expect(meta).toContain('triggers: []');
    expect(readFileSync(join(skillDir(name), 'agents/openai.yaml'), 'utf8')).toContain(
      'allow_implicit_invocation: false',
    );
  });

  it('points only at sibling skills that exist', () => {
    for (const name of RECIPES) {
      const body = readFileSync(join(skillDir(name), 'SKILL.md'), 'utf8');
      for (const match of body.matchAll(/runtime\/base\/skills\/([a-z-]+)\/SKILL\.md/gu)) {
        expect(() => readFileSync(join(skillDir(match[1]!), 'SKILL.md'))).not.toThrow();
      }
    }
  });
});
