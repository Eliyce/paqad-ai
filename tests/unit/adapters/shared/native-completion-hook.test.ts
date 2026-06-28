import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildNativeCompletionHookFile } from '@/adapters/shared/native-completion-hook.js';
import { completionRecordCommand, PAQAD_RUNTIME_PREFIX } from '@/adapters/shared/paqad-hooks.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-native-hook-'));
}

function seedExisting(root: string, settingsPath: string, content: string): void {
  const full = join(root, settingsPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

interface HookCommand {
  type: string;
  command: string;
}
interface HookGroup {
  hooks: HookCommand[];
}
interface ParsedSettings {
  hooks: Record<string, HookGroup[]>;
  model?: string;
}

function render(projectRoot: string, settingsPath: string, completionEvent: string) {
  const file = buildNativeCompletionHookFile({ projectRoot, settingsPath, completionEvent });
  return { file, json: JSON.parse(file.content) as ParsedSettings };
}

describe('buildNativeCompletionHookFile', () => {
  it('renders the record-only completion hook under the host event, on a fresh project', () => {
    const root = tempProject();
    const { file, json } = render(root, '.codex/hooks.json', 'Stop');

    expect(file.path).toBe('.codex/hooks.json');
    expect(file.autoUpdate).toBe(true);
    expect(json.hooks.Stop).toHaveLength(1);
    expect(json.hooks.Stop[0].hooks[0]).toEqual({
      type: 'command',
      command: completionRecordCommand(),
    });
    // The command is the record-only hook, never the blocking Claude variant.
    expect(file.content).toContain('verification-record.mjs');
    expect(file.content).not.toContain('verification-completion.mjs');
  });

  it('uses the host-specific event name (Gemini AfterAgent)', () => {
    const root = tempProject();
    const { json } = render(root, '.gemini/settings.json', 'AfterAgent');
    expect(json.hooks.AfterAgent[0].hooks[0].command).toBe(completionRecordCommand());
    expect(json.hooks.Stop).toBeUndefined();
  });

  it('is idempotent — re-rendering does not duplicate the hook', () => {
    const root = tempProject();
    const first = render(root, '.codex/hooks.json', 'Stop').file;
    seedExisting(root, '.codex/hooks.json', first.content);

    const { json } = render(root, '.codex/hooks.json', 'Stop');
    expect(json.hooks.Stop).toHaveLength(1);
  });

  it('preserves existing settings and a user hook for the same event', () => {
    const root = tempProject();
    seedExisting(
      root,
      '.gemini/settings.json',
      JSON.stringify({
        model: 'gemini-2.5-pro',
        hooks: {
          AfterAgent: [{ hooks: [{ type: 'command', command: 'echo user-hook' }] }],
          SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }],
        },
      }),
    );

    const { json } = render(root, '.gemini/settings.json', 'AfterAgent');

    // Unrelated settings and events survive untouched.
    expect(json.model).toBe('gemini-2.5-pro');
    expect(json.hooks.SessionStart).toHaveLength(1);
    // The user's AfterAgent hook is kept; paqad's is appended (no clobber).
    expect(json.hooks.AfterAgent).toHaveLength(2);
    const commands = json.hooks.AfterAgent.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
    expect(commands).toContain('echo user-hook');
    expect(commands).toContain(completionRecordCommand());
  });

  it('tolerates an unparseable existing file by treating it as empty', () => {
    const root = tempProject();
    seedExisting(root, '.codex/hooks.json', 'not json {{{');
    const { json } = render(root, '.codex/hooks.json', 'Stop');
    expect(json.hooks.Stop[0].hooks[0].command).toBe(completionRecordCommand());
  });

  it('prunes the retired bare-path record command on re-onboard (#240)', () => {
    const root = tempProject();
    // An earlier onboard wired the Windows-broken bare `.mjs` invocation.
    seedExisting(
      root,
      '.codex/hooks.json',
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `${PAQAD_RUNTIME_PREFIX}/hooks/verification-record.mjs`,
                },
              ],
            },
          ],
        },
      }),
    );

    const { json } = render(root, '.codex/hooks.json', 'Stop');
    const commands = json.hooks.Stop.flatMap((group) => group.hooks.map((hook) => hook.command));
    // The bare path is gone; the cross-platform `node "<abs>"` command replaces it once.
    expect(commands).not.toContain(`${PAQAD_RUNTIME_PREFIX}/hooks/verification-record.mjs`);
    expect(commands.filter((command) => command === completionRecordCommand())).toHaveLength(1);
    expect(commands.some((command) => command.includes('~'))).toBe(false);
  });
});
