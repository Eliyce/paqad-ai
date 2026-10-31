import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  enabledAdapters,
  findSkillPaths,
  isPaqadRepository,
  isSkillPath,
  readSkillPathContext,
  skillNameOf,
  skillRoots,
} from '@/authoring/paths.js';
import { AdapterFactory } from '@/adapters/factory.js';
import { BaseAdapter } from '@/adapters/shared/base-adapter.js';
import { ADAPTER_TYPES, type AdapterType } from '@/core/types/adapter.js';

const ALL: readonly AdapterType[] = ADAPTER_TYPES;

const HOST_ROOTS: Record<AdapterType, string> = {
  'claude-code': '.claude/skills',
  'codex-cli': '.codex/skills',
  'gemini-cli': '.gemini/skills',
  cursor: '.cursor/skills',
  'github-copilot': '.github/skills',
  windsurf: '.windsurf/skills',
  junie: '.junie/skills',
  aiassistant: '.aiassistant/skills',
  antigravity: '.antigravity/skills',
  aider: '.aider/skills',
  continue: '.continue/prompts',
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tmp(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-skill-paths-'));
  roots.push(root);
  return root;
}

describe('isSkillPath per host', () => {
  it.each(ALL)('%s: matches SKILL.md and nested files under its own root only', (type) => {
    const root = HOST_ROOTS[type];
    expect(isSkillPath(`${root}/drafting-notes/SKILL.md`, [type])).toBe(true);
    expect(isSkillPath(`${root}/drafting-notes/references/deep/a.md`, [type])).toBe(true);
    expect(isSkillPath(`${root}/drafting-notes/scripts/run.ts`, [type])).toBe(true);
    expect(isSkillPath(`${root}/README.md`, [type])).toBe(false);
    const other = ALL.find((candidate) => HOST_ROOTS[candidate] !== root)!;
    expect(isSkillPath(`${HOST_ROOTS[other]}/drafting-notes/SKILL.md`, [type])).toBe(false);
  });

  it('reads each root from the adapter itself, keeping no copy of the list', () => {
    for (const type of ALL) {
      const adapter = AdapterFactory.create(type);
      expect(adapter).toBeInstanceOf(BaseAdapter);
      expect((adapter as BaseAdapter).getSkillsRoot()).toBe(HOST_ROOTS[type]);
    }
    expect(skillRoots(['claude-code'])).toEqual(['.claude/skills', '.agents/skills']);
  });
});

describe('isSkillPath shared rules', () => {
  it('always matches the open-standard .agents/skills folder', () => {
    expect(isSkillPath('.agents/skills/drafting-notes/SKILL.md', [])).toBe(true);
    expect(isSkillPath('.agents/skills/drafting-notes/assets/t.txt', ['codex-cli'])).toBe(true);
  });

  it('normalises backslashes and a leading ./', () => {
    expect(isSkillPath('.claude\\skills\\drafting-notes\\SKILL.md', ['claude-code'])).toBe(true);
    expect(isSkillPath('./.claude/skills/drafting-notes/SKILL.md', ['claude-code'])).toBe(true);
  });

  it('is case-sensitive on the root folders', () => {
    expect(isSkillPath('.Claude/Skills/drafting-notes/SKILL.md', ['claude-code'])).toBe(false);
  });

  it('matches the paqad runtime roots only inside the paqad repository', () => {
    const paths = [
      'runtime/base/skills/expert-notes/SKILL.md',
      'runtime/claude-plugin/skills/hud/SKILL.md',
      'runtime/capabilities/security/skills/auth-mechanism-review/references/a.md',
    ];
    for (const path of paths) {
      expect(isSkillPath(path, ['claude-code'], { paqadRepo: true })).toBe(true);
      expect(isSkillPath(path, ['claude-code'])).toBe(false);
    }
    expect(isSkillPath('runtime/base/skills/README.md', [], { paqadRepo: true })).toBe(false);
    expect(isSkillPath('runtime/capabilities/skills/x/SKILL.md', [], { paqadRepo: true })).toBe(
      false,
    );
  });

  it('names the skill folder a path belongs to', () => {
    expect(skillNameOf('.claude/skills/processing-invoices/scripts/x.ts', ['claude-code'])).toBe(
      'processing-invoices',
    );
    expect(skillNameOf('src/a.ts', ['claude-code'])).toBeNull();
  });

  it('filters a file list down to its skill paths in order', () => {
    expect(
      findSkillPaths(
        ['src/a.ts', '.cursor/skills/b/SKILL.md', '.agents/skills/a/x.md'],
        ['cursor'],
      ),
    ).toEqual(['.cursor/skills/b/SKILL.md', '.agents/skills/a/x.md']);
  });
});

describe('the project context', () => {
  it('uses every host when no onboarding manifest is readable', () => {
    expect(enabledAdapters(tmp())).toEqual([...ADAPTER_TYPES]);
  });

  it('uses the recorded hosts from the onboarding manifest', () => {
    const root = tmp();
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/onboarding-manifest.json'),
      JSON.stringify({
        adapter: 'codex-cli',
        generated_artifacts: [{ path: AdapterFactory.create('cursor').getConfigPath() }],
      }),
    );
    expect(enabledAdapters(root)).toEqual(['codex-cli', 'cursor']);
  });

  it('knows the paqad repository by its package name', () => {
    const root = tmp();
    expect(isPaqadRepository(root)).toBe(false);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'paqad-ai' }));
    expect(readSkillPathContext(root).paqadRepo).toBe(true);
    expect(isPaqadRepository(process.cwd())).toBe(true);
  });
});
