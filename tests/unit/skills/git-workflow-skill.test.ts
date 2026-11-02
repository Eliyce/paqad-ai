import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { defaultGitWorkflow } from '@/git-workflow/defaults.js';
import { resolveSkillMetadata, splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';
import { SchemaValidator } from '@/validators';

const DIR = join(__dirname, '..', '..', '..', 'runtime/base/skills/git-workflow');
const read = (rel: string) => readFileSync(join(DIR, rel), 'utf8');

const FILES = [
  'SKILL.md',
  'agents/openai.yaml',
  'scripts/check.mjs',
  'scripts/propose.mjs',
  'scripts/apply.mjs',
  'scripts/change.mjs',
  'references/settings.md',
  'references/signals.md',
  'references/questions.md',
  'references/summaries.md',
  'assets/answers.template.json',
  'assets/change.template.json',
  'assets/final-message.txt',
];

const RULES = [
  "Change .paqad/configs/git-workflow/ only through this skill's scripts. Never edit those files with Edit, Write or a shell command: paqad blocks direct edits, and a change that skips the scripts is never checked or recorded.",
  "Base every proposal on what the scripts found. When history is mixed, ask the team; don't pick for them. When something can't be read, say it's unknown, never that it doesn't exist.",
  'Record every answer as a decision, so the team can see later why each rule exists.',
];

const STEPS = [
  '1. Run `scripts/check.mjs`. If it reports errors or `changed_outside`, show them and stop until the team says how to handle them.',
  '2. Run `scripts/propose.mjs`. If `mode` is `new-project`, switch to the new-project procedure.',
  "4. Ask every `choice` in one round with your host's question tool. Use up to 4 questions per call, back to back. Put the recommended option first, and put the evidence counts and examples in each option's preview.",
  '6. Write the answers to a temporary `answers.json` outside the repo, starting from `assets/answers.template.json`. Run `scripts/apply.mjs <answers.json> --overwrite --dry-run` and show the diff. Then run it again without `--dry-run`.',
  '3. Run `scripts/change.mjs --plan <change.json>`. Explain the diff in plain words, for example: "Hotfix branches will start from main and use ServiceNow tickets."',
  '6. Ship it like any change, so the team reviews it as a PR: `paqad-ai deliver` on its own branch, with the resolved decision committed. Use the branch type `chore` if the team has one; otherwise its `default_type`.',
];

function leafPaths(value: unknown, prefix: string[] = []): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix.join('.')];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return [prefix.join('.')];
  return entries.flatMap(([key, child]) => leafPaths(child, [...prefix, key]));
}

describe('the git-workflow skill', () => {
  it('has every file the layout names', () => {
    for (const file of FILES) expect(existsSync(join(DIR, file)), file).toBe(true);
  });

  it('has frontmatter that passes skill-frontmatter.schema.json and stays under 300 lines', () => {
    const content = read('SKILL.md');
    const split = splitSkillFrontmatter(content);
    if (!split.ok) throw new Error(split.message);
    const merged = { ...resolveSkillMetadata(split.data, DIR) };
    delete merged.metadata;
    const result = new SchemaValidator().validate('skill-frontmatter', merged);
    expect(result.errors ?? []).toEqual([]);
    expect(merged).toMatchObject({ name: 'git-workflow', model_tier: 'medium', max_lines: 300 });
    expect(content.split('\n').length).toBeLessThan(300);
  });

  it('carries the three rules and the procedure steps word for word', () => {
    const content = read('SKILL.md');
    for (const rule of RULES) expect(content).toContain(`- ${rule}`);
    for (const step of STEPS) expect(content).toContain(step);
    expect(content).toContain('### First setup');
    expect(content).toContain('### New project');
    expect(content).toContain('### Change');
  });

  it('lists every default setting in references/settings.md', () => {
    const settings = read('references/settings.md');
    const config = defaultGitWorkflow();
    const sections = {
      tickets: config.tickets,
      branches: { ...config.branches, types: { '<name>': config.branches.types.feature } },
      commits: config.commits,
      pull_requests: config.pull_requests,
      enforcement: config.enforcement,
    };
    const missing = Object.values(sections)
      .flatMap((section) => leafPaths(section))
      .filter((path) => !settings.includes(`\`${path}\``));
    expect(missing).toEqual([]);
  });

  it('ships the openai agent card', () => {
    expect(YAML.parse(read('agents/openai.yaml'))).toMatchObject({
      interface: { display_name: 'Git Workflow Rules' },
    });
  });
});
