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
        SessionStart: Array<{ hooks: Array<{ command: string }> }>;
      };
    };
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('Edit|Write|NotebookEdit');
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toContain('agent-entry-gate.sh');
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain('agent-entry-session-start.sh');
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
        SessionStart: Array<{ hooks: Array<{ command: string }> }>;
      };
    };

    expect(parsed.permissions.allow).toEqual(['Bash(ls:*)']);
    expect(parsed.hooks.PreToolUse).toHaveLength(2);
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe('/usr/local/bin/my-existing-hook');
    expect(parsed.hooks.PreToolUse[1].hooks[0].command).toContain('agent-entry-gate.sh');
    expect(parsed.hooks.SessionStart).toHaveLength(1);
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
    ) as { hooks: { PreToolUse: unknown[]; SessionStart: unknown[] } };
    expect(parsed.hooks.PreToolUse).toHaveLength(1);
    expect(parsed.hooks.SessionStart).toHaveLength(1);
  });
});
