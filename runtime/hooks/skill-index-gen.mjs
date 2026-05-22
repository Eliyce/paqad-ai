#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import fg from 'fast-glob';
import YAML from 'yaml';

const input = process.argv[2];
const cwd = process.argv[3] ?? process.cwd();

if (!input) {
  process.stderr.write('skill-index-gen: missing output path\n');
  process.exit(2);
}

const profilePath = join(cwd, '.paqad/project-profile.yaml');
const profile = YAML.parse(readFileSync(profilePath, 'utf8'));
const files = (
  await fg(
    ['.claude/skills/**/SKILL.md', '.codex/skills/**/SKILL.md', '.gemini/skills/**/SKILL.md'],
    {
      cwd,
      absolute: true,
    },
  )
).sort();

const index = files.map((file) => {
  const content = readFileSync(file, 'utf8');
  const [, frontmatterBlock = ''] = content.split(/^---$/m);
  const frontmatter = YAML.parse(frontmatterBlock);
  const model =
    frontmatter.model_tier === 'fast'
      ? profile.model_routing.fast_model
      : frontmatter.model_tier === 'reasoning' || frontmatter.model_tier === 'deep'
        ? profile.model_routing.reasoning_model
        : profile.model_routing.default_model;

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    triggers: frontmatter.triggers,
    model_tier: frontmatter.model_tier === 'deep' ? 'reasoning' : frontmatter.model_tier,
    resolved_model: model,
    output_format: frontmatter.output_format,
    file: relative(cwd, file),
  };
});

mkdirSync(dirname(input), { recursive: true });
writeFileSync(input, `${JSON.stringify(index, null, 2)}\n`);
