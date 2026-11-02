import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import fg from 'fast-glob';
import { afterEach, describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { SkillFrontmatterParser, toLoadedSkill } from '@/skills/frontmatter-parser.js';
import { SkillTriggerEvaluator } from '@/skills/trigger-evaluator.js';

import { fixtureClassification } from './shared.fixture.js';

const REPO = join(__dirname, '..', '..', '..');
const RUNTIME = join(REPO, 'runtime');
const SKILL = 'runtime/base/skills/acceptance-criteria-gen';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function parseAt(folder: string) {
  return new SkillFrontmatterParser().parse(readFileSync(join(folder, 'SKILL.md'), 'utf8'), folder)
    .frontmatter;
}

describe('skill.meta.yaml travels with SKILL.md (AC-35)', () => {
  it('onboarding writes the sidecar next to SKILL.md and the installed skill parses the same', async () => {
    const files = await fg('**/*', { cwd: join(REPO, SKILL), absolute: true, onlyFiles: true });
    const artifacts = files.sort().map((path) => ({
      path,
      level: 1,
      source: relative(RUNTIME, path),
    }));
    const generated = await new ClaudeCodeAdapter().generateSkills(artifacts);
    expect(generated.map((file) => file.path)).toContain(
      '.claude/skills/acceptance-criteria-gen/skill.meta.yaml',
    );
    const project = mkdtempSync(join(tmpdir(), 'paqad-skill-install-'));
    dirs.push(project);
    for (const file of generated) {
      mkdirSync(dirname(join(project, file.path)), { recursive: true });
      writeFileSync(join(project, file.path), file.content);
    }
    const installed = parseAt(join(project, '.claude/skills/acceptance-criteria-gen'));
    const repo = parseAt(join(REPO, SKILL));
    expect(installed.triggers).toEqual(repo.triggers);
    expect(installed.model_tier).toEqual(repo.model_tier);
  });

  it('the plugin build ships every sidecar, because it copies the runtime tree whole', () => {
    const script = readFileSync(join(REPO, 'scripts/assemble-plugin.mjs'), 'utf8');
    expect(script).toContain("'runtime',");
    expect(script).not.toContain('skill.meta.yaml');
  });
});

const REQUESTS = [
  {},
  { workflow: 'documentation-update' },
  { workflow: 'bug-fix', process_depth: 'fast lane' },
  { process_depth: 'full lane', output_type: 'report' },
  { database_impact: 'schema-change' },
  { ui_impact: 'new-screen' },
  { api_impact: 'new-endpoint', scope: 'cross-module' },
  { risk: 'high' },
] as const;

function skillFolders(): string[] {
  return [
    'runtime/base/skills',
    'runtime/capabilities/coding/skills',
    'runtime/capabilities/security/skills',
  ]
    .flatMap((root) => readdirSync(join(REPO, root)).map((name) => join(REPO, root, name)))
    .sort();
}

describe('trigger activation parity (AC-16)', () => {
  it('activates the same skills for each request as before the metadata move', () => {
    const evaluator = new SkillTriggerEvaluator();
    const skills = skillFolders().map((folder) => {
      const file = join(folder, 'SKILL.md');
      return toLoadedSkill(
        file,
        new SkillFrontmatterParser().parse(readFileSync(file, 'utf8'), folder),
      );
    });
    const activated = REQUESTS.map((overrides) => ({
      request: overrides,
      skills: skills
        .filter((skill) => evaluator.shouldLoad(skill, fixtureClassification(overrides)))
        .map((skill) => skill.name)
        .sort(),
    }));
    expect(activated.every((entry) => entry.skills.length > 0)).toBe(true);
    expect(activated).toMatchSnapshot();
  });
});
