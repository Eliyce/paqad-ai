import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPluginCommand } from '@/cli/commands/plugin.js';

const statePath = (): string => join(homedir(), '.paqad-ai', 'plugin-migration.json');

let projectRoot: string;
const saved = { ...process.env };

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'paqad-migrate-cmd-'));
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.paqad', 'onboarding-manifest.json'),
    JSON.stringify({ adapter: 'claude-code', generated_artifacts: [] }),
  );
  rmSync(statePath(), { force: true });
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(statePath(), { force: true });
  vi.restoreAllMocks();
});

async function migrate(): Promise<void> {
  await createPluginCommand().parseAsync([
    'node',
    'plugin',
    'migrate',
    '--project-root',
    projectRoot,
  ]);
}

describe('AC-7: paqad-ai plugin migrate (hidden)', () => {
  it('is hidden from help', () => {
    expect(createPluginCommand().helpInformation()).not.toContain('migrate');
  });

  it('runs the migration with every opt-out: a cloud session records its skip and installs nothing', async () => {
    process.env.PAQAD_PLUGIN_MIGRATION = 'on';
    process.env.CLAUDE_CODE_REMOTE = 'true';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await migrate();
    expect(JSON.parse(readFileSync(statePath(), 'utf8'))).toMatchObject({
      state: 'skipped',
      reason: 'cloud-session',
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('AC-5: a failed install records its reason in the migration state and in hooks.log', async () => {
    process.env.PAQAD_PLUGIN_MIGRATION = 'on';
    delete process.env.CLAUDE_CODE_REMOTE;
    delete process.env.CI;
    delete process.env.PAQAD_HEADLESS;
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
    process.env.PATH = '';
    await migrate();
    const state = JSON.parse(readFileSync(statePath(), 'utf8'));
    expect(['failed', 'skipped']).toContain(state.state);
    expect(state.reason).toBeTruthy();
    const log = readFileSync(join(projectRoot, '.paqad', 'logs', 'hooks.log'), 'utf8');
    expect(log).toContain(`plugin install: ${state.state} (${state.reason})`);
  });

  it('honours claude_install_mode=settings', async () => {
    process.env.PAQAD_PLUGIN_MIGRATION = 'on';
    process.env.PAQAD_CLAUDE_INSTALL_MODE = 'settings';
    delete process.env.CLAUDE_CODE_REMOTE;
    await migrate();
    expect(JSON.parse(readFileSync(statePath(), 'utf8')).reason).toBe('install-mode-settings');
  });
});
