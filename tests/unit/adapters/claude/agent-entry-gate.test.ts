import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';

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
    // The background forced-self-update hook (decision D-2) must be wired into
    // SessionStart, otherwise the installed CLI never auto-updates.
    const sessionStartCommands = parsed.hooks.SessionStart.flatMap((entry) =>
      entry.hooks.map((hook) => hook.command),
    );
    expect(sessionStartCommands.some((command) => command.includes('silent-update.mjs'))).toBe(
      true,
    );
    // The retired .sh command must never be wired in.
    expect(sessionStartCommands.some((command) => command.includes('silent-update.sh'))).toBe(
      false,
    );
    // Issue #117 (C-5) — the decision-pause gate and the verification completion
    // hook are generated from the single hook-spec definition.
    const preToolCommands = parsed.hooks.PreToolUse.flatMap((entry) =>
      entry.hooks.map((hook) => hook.command),
    );
    expect(preToolCommands.some((command) => command.includes('decision-pause-gate.mjs'))).toBe(
      true,
    );
    // RCA fix A — the stage-evidence live writer runs on PreToolUse (Claude only),
    // ordered before the gates so a stage row exists when they read the change.
    expect(preToolCommands.some((command) => command.includes('stage-writer.mjs'))).toBe(true);
    // Buildout F3 — the capability-kernel seam runs on both PreToolUse
    // (pre-mutation) and Stop (completion), replacing rule-script-enforce.mjs. The
    // seam is the hook's argv, so it trails the quoted path: `node "…" pre-mutation`.
    expect(preToolCommands.some((command) => isCapabilityGate(command, 'pre-mutation'))).toBe(true);
    // The retired single-purpose hook is never wired in.
    expect(preToolCommands.some((command) => command.includes('rule-script-enforce.mjs'))).toBe(
      false,
    );
    const stopCommands = parsed.hooks.Stop.flatMap((entry) =>
      entry.hooks.map((hook) => hook.command),
    );
    // The stage-marker parser runs first (records markers before the backstop folds).
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
    // existing hook + agent-entry gate + stage-writer (RCA fix A) + decision-pause
    // gate (#117 C-5) + capability-kernel seam (buildout F3).
    expect(parsed.hooks.PreToolUse).toHaveLength(5);
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe('/usr/local/bin/my-existing-hook');
    expect(parsed.hooks.PreToolUse[1].hooks[0].command).toContain('agent-entry-gate.mjs');
    expect(parsed.hooks.PreToolUse[2].hooks[0].command).toContain('stage-writer.mjs');
    expect(parsed.hooks.PreToolUse[3].hooks[0].command).toContain('decision-pause-gate.mjs');
    expect(isCapabilityGate(parsed.hooks.PreToolUse[4].hooks[0].command, 'pre-mutation')).toBe(
      true,
    );
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(1);
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toContain(
      'agent-entry-prompt-gate.mjs',
    );
    // agent-entry session-start + background self-update (decision D-2).
    expect(parsed.hooks.SessionStart).toHaveLength(2);
  });

  it('prunes the retired silent-update.sh SessionStart entry on re-onboard', async () => {
    // An earlier onboarding wired the now-retired .sh hook into SessionStart.
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

    // The dangling .sh entry is gone; the new .mjs hook is wired in exactly once.
    expect(commands.filter((command) => command.includes('silent-update.sh'))).toHaveLength(0);
    expect(commands.filter((command) => command.includes('silent-update.mjs'))).toHaveLength(1);
  });

  it('tolerates a malformed SessionStart matcher with no hooks array', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude/settings.json'),
      // A hand-edited matcher missing its `hooks` array must not crash the merge.
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

    // The empty matcher is dropped; only the two paqad SessionStart hooks remain.
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
    // agent-entry gate + stage-writer (RCA fix A) + decision-pause gate +
    // capability-kernel seam (F3), no duplicates after re-run.
    expect(parsed.hooks.PreToolUse).toHaveLength(4);
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(1);
    // agent-entry session-start + background self-update, no duplicates.
    expect(parsed.hooks.SessionStart).toHaveLength(2);
    // stage-marker-parse + verification-completion + capability-kernel seam (F3).
    expect(parsed.hooks.Stop).toHaveLength(3);
  });

  it('prunes the retired rule-script-enforce hook on re-onboard (no double-fire, F3)', async () => {
    // An earlier onboarding wired the now-retired rule-script-enforce.mjs in its
    // absolute `node "<abs>"` form on both PreToolUse and Stop. The capability
    // kernel subsumes it, so re-onboard must remove it — otherwise both the old
    // hook and capability-gate.mjs would enforce scripted rules (a double-fire).
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
    // The retired hook is gone everywhere; the kernel seam is wired exactly once
    // per seam.
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
});

/** True when `command` launches the capability-gate hook at the given seam. The
 *  seam is the hook's argv, so it trails the quoted path: `node "…/x.mjs" <seam>`. */
function isCapabilityGate(command: string, seam: 'pre-mutation' | 'completion'): boolean {
  return command.includes('capability-gate.mjs') && command.endsWith(` ${seam}`);
}
