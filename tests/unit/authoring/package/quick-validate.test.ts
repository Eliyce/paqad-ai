import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { quickValidateSkill } from '@/authoring/package/quick-validate.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function skill(frontmatter: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-quick-validate-'));
  roots.push(root);
  if (frontmatter !== null)
    writeFileSync(join(root, 'SKILL.md'), `---\n${frontmatter}---\n# Body\n`);
  mkdirSync(join(root, 'references'));
  return root;
}

describe('quick-validate (port of quick_validate.py)', () => {
  it('AC-11: exits 0 on a valid portable skill', () => {
    expect(
      quickValidateSkill(
        skill(
          'name: drafting-notes\ndescription: Drafts notes. Use when asked.\nmetadata:\n  model: opus\n',
        ),
      ),
    ).toEqual({ valid: true, message: 'Skill is valid!', exitCode: 0 });
  });

  it.each([
    [null, 'SKILL.md not found'],
    [
      'name: x\nwhen_to_use: y\ndescription: d\n',
      'Unexpected key(s) in SKILL.md frontmatter: when_to_use',
    ],
    ['description: d\n', "Missing 'name' in frontmatter"],
    ['name: Bad_Name\ndescription: d\n', 'should be kebab-case'],
    ['name: a--b\ndescription: d\n', 'cannot start/end with hyphen'],
    ['name: ok\ndescription: "<b>"\n', 'angle brackets'],
    [`name: ok\ndescription: ${'a'.repeat(1025)}\n`, 'Description is too long (1025 characters)'],
    [`name: ok\ndescription: d\ncompatibility: ${'c'.repeat(501)}\n`, 'Compatibility is too long'],
  ])('INV-17: exits 1 with a named reason (%#)', (frontmatter, message) => {
    const result = quickValidateSkill(skill(frontmatter));
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain(message);
  });
});
