import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildNativeCompletionHookFile } from '@/adapters/shared/native-completion-hook.js';
import { PAQAD_COMPLETION_RECORD_SCRIPT } from '@/adapters/shared/paqad-hooks.js';

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
      command: PAQAD_COMPLETION_RECORD_SCRIPT,
    });
    // The command is the record-only hook, never the blocking Claude variant.
    expect(file.content).toContain('verification-record.mjs');
    expect(file.content).not.toContain('verification-completion.mjs');
  });

  it('uses the host-specific event name (Gemini AfterAgent)', () => {
    const root = tempProject();
    const { json } = render(root, '.gemini/settings.json', 'AfterAgent');
    expect(json.hooks.AfterAgent[0].hooks[0].command).toBe(PAQAD_COMPLETION_RECORD_SCRIPT);
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
    expect(commands).toContain(PAQAD_COMPLETION_RECORD_SCRIPT);
  });

  it('tolerates an unparseable existing file by treating it as empty', () => {
    const root = tempProject();
    seedExisting(root, '.codex/hooks.json', 'not json {{{');
    const { json } = render(root, '.codex/hooks.json', 'Stop');
    expect(json.hooks.Stop[0].hooks[0].command).toBe(PAQAD_COMPLETION_RECORD_SCRIPT);
  });
});
