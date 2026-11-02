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

describe('AC-13: no shipped skill relies on the old top-level keys', () => {
  function shippedSkillFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) found.push(...shippedSkillFiles(rel));
      else if (entry.name === 'SKILL.md') found.push(rel);
    }
    return found;
  }

  it('parses every SKILL.md under runtime with no deprecation', () => {
    const parser = new SkillFrontmatterParser();
    const deprecated = shippedSkillFiles('runtime')
      .map((file) => {
        const folder = join(REPO, file, '..');
        try {
          const text = readFileSync(join(REPO, file), 'utf8');
          return { file, line: parser.parse(text, folder).deprecation };
        } catch {
          return { file, line: null };
        }
      })
      .filter((entry) => entry.line !== null);
    expect(deprecated).toEqual([]);
  });

  it('regression-test-gen parses to the same settings as before the move', () => {
    const folder = 'runtime/capabilities/coding/stacks/_shared/skills/regression-test-gen';
    expect(parsedFrontmatter(folder)).toEqual({
      name: 'regression-test-gen',
      file: '',
      model_tier: 'medium',
      triggers: [{ workflow: ['bug-fix', 'refactor', 'migration'] }],
      max_lines: 300,
      cacheable: true,
      cache_key_inputs: ['tests/**', 'src/**'],
      output_format: 'markdown',
      input_schema: {
        changed_files: {
          type: 'path[]',
          required: true,
          description: 'Implementation files requiring regression coverage.',
        },
        acceptance_criteria_path: {
          type: 'path',
          required: false,
          description: 'Acceptance criteria for traceability.',
        },
      },
    });
  });
});
