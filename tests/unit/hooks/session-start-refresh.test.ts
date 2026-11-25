import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../..');
const HOOK = join(REPO_ROOT, 'runtime/hooks/agent-entry-session-start.mjs');
const HAS_DIST = existsSync(join(REPO_ROOT, 'dist/stage-isolation/project-refresh.js'));
const POSIX = process.platform !== 'win32';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()!;
    try {
      chmodSync(join(root, '.claude/agents'), 0o755);
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

function project(adapters: string[] = ['claude-code']): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-session-refresh-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), 'x\n');
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ adapter: adapters[0], providers: adapters, generated_artifacts: [] }),
  );
  return root;
}

function run(
  root: string,
  hook = HOOK,
  env: Record<string, string> = {},
): { status: number | null; stdout: string } {
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const result = spawnSync(process.execPath, [hook], {
    cwd: root,
    input: JSON.stringify({ source: 'startup' }),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      USERPROFILE: home,
      PAQAD_PROJECT_ROOT: root,
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout };
}

function hooksLog(root: string): string[] {
  const path = join(root, '.paqad/logs/hooks.log');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.includes('session-start: refresh'));
}

function mtimes(dir: string): Record<string, number> {
  return Object.fromEntries(
    readdirSync(dir).map((name) => [name, statSync(join(dir, name)).mtimeMs]),
  );
}

describe.skipIf(!HAS_DIST)('the session-start refresh (FR-12, FR-16)', () => {
  it('AC-42: writes one missing agent, then writes nothing and prints nothing when nothing differs', () => {
    const root = project();
    expect(run(root).status).toBe(0);
    const agents = join(root, '.claude/agents');
    expect(readdirSync(agents).filter((name) => name.startsWith('paqad-'))).toHaveLength(13);
    unlinkSync(join(agents, 'paqad-planning.md'));
    const first = run(root);
    expect(first.status).toBe(0);
    expect(first.stdout).toBe('');
    expect(existsSync(join(agents, 'paqad-planning.md'))).toBe(true);
    const before = mtimes(agents);
    const second = run(root);
    expect(second.stdout).toBe('');
    expect(mtimes(agents)).toEqual(before);
    expect(hooksLog(root)).toEqual([]);
  });

  it('AC-6: keeps a marked paqad-planning.md with an edited body byte for byte', () => {
    const root = project();
    run(root);
    const path = join(root, '.claude/agents/paqad-planning.md');
    const edited = `${readFileSync(path, 'utf8')}\nOur extra line.\n`;
    writeFileSync(path, edited);
    expect(run(root).status).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(edited);
  });

  it.skipIf(!POSIX || process.getuid?.() === 0)(
    'AC-43: a read-only agents folder exits 0, prints nothing and logs one line',
    () => {
      const root = project();
      mkdirSync(join(root, '.claude/agents'), { recursive: true });
      chmodSync(join(root, '.claude/agents'), 0o555);
      const result = run(root);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(hooksLog(root)).toHaveLength(1);
    },
  );

  it('AC-43: a refresh module that cannot load exits 0, prints nothing and logs one line', () => {
    const root = project();
    const copy = join(root, 'pkg/runtime/hooks');
    cpSync(join(REPO_ROOT, 'runtime/hooks'), copy, { recursive: true });
    cpSync(join(REPO_ROOT, 'runtime/scripts'), join(root, 'pkg/runtime/scripts'), {
      recursive: true,
    });
    const result = run(root, join(copy, 'agent-entry-session-start.mjs'));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(hooksLog(root)).toHaveLength(1);
    expect(existsSync(join(root, '.claude/agents'))).toBe(false);
  });

  it.skipIf(!POSIX || process.getuid?.() === 0)(
    'AC-45: the logged line holds only the message and the path, never an env secret',
    () => {
      const root = project();
      mkdirSync(join(root, '.claude/agents'), { recursive: true });
      chmodSync(join(root, '.claude/agents'), 0o555);
      run(root, HOOK, { PAQAD_TEST_SECRET: 'sk-very-secret-value' });
      const [line] = hooksLog(root);
      expect(line).toMatch(/session-start: refresh failed at \S+: /u);
      expect(line).not.toContain('sk-very-secret-value');
      expect(line).not.toContain('PAQAD_TEST_SECRET');
    },
  );

  it.skipIf(!POSIX)(
    'AC-44: never writes through a symlinked agent or recipe folder, and logs one line',
    () => {
      const root = project(['claude-code', 'codex-cli']);
      const outside = mkdtempSync(join(tmpdir(), 'paqad-outside-'));
      roots.push(outside);
      writeFileSync(join(outside, 'agent.md'), 'outside\n');
      mkdirSync(join(outside, 'recipe'));
      writeFileSync(join(outside, 'recipe/SKILL.md'), 'outside recipe\n');
      mkdirSync(join(root, '.claude/agents'), { recursive: true });
      mkdirSync(join(root, '.agents/skills'), { recursive: true });
      symlinkSync(join(outside, 'agent.md'), join(root, '.claude/agents/paqad-planning.md'));
      symlinkSync(join(outside, 'recipe'), join(root, '.agents/skills/paqad-planning-recipe'));
      expect(run(root).status).toBe(0);
      expect(readFileSync(join(outside, 'agent.md'), 'utf8')).toBe('outside\n');
      expect(readdirSync(join(outside, 'recipe'))).toEqual(['SKILL.md']);
      expect(readFileSync(join(outside, 'recipe/SKILL.md'), 'utf8')).toBe('outside recipe\n');
      const lines = hooksLog(root);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('.claude/agents/paqad-planning.md');
      expect(lines[0]).toContain('.agents/skills/paqad-planning-recipe');
    },
  );

  it.skipIf(!POSIX)(
    'AC-44: never writes through a symlinked .gitignore in the agent or recipe folder, and logs one line',
    () => {
      const root = project(['claude-code', 'codex-cli']);
      const outside = mkdtempSync(join(tmpdir(), 'paqad-outside-'));
      roots.push(outside);
      writeFileSync(join(outside, 'agents-ignore'), 'theirs\n');
      writeFileSync(join(outside, 'skills-ignore'), 'theirs\n');
      mkdirSync(join(root, '.claude/agents'), { recursive: true });
      mkdirSync(join(root, '.agents/skills'), { recursive: true });
      symlinkSync(join(outside, 'agents-ignore'), join(root, '.claude/agents/.gitignore'));
      symlinkSync(join(outside, 'skills-ignore'), join(root, '.agents/skills/.gitignore'));
      expect(run(root).status).toBe(0);
      expect(readFileSync(join(outside, 'agents-ignore'), 'utf8')).toBe('theirs\n');
      expect(readFileSync(join(outside, 'skills-ignore'), 'utf8')).toBe('theirs\n');
      const lines = hooksLog(root);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('.claude/agents/.gitignore');
      expect(lines[0]).toContain('.agents/skills/.gitignore');
    },
  );
});
