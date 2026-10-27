#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const ALLOWED_KEYS = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
];

export const HOST_LABELS = [
  {
    prefix: 'Chat and Claude Code: ',
    compatibility:
      'claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder',
  },
  {
    prefix: 'Claude Code: ',
    compatibility: 'Claude Code with a project folder open (needs a shell)',
  },
];

export const DEFAULT_SKILL_ROOTS = ['runtime/claude-plugin/skills', 'plugins/discovery/skills'];

const BIN_HOMES = ['dist/', 'runtime/claude-plugin/bin/'];

function readFrontMatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { missing: true };
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return { missing: true };
  const after = normalized.charAt(end + 4);
  if (after !== '' && after !== '\n') return { missing: true };
  try {
    const data = parse(normalized.slice(4, end + 1));
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { error: 'is not a key and value mapping' };
    }
    return { data };
  } catch (error) {
    return { error: `does not parse as YAML (${error.message.split('\n')[0]})` };
  }
}

function checkLabels(data) {
  const description = typeof data.description === 'string' ? data.description : '';
  const label = HOST_LABELS.find((candidate) => description.startsWith(candidate.prefix));
  if (!label) {
    const prefixes = HOST_LABELS.map((candidate) => `"${candidate.prefix}"`).join(' or ');
    return [`description must start with exactly ${prefixes}`];
  }
  if (data.compatibility !== label.compatibility) {
    return [
      `compatibility must be "${label.compatibility}" for a description starting "${label.prefix}"`,
    ];
  }
  return [];
}

function checkSkill(skillMd) {
  if (!existsSync(skillMd)) return ['SKILL.md is missing'];
  const front = readFrontMatter(readFileSync(skillMd, 'utf8'));
  if (front.missing) {
    return ['front matter is missing; open the file with --- and close it with ---'];
  }
  if (front.error) return [`front matter ${front.error}`];
  const findings = [];
  for (const key of Object.keys(front.data)) {
    if (!ALLOWED_KEYS.includes(key)) {
      findings.push(
        `front-matter key "${key}" is not allowed; use only ${ALLOWED_KEYS.join(', ')}`,
      );
    }
  }
  return findings.concat(checkLabels(front.data));
}

function checkBin(pluginRoot) {
  const findings = [];
  const binDir = join(pluginRoot, 'bin');
  if (existsSync(binDir) && statSync(binDir).isDirectory()) {
    findings.push({
      file: 'bin',
      message:
        'the plugin root must not have a bin/ folder; keep the launcher under runtime/claude-plugin/bin/',
    });
  }
  const packageJson = join(pluginRoot, 'package.json');
  if (!existsSync(packageJson)) return findings;
  const bin = JSON.parse(readFileSync(packageJson, 'utf8')).bin;
  const entries = typeof bin === 'string' ? { bin } : (bin ?? {});
  for (const [name, target] of Object.entries(entries)) {
    const path = String(target).replace(/^\.\//, '');
    if (!BIN_HOMES.some((home) => path.startsWith(home))) {
      findings.push({
        file: 'package.json',
        message: `bin "${name}" points at ${target}; keep it under ${BIN_HOMES.join(' or ')}`,
      });
    }
  }
  return findings;
}

export function checkPluginSkills({ skillRoots, pluginRoot }) {
  const root = resolve(pluginRoot);
  const findings = checkBin(root);
  for (const skillRoot of skillRoots) {
    const absolute = resolve(root, skillRoot);
    if (!existsSync(absolute)) {
      findings.push({ file: relative(root, absolute), message: 'skills folder is missing' });
      continue;
    }
    for (const name of readdirSync(absolute).sort()) {
      const folder = join(absolute, name);
      if (!statSync(folder).isDirectory()) continue;
      const skillMd = join(folder, 'SKILL.md');
      for (const message of checkSkill(skillMd)) {
        findings.push({ file: relative(root, skillMd).replace(/\\/g, '/'), message });
      }
    }
  }
  return findings;
}

export function reportPluginSkills({
  skillRoots = DEFAULT_SKILL_ROOTS,
  pluginRoot = repoRoot,
} = {}) {
  const findings = checkPluginSkills({ skillRoots, pluginRoot });
  for (const finding of findings) {
    console.error(`[paqad] plugin skill check: ${finding.file}: ${finding.message}`);
  }
  return findings.length === 0;
}

function invokedDirectly() {
  return (
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (invokedDirectly()) {
  if (!reportPluginSkills()) process.exit(1);
  console.log('[paqad] plugin skill check passed.');
}
