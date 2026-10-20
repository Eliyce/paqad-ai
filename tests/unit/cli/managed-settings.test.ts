import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createManagedSettingsCommand,
  MANAGED_SETTINGS_REFUSAL,
} from '@/cli/commands/managed-settings.js';
import { createProgram, normalizeCliArgv } from '@/cli/program.js';
import { PLUGIN_MARKETPLACE_REPO } from '@/install/plugin-migration.js';

const HOOKS = {
  PreToolUse: [
    {
      matcher: 'Edit|Write|NotebookEdit',
      hooks: [
        {
          type: 'command',
          command: 'paqad-ai hook --managed capability-gate pre-mutation',
          onFailure: 'block',
          timeout: 30,
        },
        {
          type: 'command',
          command: 'paqad-ai hook --managed decision-pause-gate',
          onFailure: 'block',
          timeout: 30,
        },
      ],
    },
  ],
};

const GOLDEN = {
  hooks: HOOKS,
  extraKnownMarketplaces: {
    eliyce: { source: { source: 'github', repo: PLUGIN_MARKETPLACE_REPO }, autoUpdate: true },
  },
  enabledPlugins: { 'paqad@eliyce': true },
};

describe('paqad-ai managed-settings', () => {
  let root: string;
  let out: string;
  let errors: string[];
  let lines: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-managed-settings-'));
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    out = '';
    errors = [];
    lines = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(String(line));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function enableEnterprise(): void {
    writeFileSync(join(root, '.paqad/configs/.config.app'), 'enterprise=true\n');
  }

  async function run(...args: string[]): Promise<void> {
    await createManagedSettingsCommand().parseAsync([...args, '--project-root', root], {
      from: 'user',
    });
  }

  it('refuses with the teams message and writes nothing while enterprise is off', async () => {
    const dir = join(root, 'managed');
    await run('--write', dir);
    expect(process.exitCode).toBe(1);
    expect(errors).toEqual([MANAGED_SETTINGS_REFUSAL]);
    expect(MANAGED_SETTINGS_REFUSAL).toBe(
      'managed-settings is part of paqad for teams; set enterprise.enabled=true',
    );
    expect(existsSync(dir)).toBe(false);
    expect(out).toBe('');
  });

  it('prints JSON matching the golden settings field for field', async () => {
    enableEnterprise();
    await run();
    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(out)).toEqual(GOLDEN);
  });

  it('--no-plugin drops exactly the two plugin keys', async () => {
    enableEnterprise();
    await run('--no-plugin');
    expect(JSON.parse(out)).toEqual({ hooks: HOOKS });
  });

  it('--write creates only <dir>/paqad.json', async () => {
    enableEnterprise();
    const dir = join(root, 'managed-settings.d');
    await run('--write', dir);
    expect(readdirSync(dir)).toEqual(['paqad.json']);
    expect(JSON.parse(readFileSync(join(dir, 'paqad.json'), 'utf8'))).toEqual(GOLDEN);
    expect(out).toBe('');
    expect(lines.join('\n')).toContain(join(dir, 'paqad.json'));
  });

  it('reports a write failure with exit 1', async () => {
    enableEnterprise();
    const blocker = join(root, 'a-file');
    writeFileSync(blocker, 'x');
    await run('--write', blocker);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('could not write');
  });

  it('keeps --no-plugin and the managed hook flags through argv normalization', () => {
    const program = createProgram();
    for (const argv of [
      ['node', 'paqad-ai', 'managed-settings', '--no-plugin', '--write', '/tmp/x'],
      ['node', 'paqad-ai', 'hook', '--managed', 'capability-gate', 'pre-mutation'],
    ]) {
      expect(normalizeCliArgv(program, argv)).toEqual({ argv, notices: [] });
    }
  });
});
