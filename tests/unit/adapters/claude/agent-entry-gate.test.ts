import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ClaudeCodeAdapter,
  isRunningUnderPlugin,
  isUnderPluginPath,
} from '@/adapters/claude/claude-adapter.js';

describe('ClaudeCodeAdapter agent-entry gate', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-claude-gate-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('emits .claude/settings.json with the PreToolUse and SessionStart gate hooks', async () => {
    const adapter = new ClaudeCodeAdapter();
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot,
    });
    const settings = files.find((file) => file.path === '.claude/settings.json');
    expect(settings).toBeDefined();
    const parsed = JSON.parse(settings!.content) as {
      hooks: {
        PreToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }>;
        UserPromptSubmit: Array<{ hooks: Array<{ command: string }> }>;
        SessionStart: Array<{ hooks: Array<{ command: string }> }>;
        Stop: Array<{ hooks: Array<{ command: string }> }>;
      };
    };
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('Edit|Write|NotebookEdit');
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toContain('agent-entry-gate.mjs');
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toContain(
      'agent-entry-prompt-gate.mjs',
    );
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain(
      'agent-entry-session-start.mjs',
    );
    const sessionStartCommands = parsed.hooks.SessionStart.flatMap((entry) =>
      entry.hooks.map((hook) => hook.command),
    );
    expect(sessionStartCommands.some((command) => command.includes('silent-update.mjs'))).toBe(
      true,
    );
    expect(sessionStartCommands.some((command) => command.includes('silent-update.sh'))).toBe(
      false,
    );
    const preToolCommands = parsed.hooks.PreToolUse.flatMap((entry) =>
      entry.hooks.map((hook) => hook.command),
    );
    expect(preToolCommands.some((command) => command.includes('decision-pause-gate.mjs'))).toBe(
      true,
    );
    expect(preToolCommands.some((command) => command.includes('stage-writer.mjs'))).toBe(true);
    expect(preToolCommands.some((command) => isCapabilityGate(command, 'pre-mutation'))).toBe(true);
    expect(preToolCommands.some((command) => command.includes('rule-script-enforce.mjs'))).toBe(
      false,
    );
    const stopCommands = parsed.hooks.Stop.flatMap((entry) =>
      entry.hooks.map((hook) => hook.command),
    );
    expect(stopCommands[0]).toContain('stage-marker-parse.mjs');
    expect(stopCommands.some((command) => command.includes('verification-completion.mjs'))).toBe(
      true,
    );
    expect(stopCommands.some((command) => isCapabilityGate(command, 'completion'))).toBe(true);
    expect(stopCommands.some((command) => command.includes('rule-script-enforce.mjs'))).toBe(false);
  });

  it('preserves existing settings.json keys and existing hook entries when merging', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude/settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(ls:*)'] },
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: '/usr/local/bin/my-existing-hook' }],
            },
          ],
        },
      }),
    );

    const adapter = new ClaudeCodeAdapter();
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot,
    });
    const settings = files.find((file) => file.path === '.claude/settings.json');
    const parsed = JSON.parse(settings!.content) as {
      permissions: { allow: string[] };
      hooks: {
        PreToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }>;
        UserPromptSubmit: Array<{ hooks: Array<{ command: string }> }>;
        SessionStart: Array<{ hooks: Array<{ command: string }> }>;
      };
    };

    expect(parsed.permissions.allow).toEqual(['Bash(ls:*)']);
    expect(parsed.hooks.PreToolUse).toHaveLength(5);
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe('/usr/local/bin/my-existing-hook');
    expect(parsed.hooks.PreToolUse[1].hooks[0].command).toContain('agent-entry-gate.mjs');
    expect(parsed.hooks.PreToolUse[2].hooks[0].command).toContain('stage-writer.mjs');
    expect(parsed.hooks.PreToolUse[3].hooks[0].command).toContain('decision-pause-gate.mjs');
    expect(isCapabilityGate(parsed.hooks.PreToolUse[4].hooks[0].command, 'pre-mutation')).toBe(
      true,
    );
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(2);
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toContain(
      'agent-entry-prompt-gate.mjs',
    );
    expect(parsed.hooks.UserPromptSubmit[1].hooks[0].command).toContain('ticket-intake-prompt.mjs');
    expect(parsed.hooks.SessionStart).toHaveLength(2);
  });

  it('prunes the retired silent-update.sh SessionStart entry on re-onboard', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude/settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: 'command', command: '~/.paqad-ai/current/hooks/silent-update.sh' }],
            },
          ],
        },
      }),
    );

    const adapter = new ClaudeCodeAdapter();
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot,
    });
    const settings = files.find((file) => file.path === '.claude/settings.json');
    const commands = (
      JSON.parse(settings!.content) as {
        hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
      }
    ).hooks.SessionStart.flatMap((entry) => entry.hooks.map((hook) => hook.command));

    expect(commands.filter((command) => command.includes('silent-update.sh'))).toHaveLength(0);
    expect(commands.filter((command) => command.includes('silent-update.mjs'))).toHaveLength(1);
  });

  it('tolerates a malformed SessionStart matcher with no hooks array', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude/settings.json'),
      JSON.stringify({ hooks: { SessionStart: [{ matcher: 'broken' }] } }),
    );

    const adapter = new ClaudeCodeAdapter();
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot,
    });
    const parsed = JSON.parse(
      files.find((file) => file.path === '.claude/settings.json')!.content,
    ) as { hooks: { SessionStart: Array<{ hooks?: Array<{ command: string }> }> } };

    expect(parsed.hooks.SessionStart).toHaveLength(2);
    const commands = parsed.hooks.SessionStart.flatMap((entry) =>
      (entry.hooks ?? []).map((hook) => hook.command),
    );
    expect(commands.some((command) => command.includes('agent-entry-session-start.mjs'))).toBe(
      true,
    );
    expect(commands.some((command) => command.includes('silent-update.mjs'))).toBe(true);
  });

  it('is idempotent — re-running does not duplicate the gate entries', async () => {
    const adapter = new ClaudeCodeAdapter();
    const first = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot,
    });
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude/settings.json'),
      first.find((file) => file.path === '.claude/settings.json')!.content,
    );

    const second = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot,
    });
    const parsed = JSON.parse(
      second.find((file) => file.path === '.claude/settings.json')!.content,
    ) as {
      hooks: {
        PreToolUse: unknown[];
        UserPromptSubmit: unknown[];
        SessionStart: unknown[];
        Stop: unknown[];
      };
    };
    expect(parsed.hooks.PreToolUse).toHaveLength(4);
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(2);
    expect(parsed.hooks.SessionStart).toHaveLength(2);
    expect(parsed.hooks.Stop).toHaveLength(3);
  });

  it('prunes the retired rule-script-enforce hook on re-onboard (no double-fire, F3)', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude/settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Edit|Write|NotebookEdit',
              hooks: [
                {
                  type: 'command',
                  command: 'node "/Users/x/.paqad-ai/current/hooks/rule-script-enforce.mjs"',
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'node "/Users/x/.paqad-ai/current/hooks/rule-script-enforce.mjs"',
                },
              ],
            },
          ],
        },
      }),
    );

    const adapter = new ClaudeCodeAdapter();
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot,
    });
    const parsed = JSON.parse(
      files.find((file) => file.path === '.claude/settings.json')!.content,
    ) as {
      hooks: {
        PreToolUse: Array<{ hooks: Array<{ command: string }> }>;
        Stop: Array<{ hooks: Array<{ command: string }> }>;
      };
    };
    const allCommands = [...parsed.hooks.PreToolUse, ...parsed.hooks.Stop].flatMap((entry) =>
      entry.hooks.map((hook) => hook.command),
    );
    expect(allCommands.filter((command) => command.includes('rule-script-enforce.mjs'))).toEqual(
      [],
    );
    expect(allCommands.filter((command) => isCapabilityGate(command, 'pre-mutation'))).toHaveLength(
      1,
    );
    expect(allCommands.filter((command) => isCapabilityGate(command, 'completion'))).toHaveLength(
      1,
    );
  });

  describe('skip-when-plugin', () => {
    const prev = process.env.CLAUDE_PLUGIN_ROOT;
    afterEach(() => {
      if (prev === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
      else process.env.CLAUDE_PLUGIN_ROOT = prev;
    });

    it('writes no paqad hook chain when onboarding under the plugin', async () => {
      process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin/root';
      const adapter = new ClaudeCodeAdapter();
      const files = await adapter.generateConfig({
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/instructions/rules',
        projectRoot,
      });
      const settings = files.find((file) => file.path === '.claude/settings.json');
      expect(settings).toBeDefined();
      const parsed = JSON.parse(settings!.content) as {
        hooks?: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      const commands = Object.values(parsed.hooks ?? {})
        .flat()
        .flatMap((entry) => entry.hooks.map((hook) => hook.command));
      expect(commands.some((command) => command.includes('paqad'))).toBe(false);
      expect(commands.some((command) => command.includes('agent-entry-gate.mjs'))).toBe(false);
    });

    it('writes the full paqad hook chain when onboarding from npm (no CLAUDE_PLUGIN_ROOT)', async () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      const adapter = new ClaudeCodeAdapter();
      const files = await adapter.generateConfig({
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/instructions/rules',
        projectRoot,
      });
      const settings = files.find((file) => file.path === '.claude/settings.json');
      const parsed = JSON.parse(settings!.content) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      const commands = Object.values(parsed.hooks)
        .flat()
        .flatMap((entry) => entry.hooks.map((hook) => hook.command));
      expect(commands.some((command) => command.includes('agent-entry-gate.mjs'))).toBe(true);
    });

    async function renderSettings(): Promise<Record<string, unknown>> {
      const files = await new ClaudeCodeAdapter().generateConfig({
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/instructions/rules',
        projectRoot,
      });
      const settings = files.find((file) => file.path === '.claude/settings.json');
      return JSON.parse(settings!.content) as Record<string, unknown>;
    }

    it('writes no paqad hook chain when the CLI entry sits in a plugin cache and CLAUDE_PLUGIN_ROOT is unset', async () => {
      delete process.env.CLAUDE_PLUGIN_ROOT;
      const npmSettings = await renderSettings();
      const priorEntry = process.argv[1];
      process.argv[1] = '/home/u/.claude/plugins/cache/eliyce/paqad/1.2.3/dist/cli/index.js';
      let pluginSettings: Record<string, unknown>;
      try {
        pluginSettings = await renderSettings();
      } finally {
        process.argv[1] = priorEntry;
      }
      const hooks = pluginSettings.hooks as
        Record<string, Array<{ hooks: Array<{ command: string }> }>> | undefined;
      const commands = Object.values(hooks ?? {})
        .flat()
        .flatMap((entry) => entry.hooks.map((hook) => hook.command));
      expect(commands.some((command) => command.includes('paqad'))).toBe(false);
      const withoutHooks = (settings: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'hooks'));
      expect(withoutHooks(pluginSettings)).toEqual(withoutHooks(npmSettings));
    });
  });

  describe('plugin run detection', () => {
    it('reads a runtime root or CLI entry under a plugin cache or data folder as the plugin', () => {
      expect(
        isRunningUnderPlugin(
          {},
          { runtimeRoot: '/h/.claude/plugins/cache/eliyce/paqad/1.0.0/runtime' },
        ),
      ).toBe(true);
      expect(
        isRunningUnderPlugin(
          {},
          { runtimeRoot: '/h/.claude/plugins/data/paqad-eliyce/runtime/runtime' },
        ),
      ).toBe(true);
      expect(
        isRunningUnderPlugin(
          {},
          { cliEntry: 'C:\\Users\\u\\.claude\\plugins\\cache\\paqad\\dist\\cli\\index.js' },
        ),
      ).toBe(true);
      expect(isRunningUnderPlugin({ CLAUDE_PLUGIN_ROOT: '/p' }, {})).toBe(true);
    });

    it('keeps npm onboarding when there is no plugin signal', () => {
      expect(
        isRunningUnderPlugin(
          {},
          {
            runtimeRoot: '/usr/lib/node_modules/paqad-ai/runtime',
            cliEntry: '/usr/lib/node_modules/paqad-ai/dist/cli/index.js',
          },
        ),
      ).toBe(false);
      expect(isUnderPluginPath('/home/u/code/plugins/paqad-ai/runtime')).toBe(false);
      expect(isUnderPluginPath(undefined)).toBe(false);
    });
  });
});

function isCapabilityGate(command: string, seam: 'pre-mutation' | 'completion'): boolean {
  return command.includes('capability-gate.mjs') && command.endsWith(` ${seam}`);
}
