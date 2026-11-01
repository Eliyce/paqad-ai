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

const STRING_KEYS = ['model_tier', 'cacheable', 'output_format', 'max_lines', 'max_output_tokens'];
const META_FILE_KEYS = [
  'triggers',
  'input_schema',
  'cache_key_inputs',
  'request_routing',
  'on_complete',
  'tools',
];

function pick(source, keys) {
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
}

// paqad skills keep their custom keys under `metadata`, with JSON-shaped values in the
// sibling file named by `metadata.paqad-meta`; older skills still carry them top level.
function resolveMetadata(raw, folder) {
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  const ref = metadata['paqad-meta'];
  let sidecar = {};
  if (typeof ref === 'string' && !ref.startsWith('/') && !ref.split(/[\\/]/).includes('..')) {
    try {
      sidecar = YAML.parse(readFileSync(join(folder, ref), 'utf8')) ?? {};
    } catch {
      sidecar = {};
    }
  }
  return { ...raw, ...pick(metadata, STRING_KEYS), ...pick(sidecar, META_FILE_KEYS) };
}

const index = files.map((file) => {
  const content = readFileSync(file, 'utf8');
  const [, frontmatterBlock = ''] = content.split(/^---$/m);
  const frontmatter = resolveMetadata(YAML.parse(frontmatterBlock), dirname(file));
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
