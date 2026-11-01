import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import {
  buildTeamHookChain,
  holdsHomePath,
  isMachinePaqadCommand,
  toLauncherCommand,
} from '@/adapters/claude/team-settings.js';
import { buildHostHookChain } from '@/adapters/shared/paqad-hooks.js';
import { HealthChecker } from '@/health/checker.js';

import { HOME_PATH_PATTERN } from './helpers';

interface Settings {
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
  [key: string]: unknown;
}

const USERS = ['', 'Users', 'x'].join('/');
const LEGACY_SH = '~/.paqad-ai/current/hooks/agent-entry-gate.sh';
const LEGACY_TILDE = 'node "~/.paqad-ai/current/hooks/agent-entry-gate.mjs"';

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-team-settings-'));
  home = mkdtempSync(join(tmpdir(), 'paqad-team-settings-home-'));
  vi.stubEnv('CLAUDE_PLUGIN_ROOT', '');
  vi.stubEnv('PAQAD_FRAMEWORK_HOME', join(home, '.paqad-ai', 'current'));
  vi.stubEnv('PAQAD_TEAM_BOOTSTRAP_ENABLED', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function writeSettings(name: string, body: unknown): void {
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', name), JSON.stringify(body, null, 2));
}

async function render(): Promise<Map<string, string>> {
  const files = await new ClaudeCodeAdapter().generateConfig({
    frameworkPath: '.paqad/framework-path.txt',
    rulesPath: 'docs/instructions/rules',
    projectRoot: root,
  });
  return new Map(files.map((file) => [file.path, file.content]));
}

function teamSettingsWithMachineLines(): Settings {
  return {
    permissions: { allow: ['Bash(pnpm test:*)'] },
    model: 'sonnet',
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/team-guard.mjs' }] },
        {
          matcher: 'Edit|Write|NotebookEdit',
          hooks: [
            {
              type: 'command',
              command: `node "${USERS}/.paqad-ai/current/hooks/agent-entry-gate.mjs"`,
            },
            { type: 'command', command: LEGACY_TILDE },
          ],
        },
      ],
      SessionStart: [{ hooks: [{ type: 'command', command: LEGACY_SH }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'echo team-stop' }] }],
    },
  };
}

function byEvent<T extends { event: string }>(entries: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const entry of entries) (out[entry.event] ??= []).push(entry);
  return out;
}

function launcherEntries(
  settings: Settings,
): Array<{ event: string; matcher?: string; hook: unknown }> {
  return Object.entries(settings.hooks).flatMap(([event, groups]) =>
    groups.flatMap((group) =>
      group.hooks
        .filter((hook) => String(hook.command).includes('/.paqad/hook.mjs'))
        .map((hook) => ({ event, matcher: group.matcher, hook })),
    ),
  );
}

describe('the committed team settings', () => {
  it('maps every hook to the launcher, changing only the command and the SessionStart timeouts', () => {
    const chain = buildHostHookChain('claude-code');
    const team = buildTeamHookChain();
    expect(team).toHaveLength(chain.length);
    team.forEach((entry, index) => {
      const original = chain[index]!;
      const { command, timeout, ...rest } = entry;
      const { command: originalCommand, timeout: originalTimeout, ...originalRest } = original;
      expect(rest).toEqual(originalRest);
      expect(timeout).toBe(entry.nativeEvent === 'SessionStart' ? 600 : originalTimeout);
      const script = /\/hooks\/([^"]+)"(.*)$/.exec(originalCommand)!;
      expect(command).toBe(`node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" ${script[1]}${script[2]}`);
    });
    expect(team.filter((entry) => entry.nativeEvent === 'SessionStart')).toHaveLength(2);
    expect(() => toLauncherCommand('bash something.sh')).toThrow(/unexpected shape/);
  });

  it('keeps team keys and non-paqad hooks, drops machine lines, writes the three keys, twice the same bytes', async () => {
    writeSettings('settings.json', teamSettingsWithMachineLines());
    git('init', '-q');
    git('add', '-f', '.claude/settings.json');

    const first = await render();
    writeFileSync(join(root, '.claude/settings.json'), first.get('.claude/settings.json')!);
    const second = await render();
    expect(second.get('.claude/settings.json')).toBe(first.get('.claude/settings.json'));
    expect(second.has('.claude/settings.local.json')).toBe(false);

    const settings = JSON.parse(first.get('.claude/settings.json')!) as Settings;
    expect(settings.permissions).toEqual({ allow: ['Bash(pnpm test:*)'] });
    expect(settings.model).toBe('sonnet');
    expect(settings.extraKnownMarketplaces).toEqual({
      eliyce: {
        source: { source: 'github', repo: 'Eliyce/paqad-claude-plugin' },
        autoUpdate: true,
      },
    });
    expect(settings.enabledPlugins).toEqual({ 'paqad@eliyce': true });
    const commands = Object.values(settings.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => String(hook.command))),
    );
    expect(commands).toContain('node scripts/team-guard.mjs');
    expect(commands).toContain('echo team-stop');
    expect(commands.filter((command) => command.includes('.paqad-ai'))).toEqual([]);
    expect(commands.filter((command) => command.includes('.sh'))).toEqual([]);

    expect(byEvent(launcherEntries(settings))).toEqual(
      byEvent(
        buildTeamHookChain().map((entry) => ({
          event: entry.nativeEvent,
          matcher: entry.matcher,
          hook: {
            type: 'command',
            command: entry.command,
            ...(entry.onFailure ? { onFailure: entry.onFailure } : {}),
            ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {}),
          },
        })),
      ),
    );
  });

  it('keeps the three edit gates fail-closed, which the health check confirms', async () => {
    const files = await render();
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/settings.json'), files.get('.claude/settings.json')!);
    const settings = JSON.parse(files.get('.claude/settings.json')!) as Settings;
    const gates = settings.hooks
      .PreToolUse!.flatMap((group) => group.hooks)
      .filter((hook) =>
        /agent-entry-gate|decision-pause-gate|capability-gate/.test(String(hook.command)),
      );
    expect(gates).toHaveLength(3);
    expect(gates.every((hook) => hook.onFailure === 'block')).toBe(true);
    const report = await new HealthChecker().run(root);
    const gateCheck = report.checks.find((check) => check.name === 'Edit gates fail closed');
    expect(gateCheck?.status).toBe('pass');
  });

  it('respects a team that set the plugin off or its own marketplace entry', async () => {
    writeSettings('settings.json', {
      enabledPlugins: { 'paqad@eliyce': false, 'other@x': true },
      extraKnownMarketplaces: { eliyce: { source: { source: 'git', url: 'u' } } },
    });
    git('init', '-q');
    git('add', '-f', '.claude/settings.json');
    const settings = JSON.parse((await render()).get('.claude/settings.json')!) as Settings;
    expect(settings.enabledPlugins).toEqual({ 'paqad@eliyce': false, 'other@x': true });
    expect(settings.extraKnownMarketplaces).toEqual({
      eliyce: { source: { source: 'git', url: 'u' } },
    });
  });

  it('moves personal entries out of an untracked settings.json into settings.local.json', async () => {
    writeSettings('settings.json', {
      ...teamSettingsWithMachineLines(),
      enabledPlugins: { 'mine@x': true },
      extraKnownMarketplaces: { mine: { source: { source: 'directory', path: `${USERS}/m` } } },
      statusLine: { type: 'command', command: `${USERS}/bin/status` },
    });
    writeSettings('settings.local.json', { permissions: { allow: ['Read(*)'] }, model: 'opus' });

    const files = await render();
    const shared = JSON.parse(files.get('.claude/settings.json')!) as Settings;
    const local = JSON.parse(files.get('.claude/settings.local.json')!) as Settings;

    expect(Object.keys(shared).sort()).toEqual([
      'attribution',
      'enabledPlugins',
      'extraKnownMarketplaces',
      'hooks',
    ]);
    expect(launcherEntries(shared)).toHaveLength(Object.values(shared.hooks).flat().length);
    expect(holdsHomePath(shared)).toBe(false);

    expect(local.permissions).toEqual({ allow: ['Read(*)', 'Bash(pnpm test:*)'] });
    expect(local.model).toBe('opus');
    expect(local.statusLine).toEqual({ type: 'command', command: `${USERS}/bin/status` });
    expect(local.enabledPlugins).toEqual({ 'mine@x': true });
    expect(Object.keys(local.extraKnownMarketplaces as object)).toEqual(['mine']);
    const localCommands = Object.values(local.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => String(hook.command))),
    );
    expect(localCommands.sort()).toEqual(['echo team-stop', 'node scripts/team-guard.mjs']);

    writeFileSync(join(root, '.claude/settings.json'), files.get('.claude/settings.json')!);
    writeFileSync(
      join(root, '.claude/settings.local.json'),
      files.get('.claude/settings.local.json')!,
    );
    const again = await render();
    expect(again.get('.claude/settings.json')).toBe(files.get('.claude/settings.json'));
    expect(again.has('.claude/settings.local.json')).toBe(false);
  });

  it('removes machine paqad lines left in settings.local.json so only the launcher chain acts', async () => {
    writeSettings('settings.local.json', {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit',
            hooks: [
              {
                type: 'command',
                command: `node "${home}/.paqad-ai/current/hooks/agent-entry-gate.mjs"`,
              },
            ],
          },
        ],
      },
    });
    const local = JSON.parse((await render()).get('.claude/settings.local.json')!) as Settings;
    expect(local.hooks).toEqual({});
  });

  it('recognises machine paqad lines and home paths', () => {
    const env = { PAQAD_FRAMEWORK_HOME: join(home, 'dev', 'runtime') } as NodeJS.ProcessEnv;
    expect(isMachinePaqadCommand(`node "${join(home, 'dev', 'runtime')}/hooks/x.mjs"`, env)).toBe(
      true,
    );
    expect(
      isMachinePaqadCommand('node "C:\\Users\\x\\.paqad-ai\\current\\hooks\\x.mjs"', env),
    ).toBe(true);
    expect(isMachinePaqadCommand(LEGACY_SH, env)).toBe(true);
    expect(isMachinePaqadCommand('node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" x.mjs', env)).toBe(
      false,
    );
    expect(isMachinePaqadCommand('node scripts/x.mjs', env)).toBe(false);
    expect(isMachinePaqadCommand(undefined, env)).toBe(false);
    expect(holdsHomePath({ a: `${['', 'home', 'someone'].join('/')}/x` })).toBe(true);
    expect(holdsHomePath({ a: ['C:', 'Users', 'someone', 'x'].join('\\') })).toBe(true);
    expect(holdsHomePath({ a: `${homedir()}/x` })).toBe(true);
    expect(holdsHomePath({ a: 'node scripts/x.mjs' })).toBe(false);
  });

  it('a malformed settings.json is replaced with team content', async () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/settings.json'), '{ nope');
    const shared = JSON.parse((await render()).get('.claude/settings.json')!) as Settings;
    expect(shared.enabledPlugins).toEqual({ 'paqad@eliyce': true });
  });

  it('the generated team files hold no home path', async () => {
    const files = await render();
    for (const path of ['.claude/settings.json', '.claude/.gitignore']) {
      const content = files.get(path)!;
      expect(content).not.toMatch(HOME_PATH_PATTERN);
      expect(content).not.toContain(home);
      expect(content).not.toContain(homedir());
    }
  });
});

describe('the team setup turned off', () => {
  beforeEach(() => {
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
    writeFileSync(join(root, '.paqad', 'configs', '.config.app'), 'team_bootstrap_enabled=false\n');
  });

  it('removes the launcher lines and the plugin keys and puts the npm chain in settings.local.json', async () => {
    vi.stubEnv('PAQAD_TEAM_BOOTSTRAP_ENABLED', 'true');
    const enabled = await render();
    vi.stubEnv('PAQAD_TEAM_BOOTSTRAP_ENABLED', '');
    const team = JSON.parse(enabled.get('.claude/settings.json')!) as Settings;
    team.permissions = { allow: ['Bash(ls)'] };
    team.enabledPlugins = { ...(team.enabledPlugins as object), 'other@x': true };
    team.hooks.Stop!.push({ hooks: [{ type: 'command', command: 'echo team-stop' }] });
    writeSettings('settings.json', team);

    const files = await render();
    const shared = JSON.parse(files.get('.claude/settings.json')!) as Settings;
    expect(shared.permissions).toEqual({ allow: ['Bash(ls)'] });
    expect(shared.enabledPlugins).toEqual({ 'other@x': true });
    expect(shared).not.toHaveProperty('extraKnownMarketplaces');
    expect(launcherEntries(shared)).toEqual([]);
    expect(shared.hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'echo team-stop' }] },
    ]);

    const local = JSON.parse(files.get('.claude/settings.local.json')!) as Settings;
    const localCommands = Object.values(local.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => String(hook.command))),
    );
    expect(localCommands).toHaveLength(buildHostHookChain('claude-code').length);
    expect(
      localCommands.every((command) => command.includes(`${home}/.paqad-ai/current/hooks/`)),
    ).toBe(true);

    writeFileSync(
      join(root, '.claude/settings.local.json'),
      files.get('.claude/settings.local.json')!,
    );
    expect((await render()).has('.claude/settings.local.json')).toBe(false);
  });

  it('writes no local settings under the plugin', async () => {
    vi.stubEnv('CLAUDE_PLUGIN_ROOT', '/plugin');
    expect((await render()).has('.claude/settings.local.json')).toBe(false);
  });
});
