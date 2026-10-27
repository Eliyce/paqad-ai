#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const HAND_WRITTEN_SKILLS = ['onboard', 'join', 'dashboard'];
export const PYTHON_CANDIDATES = ['python3', 'python'];
export const MIN_PYTHON = [3, 9];
const NEVER_COPIED = new Set(['__pycache__', '.DS_Store']);

export class BuildDiscoveryError extends Error {}

export function probePython(command) {
  const result = spawnSync(
    command,
    ['-c', 'import sys; print("%d.%d.%d" % tuple(sys.version_info[:3]))'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function isSupported(version) {
  const [major, minor] = version.split('.').map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(major) || Number.isNaN(minor)) return false;
  return major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1]);
}

export function findPython(probe = probePython) {
  const found = [];
  for (const command of PYTHON_CANDIDATES) {
    const version = probe(command);
    if (version === null) continue;
    if (isSupported(version)) return { command, version };
    found.push(`${command} ${version}`);
  }
  const seen = found.length > 0 ? found.join(', ') : 'none';
  throw new BuildDiscoveryError(
    `pnpm build:discovery needs Python ${MIN_PYTHON.join('.')} or newer as python3 or python on PATH; found ${seen}.`,
  );
}

function shipsFile(source) {
  return !NEVER_COPIED.has(basename(source)) && !source.endsWith('.pyc');
}

export function copyGeneratedSkills({ builtSkillsDir, skillsDir }) {
  const built = readdirSync(builtSkillsDir)
    .filter((name) => statSync(join(builtSkillsDir, name)).isDirectory())
    .sort();
  if (built.length === 0) {
    throw new BuildDiscoveryError(`the discovery build produced no skills in ${builtSkillsDir}.`);
  }
  const clashes = built.filter((name) => HAND_WRITTEN_SKILLS.includes(name));
  if (clashes.length > 0) {
    throw new BuildDiscoveryError(
      `generated skill ${clashes.join(', ')} clashes with the hand-written skill of the same name in runtime/claude-plugin/skills; rename it in plugins/discovery/build/skills.yml. Nothing was overwritten.`,
    );
  }
  for (const name of readdirSync(skillsDir)) {
    if (HAND_WRITTEN_SKILLS.includes(name)) continue;
    rmSync(join(skillsDir, name), { recursive: true, force: true });
  }
  for (const name of built) {
    cpSync(join(builtSkillsDir, name), join(skillsDir, name), {
      recursive: true,
      filter: shipsFile,
    });
  }
  return built;
}

function claudeSkillsDir(distRoot) {
  const pluginsDir = join(distRoot, 'hosts', 'claude', 'plugins');
  const plugins = existsSync(pluginsDir) ? readdirSync(pluginsDir) : [];
  if (plugins.length !== 1) {
    throw new BuildDiscoveryError(
      `expected one plugin under ${pluginsDir}, found ${plugins.length}.`,
    );
  }
  return join(pluginsDir, plugins[0], 'skills');
}

export function buildDiscovery({ root = repoRoot, probe } = {}) {
  const python = findPython(probe);
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const distRoot = mkdtempSync(join(tmpdir(), 'paqad-discovery-'));
  try {
    const result = spawnSync(
      python.command,
      [
        join(root, 'plugins', 'discovery', 'build', 'build.py'),
        '--dist',
        distRoot,
        '--host-labels',
        'keep',
        '--version',
        version,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      },
    );
    if (result.error || result.status !== 0) {
      const reason = (result.stderr || result.error?.message || '').trim().split('\n').pop();
      throw new BuildDiscoveryError(`plugins/discovery/build/build.py failed: ${reason}`);
    }
    const skills = copyGeneratedSkills({
      builtSkillsDir: claudeSkillsDir(distRoot),
      skillsDir: join(root, 'runtime', 'claude-plugin', 'skills'),
    });
    return { skills, version, python };
  } finally {
    rmSync(distRoot, { recursive: true, force: true });
  }
}

function invokedDirectly() {
  return (
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (invokedDirectly()) {
  try {
    const { skills, version, python } = buildDiscovery();
    console.log(
      `[paqad] discovery skills generated (v${version}, ${python.command} ${python.version}): ${skills.length} skills in runtime/claude-plugin/skills. Commit them.`,
    );
  } catch (error) {
    if (!(error instanceof BuildDiscoveryError)) throw error;
    console.error(`[paqad] ${error.message}`);
    process.exit(1);
  }
}
