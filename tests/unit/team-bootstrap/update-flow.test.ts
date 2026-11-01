import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHARED_SETTINGS_NOTE } from '@/adapters/claude/team-setup.js';
import { OnboardingOrchestrator } from '@/onboarding/index.js';
import { FrameworkUpdater } from '@/update/index.js';

import { HOME_PATH_PATTERN } from './helpers';

const REAL_HOME = homedir();
const USERS = ['', 'Users', 'x'].join('/');
const CLAUDE_CANDIDATES = async () => [
  { path: 'CLAUDE.md', content: '# entry\n', autoUpdate: true },
];

let root: string;
let home: string;

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function commitAll(message: string): void {
  git('add', '-A');
  git(
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=t',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    message,
  );
}

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, unknown>;
}

function seedProfile(): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-version.txt'), 'version=0.0.0\n');
  writeFileSync(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      routing: { domain: 'coding', stack: 'laravel', capabilities: [] },
      commands: {
        install: 'i',
        dev: 'd',
        test: 't',
        test_single: 'ts',
        lint: 'l',
        format: 'f',
        migrate: 'm',
        build: 'b',
      },
      compliance_packs: [],
      mcp: { servers: [] },
      custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] },
    }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-team-update-'));
  home = mkdtempSync(join(tmpdir(), 'paqad-team-update-home-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('CLAUDE_PLUGIN_ROOT', '');
  vi.stubEnv('PAQAD_FRAMEWORK_HOME', join(home, '.paqad-ai', 'current'));
  vi.stubEnv('PAQAD_TEAM_BOOTSTRAP_ENABLED', '');
  seedProfile();
  git('init', '-q');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('AC-20, AC-21, AC-22, AC-23: update shares the Claude settings with the team', () => {
  it('moves personal entries of an untracked settings.json to settings.local.json and says so in one line', async () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude/settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(make:*)'] },
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: `${USERS}/bin/my-guard` }],
            },
            {
              matcher: 'Edit|Write|NotebookEdit',
              hooks: [
                {
                  type: 'command',
                  command: `node "${USERS}/.paqad-ai/current/hooks/agent-entry-gate.mjs"`,
                },
              ],
            },
          ],
        },
      }),
    );

    const report = await new FrameworkUpdater({ generateCandidates: CLAUDE_CANDIDATES }).run(root);

    const shared = readJson('.claude/settings.json');
    expect(Object.keys(shared).sort()).toEqual([
      'attribution',
      'enabledPlugins',
      'extraKnownMarketplaces',
      'hooks',
    ]);
    expect(JSON.stringify(shared)).not.toContain(USERS);
    const local = readJson('.claude/settings.local.json');
    expect(local.permissions).toEqual({ allow: ['Bash(make:*)'] });
    expect(JSON.stringify(local)).toContain(`${USERS}/bin/my-guard`);
    expect(JSON.stringify(local)).not.toContain('.paqad-ai');
    expect(report.team_setup_notes).toContain(SHARED_SETTINGS_NOTE);
    expect(SHARED_SETTINGS_NOTE.split('\n')).toHaveLength(1);
    expect(report.team_setup_notes.join('\n')).toContain('.claude/settings.json');
    expect(report.team_setup_notes.join('\n')).toContain('.paqad/hook.mjs');
    expect(report.team_setup_notes.join('\n')).not.toContain('.claude/agents/paqad-');
    expect(git('check-ignore', '-v', '.claude/settings.local.json')).toContain(
      '.claude/.gitignore',
    );

    commitAll('team setup');
    const after = await new FrameworkUpdater({ generateCandidates: CLAUDE_CANDIDATES }).run(root);
    expect(after.team_setup_notes).toEqual([]);
  });

  it('a second update on the same version gives no diff in tracked files', async () => {
    await new FrameworkUpdater({ generateCandidates: CLAUDE_CANDIDATES }).run(root);
    commitAll('first');
    await new FrameworkUpdater({ generateCandidates: CLAUDE_CANDIDATES }).run(root);
    expect(git('status', '--porcelain')).toBe('');
  });

  it('writes the team settings while the plugin is installed, skipping only the rest', async () => {
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'paqad@eliyce': { enabled: true } } }),
    );
    const report = await new FrameworkUpdater({
      generateCandidates: async () => [
        ...(await CLAUDE_CANDIDATES()),
        { path: '.claude/settings.hooks.json', content: '[]\n', autoUpdate: true },
      ],
    }).run(root);
    expect(readJson('.claude/settings.json').enabledPlugins).toEqual({ 'paqad@eliyce': true });
    expect(existsSync(join(root, '.claude/agents'))).toBe(false);
    expect(existsSync(join(root, '.claude/settings.hooks.json'))).toBe(false);
    expect(existsSync(join(home, '.claude/agents'))).toBe(false);
    expect(report.regenerated).toContain('.claude/settings.json');
  });

  it('the opt-out after an enabled update removes the team setup and keeps team content', async () => {
    await new FrameworkUpdater({ generateCandidates: CLAUDE_CANDIDATES }).run(root);
    const settings = readJson('.claude/settings.json');
    settings.permissions = { allow: ['Bash(ls)'] };
    writeFileSync(join(root, '.claude/settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
    mkdirSync(join(root, '.claude/agents'), { recursive: true });
    writeFileSync(join(root, '.claude/agents/paqad-review.md'), 'team note\n');
    commitAll('team setup');

    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(join(root, '.paqad/configs/.config.app'), 'team_bootstrap_enabled=false\n');
    await new FrameworkUpdater({ generateCandidates: CLAUDE_CANDIDATES }).run(root);

    const shared = readJson('.claude/settings.json');
    expect(shared.permissions).toEqual({ allow: ['Bash(ls)'] });
    expect(shared).not.toHaveProperty('enabledPlugins');
    expect(shared).not.toHaveProperty('extraKnownMarketplaces');
    expect(JSON.stringify(shared)).not.toContain('/.paqad/hook.mjs');
    expect(existsSync(join(root, '.paqad/hook.mjs'))).toBe(false);
    expect(readdirSync(join(root, '.claude/agents'))).toEqual(['paqad-review.md']);
    const localHooks = readJson('.claude/settings.local.json').hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    const localCommands = Object.values(localHooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
    );
    const npmHooks = `${join(home, '.paqad-ai', 'current').replace(/\\/g, '/')}/hooks/`;
    expect(localCommands).toContain(`node "${npmHooks}agent-entry-gate.mjs"`);
    expect(git('check-ignore', '-v', '.claude/settings.local.json')).toContain(
      '.claude/.gitignore',
    );
  });
});

describe('AC-24: no home path reaches a tracked file', () => {
  function tracked(): string[] {
    const agents = existsSync(join(root, '.claude/agents'))
      ? readdirSync(join(root, '.claude/agents')).map((name) => `.claude/agents/${name}`)
      : [];
    return ['.claude/settings.json', '.claude/.gitignore', '.paqad/hook.mjs', ...agents];
  }

  function assertClean(): void {
    for (const rel of tracked()) {
      const content = readFileSync(join(root, rel), 'utf8');
      expect(content, rel).not.toContain(home);
      expect(content, rel).not.toContain(REAL_HOME);
      expect(content, rel).not.toMatch(HOME_PATH_PATTERN);
    }
  }

  it('onboard and update with a temp HOME write portable team files', async () => {
    rmSync(join(root, '.paqad'), { recursive: true, force: true });
    await new OnboardingOrchestrator().run({
      projectRoot: root,
      selections: { domain: 'coding', stack: 'laravel', providers: ['claude-code'] },
    });
    expect(tracked()).toHaveLength(3);
    assertClean();
    await new FrameworkUpdater().run(root);
    expect(tracked()).toHaveLength(3);
    assertClean();
  }, 120_000);
});
