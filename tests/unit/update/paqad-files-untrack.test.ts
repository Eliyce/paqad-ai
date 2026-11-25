import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { refreshPaqadProjectFiles } from '@/stage-isolation/project-refresh.js';
import { teamSetupNotes, syncTeamSetup } from '@/adapters/claude/team-setup.js';
import { type GitRunner, untrackLine, untrackPaqadFiles } from '@/update/paqad-files-untrack.js';
import { FrameworkUpdater } from '@/update/updater.js';

const saved: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'CI',
  'GITHUB_ACTIONS',
];
const roots: string[] = [];
let root: string;

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  const home = mkdtempSync(join(tmpdir(), 'paqad-untrack-home-'));
  roots.push(home);
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n\temail = t@t\n\tname = t\n[commit]\n\tgpgsign = false\n',
  );
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.GIT_CONFIG_GLOBAL = join(home, '.gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  root = mkdtempSync(join(tmpdir(), 'paqad-untrack-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({
      adapter: 'claude-code',
      providers: ['claude-code', 'codex-cli'],
      generated_artifacts: [],
    }),
  );
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const commit = (message: string) => git('commit', '--no-verify', '-qm', message);

function committedPaqadProject(): void {
  git('init', '-q');
  refreshPaqadProjectFiles(root);
  rmSync(join(root, '.claude/agents/.gitignore'));
  rmSync(join(root, '.agents/skills/.gitignore'));
  git('add', '-A');
  commit('older paqad setup');
  refreshPaqadProjectFiles(root);
}

describe('the one-time untrack of paqad files (FR-18 to FR-22)', () => {
  it('AC-17: untracks each committed paqad agent, keeps it on disk, and prints the line once', () => {
    committedPaqadProject();
    const result = untrackPaqadFiles(root);
    expect(result.untracked.filter((path) => path.startsWith('.claude/agents/'))).toHaveLength(13);
    expect(result.untracked).toContain('.agents/skills/paqad-planning-recipe');
    expect(existsSync(join(root, '.claude/agents/paqad-planning.md'))).toBe(true);
    expect(git('ls-files', '--', '.claude/agents', '.agents/skills')).not.toMatch(/paqad-/u);
    expect(result.notes).toEqual([untrackLine()]);
  });

  it('AC-19, AC-3, AC-18: repeats the line until the removal is committed, then says nothing', () => {
    committedPaqadProject();
    untrackPaqadFiles(root);
    const again = untrackPaqadFiles(root);
    expect(again.untracked).toEqual([]);
    expect(again.notes).toEqual([untrackLine()]);
    git('add', '.claude/agents/.gitignore', '.agents/skills/.gitignore');
    commit('stop tracking paqad files');
    const status = git('status', '--porcelain');
    const after = untrackPaqadFiles(root);
    expect(after).toEqual({ untracked: [], notes: [] });
    expect(git('status', '--porcelain')).toBe(status);
  });

  it('AC-5: a tracked paqad-mine.md with no marker is neither overwritten nor untracked, and is named', () => {
    git('init', '-q');
    mkdirSync(join(root, '.claude/agents'), { recursive: true });
    writeFileSync(join(root, '.claude/agents/paqad-mine.md'), 'our agent\n');
    git('add', '-A');
    commit('team agent');
    const report = syncTeamSetup(root, {});
    expect(untrackPaqadFiles(root).untracked).toEqual([]);
    expect(readFileSync(join(root, '.claude/agents/paqad-mine.md'), 'utf8')).toBe('our agent\n');
    expect(git('ls-files', '--', '.claude/agents/paqad-mine.md').trim()).toBe(
      '.claude/agents/paqad-mine.md',
    );
    expect(teamSetupNotes(root, report).join('\n')).toContain('.claude/agents/paqad-mine.md');
    expect(git('check-ignore', '--no-index', '.claude/agents/paqad-mine.md').trim()).toBe(
      '.claude/agents/paqad-mine.md',
    );
  });

  it('AC-48: an unrelated staged file stays staged and nothing is committed', () => {
    committedPaqadProject();
    writeFileSync(join(root, 'notes.txt'), 'mine\n');
    git('add', 'notes.txt');
    const head = git('rev-parse', 'HEAD');
    untrackPaqadFiles(root);
    expect(git('diff', '--cached', '--name-only')).toContain('notes.txt');
    expect(git('rev-parse', 'HEAD')).toBe(head);
  });

  it('AC-48: under CI the untrack does not run', () => {
    committedPaqadProject();
    expect(untrackPaqadFiles(root, { env: { CI: 'true' } })).toEqual({ untracked: [], notes: [] });
    expect(git('ls-files', '--', '.claude/agents')).toContain('paqad-planning.md');
  });

  it('AC-16: a merge in progress or an index lock leaves git as it is (integration)', () => {
    committedPaqadProject();
    writeFileSync(join(root, '.git/index.lock'), '');
    expect(untrackPaqadFiles(root)).toEqual({ untracked: [], notes: [] });
    rmSync(join(root, '.git/index.lock'));
    expect(git('ls-files', '--', '.claude/agents')).toContain('paqad-planning.md');
  });

  it('AC-19: the silent update never untracks or prints the line', async () => {
    committedPaqadProject();
    const report = await new FrameworkUpdater({
      silent: true,
      generateCandidates: async () => [{ path: 'CLAUDE.md', content: 'x', autoUpdate: true }],
    }).run(root);
    expect(report.team_setup_notes ?? []).not.toContain(untrackLine());
    expect(git('ls-files', '--', '.claude/agents')).toContain('paqad-planning.md');
  });
});

describe('the untrack with an injected git runner (AC-16, AC-47)', () => {
  function fakeGit(overrides: Partial<Record<string, { status: number; stdout: string } | null>>) {
    const calls: string[][] = [];
    const runner: GitRunner = (args) => {
      calls.push([...args]);
      const key = args.slice(0, 2).join(' ');
      if (key in overrides) return overrides[key] ?? null;
      if (key === 'rev-parse --is-inside-work-tree') return { status: 0, stdout: 'true\n' };
      if (key === 'rev-parse --git-dir') return { status: 0, stdout: join(root, 'gitdir') };
      if (args[0] === 'ls-files') {
        return {
          status: 0,
          stdout: '.claude/agents/paqad-planning.md\0.claude/agents/my-agent.md\0src/a.ts\0',
        };
      }
      if (args[0] === 'rm') return { status: 0, stdout: '' };
      return { status: 0, stdout: '' };
    };
    return { calls, runner };
  }

  beforeEach(() => {
    refreshPaqadProjectFiles(root);
    mkdirSync(join(root, 'gitdir'), { recursive: true });
  });

  it('AC-47: passes an argument array, -- before the paths, and only paqad-owned paths', () => {
    const { calls, runner } = fakeGit({});
    expect(untrackPaqadFiles(root, { git: runner, env: {} }).untracked).toEqual([
      '.claude/agents/paqad-planning.md',
    ]);
    const rm = calls.find((args) => args[0] === 'rm')!;
    expect(Array.isArray(rm)).toBe(true);
    expect(rm.slice(rm.indexOf('--') + 1)).toEqual(['.claude/agents/paqad-planning.md']);
  });

  it.each([
    ['not a git repo', { 'rev-parse --is-inside-work-tree': { status: 128, stdout: '' } }, null],
    ['git missing from PATH', { 'rev-parse --is-inside-work-tree': null }, null],
    ['a merge in progress', {}, 'MERGE_HEAD'],
    ['a rebase in progress', {}, 'rebase-merge'],
    ['an index lock', {}, 'index.lock'],
  ] as const)('AC-16: %s leaves git unchanged and prints nothing', (_name, overrides, marker) => {
    if (marker !== null) writeFileSync(join(root, 'gitdir', marker), '');
    const { calls, runner } = fakeGit(overrides);
    expect(untrackPaqadFiles(root, { git: runner, env: {} })).toEqual({ untracked: [], notes: [] });
    expect(calls.some((args) => args[0] === 'rm')).toBe(false);
  });
});
