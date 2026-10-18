import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPluginCommand } from '@/cli/commands/plugin.js';

// HOME is sandboxed per test file by tests/shared/isolate-home.ts, so homedir() is a temp dir.
const statePath = (): string => join(homedir(), '.paqad-ai', 'plugin-migration.json');

function writeState(record: Record<string, unknown>): void {
  mkdirSync(join(homedir(), '.paqad-ai'), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(record));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('paqad-ai plugin tick (hidden, issue #648)', () => {
  it('is hidden from help', () => {
    expect(createPluginCommand().helpInformation()).not.toContain('tick');
  });

  it('records a plugin session silently (installed → done)', async () => {
    writeState({ state: 'installed', path: 'settings', attempts: 1, version: '1' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createPluginCommand().parseAsync(['node', 'plugin', 'tick', '--source', 'plugin']);
    expect(JSON.parse(readFileSync(statePath(), 'utf8')).state).toBe('done');
    expect(log).not.toHaveBeenCalled();
  });

  it('ignores an unknown source and leaves the state alone', async () => {
    writeState({ state: 'installed', path: 'settings', attempts: 1, version: '1' });
    await createPluginCommand().parseAsync([
      'node',
      'plugin',
      'tick',
      '--source',
      'codex',
      '--session',
      's1',
    ]);
    expect(JSON.parse(readFileSync(statePath(), 'utf8')).state).toBe('installed');
  });
});
