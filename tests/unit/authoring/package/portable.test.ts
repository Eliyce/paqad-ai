import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildPortableSkill, portableFrontmatter } from '@/authoring/package/portable.js';
import { SkillWorkspace } from '@/authoring/workspace.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(): { workspace: SkillWorkspace; folder: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-portable-'));
  roots.push(root);
  const folder = join(root, 'src-skill');
  mkdirSync(join(folder, 'references'), { recursive: true });
  writeFileSync(
    join(folder, 'SKILL.md'),
    '---\nname: drafting-notes\ndescription: Drafts notes. Use when asked.\nwhen_to_use: release time\nallowed-tools: Read\nhooks:\n  PostToolUse: []\n---\n# Body\n',
  );
  writeFileSync(join(folder, 'references/guide.md'), 'guide\n');
  return { workspace: new SkillWorkspace(root, 'drafting-notes'), folder };
}

describe('the portable copy', () => {
  it('moves Claude Code-only fields under metadata and keeps the open-spec ones', () => {
    expect(
      portableFrontmatter({
        name: 'a',
        description: 'd',
        'allowed-tools': 'Read',
        model: 'opus',
        hooks: { a: 1 },
      }),
    ).toEqual({
      name: 'a',
      description: 'd',
      'allowed-tools': 'Read',
      metadata: { model: 'opus', hooks: '{"a":1}' },
    });
  });

  it('AC-11, EC-11: writes the copy and quick-validate exits 0, leaving the source untouched', () => {
    const { workspace, folder } = setup();
    const result = buildPortableSkill(workspace, folder, {
      unverified: false,
      allowedRiskyScripts: [],
    });
    expect(result.validation.exitCode).toBe(0);
    const text = readFileSync(workspace.path('portable/drafting-notes/SKILL.md'), 'utf8');
    expect(text).toContain('metadata:');
    expect(text).not.toMatch(/^when_to_use:/m);
    expect(readFileSync(join(folder, 'SKILL.md'), 'utf8')).toMatch(/^when_to_use:/m);
  });

  it('AC-57: refuses a skill labelled unverified or holding an allowed risky script', () => {
    const { workspace, folder } = setup();
    expect(() =>
      buildPortableSkill(workspace, folder, { unverified: true, allowedRiskyScripts: [] }),
    ).toThrow('labelled unverified');
    expect(() =>
      buildPortableSkill(workspace, folder, {
        unverified: false,
        allowedRiskyScripts: ['scripts/fetch.ts'],
      }),
    ).toThrow('allowed risky script (scripts/fetch.ts)');
  });
});
