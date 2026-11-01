import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SkillFrontmatterParser } from '@/skills/frontmatter-parser.js';

const REPO = join(__dirname, '..', '..', '..');
const SKILL_ROOTS = [
  'runtime/base/skills',
  'runtime/claude-plugin/skills',
  'runtime/capabilities/coding/skills',
  'runtime/capabilities/content/skills',
  'runtime/capabilities/security/skills',
];

function skillFolders(): string[] {
  return SKILL_ROOTS.flatMap((root) =>
    readdirSync(join(REPO, root))
      .filter((name) => existsSync(join(REPO, root, name, 'SKILL.md')))
      .sort()
      .map((name) => `${root}/${name}`),
  );
}

// The parsed frontmatter of every paqad skill, taken before the custom keys moved under
// `metadata` and `skill.meta.yaml`. The description and body are left out on purpose: the
// text cleanup in the same change edits them, while the metadata move must change nothing.
function parsedFrontmatter(folder: string): unknown {
  const parser = new SkillFrontmatterParser();
  try {
    const parsed = parser.parse(
      readFileSync(join(REPO, folder, 'SKILL.md'), 'utf8'),
      join(REPO, folder),
    );
    const rest: Record<string, unknown> = { ...parsed.frontmatter };
    delete rest.description;
    return JSON.parse(JSON.stringify(rest)) as unknown;
  } catch (error) {
    return { error: (error as Error).message };
  }
}

describe('skill metadata parse parity (AC-3)', () => {
  it('parses every paqad skill to the same frontmatter object as before the move', () => {
    const parsed = Object.fromEntries(
      skillFolders().map((folder) => [folder, parsedFrontmatter(folder)]),
    );
    expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(110);
    expect(parsed).toMatchSnapshot();
  });
});
