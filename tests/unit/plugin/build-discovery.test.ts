import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BuildDiscoveryError,
  copyGeneratedSkills,
  findPython,
  HAND_WRITTEN_SKILLS,
} from '../../../scripts/build-discovery.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(repoRoot, 'scripts', 'build-discovery.mjs');
const SKILLS_DIR = join(repoRoot, 'runtime', 'claude-plugin', 'skills');
const FORMER_NAMES = [
  'paqad-discover',
  'paqad-ask',
  'paqad-get-connected',
  'paqad-understand-idea',
  'paqad-ground-in-project',
  'paqad-shape-idea',
  'paqad-decide-together',
  'paqad-write-tickets',
  'paqad-check-tickets',
  'paqad-post-tickets',
  'paqad-refine-ticket',
  'paqad-size-work',
  'paqad-plan-sprint',
];
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function write(root: string, rel: string, text = 'x'): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[full.slice(root.length + 1).replace(/\\/g, '/')] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

function generatedSkills(): string[] {
  return readdirSync(SKILLS_DIR).filter(
    (name) => !HAND_WRITTEN_SKILLS.includes(name) && statSync(join(SKILLS_DIR, name)).isDirectory(),
  );
}

describe('scripts/build-discovery.mjs', () => {
  it('AC-14: without Python 3.9 on PATH it prints one line, exits 1 and leaves the skills alone', () => {
    const before = snapshot(SKILLS_DIR);
    const emptyPath = tempDir('paqad-no-python-');
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PATH: emptyPath, Path: emptyPath },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      '[paqad] pnpm build:discovery needs Python 3.9 or newer as python3 or python on PATH; found none.\n',
    );
    expect(snapshot(SKILLS_DIR)).toEqual(before);
  });

  it.skipIf(process.platform === 'win32')(
    'AC-14: an old python3 on PATH is named in the one-line failure',
    () => {
      const before = snapshot(SKILLS_DIR);
      const bin = tempDir('paqad-old-python-');
      write(bin, 'python3', '#!/bin/sh\necho 3.8.10\n');
      chmodSync(join(bin, 'python3'), 0o755);
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: bin },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        '[paqad] pnpm build:discovery needs Python 3.9 or newer as python3 or python on PATH; found python3 3.8.10.\n',
      );
      expect(snapshot(SKILLS_DIR)).toEqual(before);
    },
  );

  it('AC-14: picks python3 first, falls back to python, and rejects Python 2 and 3.8', () => {
    expect(findPython((command) => (command === 'python3' ? '3.9.0' : '3.12.1'))).toEqual({
      command: 'python3',
      version: '3.9.0',
    });
    expect(findPython((command) => (command === 'python3' ? null : '3.11.4'))).toEqual({
      command: 'python',
      version: '3.11.4',
    });
    expect(() =>
      findPython((command) => (command === 'python3' ? '3.8.18' : '2.7.18')),
    ).toThrowError(
      new BuildDiscoveryError(
        'pnpm build:discovery needs Python 3.9 or newer as python3 or python on PATH; found python3 3.8.18, python 2.7.18.',
      ),
    );
    expect(() => findPython(() => 'not a version')).toThrow(BuildDiscoveryError);
  });

  it('AC-15: a generated skill named like a hand-written one fails and overwrites nothing', () => {
    const built = tempDir('paqad-built-');
    const skills = tempDir('paqad-skills-');
    write(built, 'start/SKILL.md', 'new start');
    write(built, 'join/SKILL.md', 'generated join');
    write(skills, 'join/SKILL.md', 'hand-written join');
    write(skills, 'start/SKILL.md', 'old start');
    const before = snapshot(skills);
    expect(() => copyGeneratedSkills({ builtSkillsDir: built, skillsDir: skills })).toThrow(
      /generated skill join clashes with the hand-written skill of the same name.*Nothing was overwritten\./,
    );
    expect(snapshot(skills)).toEqual(before);
  });

  it('replaces every generated folder, keeps the hand-written skills and skips caches', () => {
    const built = tempDir('paqad-built-');
    const skills = tempDir('paqad-skills-');
    write(built, 'start/SKILL.md', 'new start');
    write(built, 'ask/scripts/x.py', 'print(1)');
    write(built, 'ask/scripts/__pycache__/x.cpython-39.pyc', 'cache');
    write(built, 'ask/.DS_Store', 'junk');
    for (const name of HAND_WRITTEN_SKILLS) write(skills, `${name}/SKILL.md`, name);
    write(skills, 'removed-skill/SKILL.md', 'gone');
    write(skills, 'start/stale.md', 'stale');
    expect(copyGeneratedSkills({ builtSkillsDir: built, skillsDir: skills })).toEqual([
      'ask',
      'start',
    ]);
    expect(snapshot(skills)).toEqual({
      'ask/scripts/x.py': 'print(1)',
      'dashboard/SKILL.md': 'dashboard',
      'join/SKILL.md': 'join',
      'onboard/SKILL.md': 'onboard',
      'start/SKILL.md': 'new start',
    });
    expect(() =>
      copyGeneratedSkills({ builtSkillsDir: tempDir('paqad-empty-'), skillsDir: skills }),
    ).toThrow(BuildDiscoveryError);
  });

  it('AC-30: neither the build nor the ci script runs the discovery build or Python', () => {
    const scripts = (
      JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['build:discovery']).toBe('node scripts/build-discovery.mjs');
    for (const name of ['build', 'build:server', 'ci', 'release', 'prepublishOnly']) {
      expect(scripts[name], name).not.toMatch(/build:discovery|build-discovery|python/);
    }
  });
});

describe('committed generated discovery skills', () => {
  it('AC-6: no former paqad- skill name appears and the front door is start', () => {
    const pattern = new RegExp(`(?<![\\w-])(?:${FORMER_NAMES.join('|')})(?![\\w-])`);
    const offenders: string[] = [];
    for (const name of generatedSkills()) {
      for (const [rel, text] of Object.entries(snapshot(join(SKILLS_DIR, name)))) {
        if (pattern.test(text)) offenders.push(`${name}/${rel}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(generatedSkills()).toContain('start');
    expect(readFileSync(join(SKILLS_DIR, 'start', 'SKILL.md'), 'utf8')).toMatch(/^name: start$/m);
  });

  it('AC-7: every file a SKILL.md names ships inside its folder and nothing points at plugins/discovery', () => {
    expect(generatedSkills()).toHaveLength(14);
    for (const name of generatedSkills()) {
      const files = snapshot(join(SKILLS_DIR, name));
      const referenced = files['SKILL.md']!.match(/\b(?:references|scripts|assets)\/[\w.-]+\.\w+/g);
      for (const rel of new Set(referenced ?? [])) {
        expect(Object.keys(files), `${name} names ${rel}`).toContain(rel);
      }
      for (const [rel, text] of Object.entries(files)) {
        expect(text.includes('plugins/discovery/'), `${name}/${rel}`).toBe(false);
      }
    }
  });
});
