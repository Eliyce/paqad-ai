import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getFileInfo } from 'prettier';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { serializePluginHooksJson } from '@/plugin/manifest-build.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const skillsDir = join(repoRoot, 'runtime', 'claude-plugin', 'skills');

const CLAUDE_CODE_SKILLS = ['onboard', 'join', 'dashboard'] as const;

const FIRST_DEVELOPER_STEP_BEFORE_THE_CHECK: Record<(typeof CLAUDE_CODE_SKILLS)[number], string> = {
  onboard: 'You are the project lead setting paqad up for the whole team.',
  join: 'The project is already onboarded (it has a committed `.paqad/`). This sets up only your machine.',
  dashboard: 'The dashboard is a local web app for this project. It never leaves the machine.',
};

function body(name: string): string {
  const text = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8');
  const end = text.indexOf('\n---\n', 4);
  return text.slice(end + '\n---\n'.length);
}

describe('hand-written plugin skills', () => {
  it.each(CLAUDE_CODE_SKILLS)(
    'AC-12: %s opens with the Claude Code check and keeps its developer steps',
    (name) => {
      const paragraphs = body(name)
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean);
      expect(paragraphs[0]).toMatch(/^# /);
      const check = paragraphs[1];
      expect(check).toContain('If there is no shell and no project folder open');
      expect(check).toContain('reply in one sentence that this works in Claude Code');
      expect(check).toContain('and stop');
      expect(check).toContain('do not mention this check');
      expect(paragraphs[2]).toBe(FIRST_DEVELOPER_STEP_BEFORE_THE_CHECK[name]);
    },
  );
});

describe('tooling around the generated skills', () => {
  it('AC-22: format:check skips plugins/ and the generated skills but still checks onboard, join and dashboard', async () => {
    const ignorePath = [join(repoRoot, '.prettierignore')];
    const ignored = async (rel: string) =>
      (await getFileInfo(join(repoRoot, rel), { ignorePath })).ignored;
    expect(await ignored('plugins/discovery/README.md')).toBe(true);
    expect(await ignored('plugins/discovery/skills/ask-project/SKILL.md')).toBe(true);
    const generated = readdirSync(skillsDir).filter(
      (name) => !(CLAUDE_CODE_SKILLS as readonly string[]).includes(name),
    );
    expect(generated).toHaveLength(14);
    for (const name of generated) {
      expect(await ignored(`runtime/claude-plugin/skills/${name}/SKILL.md`), name).toBe(true);
    }
    for (const name of CLAUDE_CODE_SKILLS) {
      expect(await ignored(`runtime/claude-plugin/skills/${name}/SKILL.md`), name).toBe(false);
    }
    const eslintConfig = readFileSync(join(repoRoot, 'eslint.config.js'), 'utf8');
    expect(eslintConfig).toContain(`'plugins/**'`);
  });

  it('AC-23: the plugin skills bring no hook, agent or command, and hooks.json is still its generator output', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? [name, ...walk(full)] : [name];
      });
    const names = walk(skillsDir);
    for (const forbidden of ['hooks', 'hooks.json', 'agents', 'commands', '.mcp.json']) {
      expect(names, forbidden).not.toContain(forbidden);
    }
    expect(readFileSync(join(repoRoot, 'runtime', 'claude-plugin', 'hooks.json'), 'utf8')).toBe(
      serializePluginHooksJson(),
    );
  });

  it('AC-25: the claude-plugin module owns the plugin code, the generated skills and the discovery source', () => {
    const map = parse(
      readFileSync(join(repoRoot, 'docs', 'instructions', 'rules', 'module-map.yml'), 'utf8'),
    ) as { modules: { slug: string; sources: string[] }[] };
    const plugin = map.modules.find((module) => module.slug === 'claude-plugin');
    expect(plugin?.sources).toEqual(
      expect.arrayContaining([
        'src/plugin',
        'runtime/claude-plugin',
        'plugins/discovery',
        'scripts/assemble-plugin.mjs',
        'scripts/build-plugin-manifest.mjs',
        'scripts/validate-plugin.mjs',
        'scripts/test-plugin.mjs',
        'scripts/build-discovery.mjs',
        'scripts/check-plugin-skills.mjs',
      ]),
    );
    for (const source of plugin!.sources) {
      expect(existsSync(join(repoRoot, source)), source).toBe(true);
    }
  });

  it('AC-26: the release notes name the new skills in a minor bump', () => {
    const changeset = join(repoRoot, '.changeset', 'one-paqad-plugin-discovery-skills.md');
    const text = existsSync(changeset)
      ? readFileSync(changeset, 'utf8')
      : readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
    if (existsSync(changeset)) expect(text).toMatch(/^---\n'paqad-ai': minor\n---\n/);
    for (const skill of [
      '/paqad:start',
      '/paqad:discover',
      '/paqad:ask',
      '/paqad:refine-ticket',
      '/paqad:size-work',
      '/paqad:plan-sprint',
    ]) {
      expect(text).toContain(skill);
    }
  });
});
