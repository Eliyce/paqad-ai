#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

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

const REMOVED_IN = '1.117.0';
const EVENTS_LOG = join(cwd, '.paqad/skills/events.jsonl');

class SkillMetaError extends Error {}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readSidecar(skill, folder, ref) {
  if (typeof ref !== 'string' || ref.trim() === '') {
    throw new SkillMetaError(
      `Skill "${skill}": metadata.paqad-meta must name a file in the skill folder.`,
    );
  }
  if (isAbsolute(ref) || ref.startsWith('/') || ref.split(/[\\/]/).includes('..')) {
    throw new SkillMetaError(
      `Skill "${skill}": metadata.paqad-meta "${ref}" must be a path inside the skill folder (no absolute path, no "..").`,
    );
  }
  let text;
  try {
    const real = realpathSync(join(folder, ref));
    if (!real.startsWith(`${realpathSync(folder)}${sep}`)) {
      throw new SkillMetaError(
        `Skill "${skill}": ${ref} leads through a symlink outside the skill folder.`,
      );
    }
    text = readFileSync(real, 'utf8');
  } catch (error) {
    if (error instanceof SkillMetaError) throw error;
    throw new SkillMetaError(`Skill "${skill}": ${ref} named by metadata.paqad-meta is missing.`);
  }
  let parsed;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    throw new SkillMetaError(`Skill "${skill}": ${ref} is not valid YAML: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SkillMetaError(`Skill "${skill}": ${ref} must be a YAML object.`);
  }
  return parsed;
}

function deprecationLine(skill, oldKeys, disagreeing) {
  if (oldKeys.length === 0) return null;
  const one = oldKeys.length === 1;
  const line =
    `Skill "${skill}": top-level ${[...oldKeys].sort().join(', ')} ${one ? 'is' : 'are'} deprecated and ` +
    `stop${one ? 's' : ''} working in ${REMOVED_IN}; move ${one ? 'it' : 'them'} under metadata (or skill.meta.yaml).`;
  if (disagreeing.length === 0) return line;
  return `${line} ${[...disagreeing].sort().join(', ')} ${disagreeing.length === 1 ? 'disagrees' : 'disagree'} with metadata; the metadata value wins.`;
}

function loggedDeprecations() {
  if (!existsSync(EVENTS_LOG)) return new Set();
  const seen = new Set();
  for (const row of readFileSync(EVENTS_LOG, 'utf8').split('\n')) {
    try {
      const event = JSON.parse(row);
      if (event.type === 'skill.metadata_deprecated') seen.add(`${event.path}\n${event.message}`);
    } catch {}
  }
  return seen;
}

const seenDeprecations = loggedDeprecations();

function reportDeprecation(file, skill, message) {
  if (seenDeprecations.has(`${file}\n${message}`)) return;
  seenDeprecations.add(`${file}\n${message}`);
  try {
    mkdirSync(dirname(EVENTS_LOG), { recursive: true });
    const event = {
      ts: new Date().toISOString(),
      type: 'skill.metadata_deprecated',
      path: file,
      skill,
      message,
    };
    appendFileSync(EVENTS_LOG, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {}
  process.stderr.write(`paqad: ${message}\n`);
}

function resolveMetadata(raw, folder, file) {
  const skill =
    typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : basename(folder);
  const metadata =
    raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
      ? raw.metadata
      : {};
  const sidecar =
    metadata['paqad-meta'] === undefined ? {} : readSidecar(skill, folder, metadata['paqad-meta']);
  const fresh = { ...pick(metadata, STRING_KEYS), ...pick(sidecar, META_FILE_KEYS) };
  const oldKeys = [...STRING_KEYS, ...META_FILE_KEYS].filter((key) => raw[key] !== undefined);
  const disagreeing = oldKeys.filter((key) => key in fresh && !sameValue(raw[key], fresh[key]));
  const message = deprecationLine(skill, oldKeys, disagreeing);
  if (message !== null) reportDeprecation(file, skill, message);
  return { ...raw, ...fresh };
}

const index = files.flatMap((file) => {
  const content = readFileSync(file, 'utf8');
  const [, frontmatterBlock = ''] = content.split(/^---$/m);
  let frontmatter;
  try {
    frontmatter = resolveMetadata(YAML.parse(frontmatterBlock) ?? {}, dirname(file), file);
  } catch (error) {
    if (!(error instanceof SkillMetaError)) throw error;
    process.stderr.write(
      `skill-index-gen: ${error.message} Left out of the index: ${relative(cwd, file)}\n`,
    );
    return [];
  }
  const model =
    frontmatter.model_tier === 'fast'
      ? profile.model_routing.fast_model
      : frontmatter.model_tier === 'reasoning' || frontmatter.model_tier === 'deep'
        ? profile.model_routing.reasoning_model
        : profile.model_routing.default_model;

  return [
    {
      name: frontmatter.name,
      description: frontmatter.description,
      triggers: frontmatter.triggers,
      model_tier: frontmatter.model_tier === 'deep' ? 'reasoning' : frontmatter.model_tier,
      resolved_model: model,
      output_format: frontmatter.output_format,
      file: relative(cwd, file),
    },
  ];
});

mkdirSync(dirname(input), { recursive: true });
writeFileSync(input, `${JSON.stringify(index, null, 2)}\n`);
