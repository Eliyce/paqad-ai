import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { holdsHomePath, isMachinePaqadCommand } from '@/adapters/claude/team-settings.js';
import { buildHostHookChain, buildPluginHookChain } from '@/adapters/shared/paqad-hooks.js';
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

describe('AC-18, AC-20: the committed team settings', () => {
  it('AC-35: settings hook lines never call the launcher and the plugin chain carries every paqad hook', async () => {
    const plugin = buildPluginHookChain().map((line) => `${line.nativeEvent} ${line.command}`);
    const host = buildHostHookChain('claude-code').filter(
      (line) => !line.command.includes('silent-update.mjs'),
    );
    for (const line of host) {
      const script = /\/hooks\/([^"]+)"/u.exec(line.command)![1]!;
      expect(
        plugin.some((entry) => entry.startsWith(line.nativeEvent) && entry.includes(script)),
      ).toBe(true);
    }
    const settings = JSON.parse((await render()).get('.claude/settings.json')!) as Settings;
    expect(settings).not.toHaveProperty('hooks');
    expect(JSON.stringify(settings)).not.toContain('/.paqad/hook.mjs');
    expect(settings.enabledPlugins).toEqual({ 'paqad@eliyce': true });
    expect(settings.extraKnownMarketplaces).toHaveProperty('eliyce');
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

    expect(launcherEntries(settings)).toEqual([]);
  });

  it('AC-35, AC-21: an update strips the old launcher lines and keeps the team lines', async () => {
    const team = teamSettingsWithMachineLines();
    team.hooks.PreToolUse!.push({
      matcher: 'Edit|Write|NotebookEdit',
      hooks: [
        {
          type: 'command',
          command: 'node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" agent-entry-gate.mjs',
          onFailure: 'block',
        },
      ],
    });
    team.hooks.SessionStart!.push({
      hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" x.mjs' }],
    });
    writeSettings('settings.json', team);
    git('init', '-q');
    git('add', '-f', '.claude/settings.json');
    const settings = JSON.parse((await render()).get('.claude/settings.json')!) as Settings;
    expect(launcherEntries(settings)).toEqual([]);
    expect(Object.keys(settings.hooks).sort()).toEqual(['PreToolUse', 'Stop']);
  });

  it('AC-35: with no paqad lines in the project settings the edit gate health check still passes', async () => {
    const files = await render();
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/settings.json'), files.get('.claude/settings.json')!);
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
      eliyce: { source: { source: 'git', url: 'u' }, autoUpdate: true },
    });
  });

  it('AC-23, AC-31: updates.automatic false or a pin writes autoUpdate false, and flipping back writes true', async () => {
    const eliyce = async () =>
      (JSON.parse((await render()).get('.claude/settings.json')!) as Settings)
        .extraKnownMarketplaces as Record<
        string,
        { autoUpdate: boolean; source: Record<string, string> }
      >;
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    const yaml = join(root, '.paqad/configs/paqad.yaml');
    writeFileSync(yaml, 'updates:\n  automatic: false\n');
    expect((await eliyce()).eliyce!.autoUpdate).toBe(false);
    writeFileSync(yaml, 'updates:\n  minimum_version: 1.2.3\n');
    const pinned = (await eliyce()).eliyce!;
    expect(pinned.autoUpdate).toBe(false);
    expect(pinned.source).not.toHaveProperty('ref');
    writeFileSync(yaml, 'updates:\n  automatic: true\n');
    expect((await eliyce()).eliyce!.autoUpdate).toBe(true);
  });

  it('AC-25: a personal PAQAD_AUTO_UPDATE=0 never changes the committed autoUpdate', async () => {
    const saved = process.env.PAQAD_AUTO_UPDATE;
    process.env.PAQAD_AUTO_UPDATE = '0';
    try {
      const settings = JSON.parse((await render()).get('.claude/settings.json')!) as Settings;
      expect(
        (settings.extraKnownMarketplaces as Record<string, { autoUpdate: boolean }>).eliyce!
          .autoUpdate,
      ).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.PAQAD_AUTO_UPDATE;
      else process.env.PAQAD_AUTO_UPDATE = saved;
    }
  });

  it('AC-30: rewriting the eliyce keys leaves every other key byte-identical', async () => {
    const team = {
      permissions: { allow: ['Bash(make:*)'] },
      enabledPlugins: { 'paqad@eliyce': true, 'other@x': true },
      extraKnownMarketplaces: {
        mine: { source: { source: 'github', repo: 'a/b' } },
        eliyce: {
          source: { source: 'github', repo: 'Eliyce/paqad-claude-plugin' },
          autoUpdate: true,
        },
      },
    };
    writeSettings('settings.json', team);
    git('init', '-q');
    git('add', '-f', '.claude/settings.json');
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(join(root, '.paqad/configs/paqad.yaml'), 'updates:\n  automatic: false\n');
    const settings = JSON.parse((await render()).get('.claude/settings.json')!) as Record<
      string,
      unknown
    >;
    expect(settings.permissions).toEqual(team.permissions);
    expect(settings.enabledPlugins).toEqual(team.enabledPlugins);
    const markets = settings.extraKnownMarketplaces as Record<string, unknown>;
    expect(JSON.stringify(markets.mine)).toBe(JSON.stringify(team.extraKnownMarketplaces.mine));
    expect(markets.eliyce).toEqual({ ...team.extraKnownMarketplaces.eliyce, autoUpdate: false });
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
    ]);
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

  it('removes machine paqad lines left in settings.local.json so only the plugin chain acts', async () => {
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
      isMachinePaqadCommand(
        `node "${['C:', 'Users', 'x', '.paqad-ai', 'current', 'hooks', 'x.mjs'].join('\\')}"`,
        env,
      ),
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

  it('tolerates odd settings shapes without losing team content', async () => {
    writeSettings('settings.json', {
      hooks: { PreToolUse: 'not-a-list', Stop: [null, { hooks: [{ type: 'command' }, 7] }] },
      extraKnownMarketplaces: 'weird',
      permissions: { allow: 'Bash(ls)' },
    });
    writeSettings('settings.local.json', { permissions: { allow: ['Read(*)'] }, hooks: 'nope' });
    const files = await render();
    const shared = JSON.parse(files.get('.claude/settings.json')!) as Settings;
    expect(shared.enabledPlugins).toEqual({ 'paqad@eliyce': true });
    const local = JSON.parse(files.get('.claude/settings.local.json')!) as Settings;
    expect(local.permissions).toEqual({ allow: ['Read(*)'] });
    expect(local.hooks).toEqual({ Stop: [{ hooks: [{ type: 'command' }] }] });
    expect(holdsHomePath(undefined)).toBe(false);
  });

  it('a settings.json holding a JSON array is treated as empty', async () => {
    writeSettings('settings.json', ['x']);
    const shared = JSON.parse((await render()).get('.claude/settings.json')!) as Settings;
    expect(shared.enabledPlugins).toEqual({ 'paqad@eliyce': true });
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

describe('AC-21: the team setup turned off', () => {
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
    team.hooks = {
      Stop: [
        {
          hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" x.mjs' }],
        },
        { hooks: [{ type: 'command', command: 'echo team-stop' }] },
      ],
    };
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
      localCommands.every((command) =>
        command.startsWith(
          `node "${join(home, '.paqad-ai', 'current').replace(/\\/g, '/')}/hooks/`,
        ),
      ),
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
