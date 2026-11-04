import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildHostHookChain, buildPluginHookChain } from '@/adapters/shared/paqad-hooks.js';

const REPO_ROOT = join(__dirname, '../../..');
const RUNTIME = join(REPO_ROOT, 'runtime');
const HAS_ENTRY = existsSync(join(REPO_ROOT, 'dist/update/last-update.js'));
const LINE = 'paqad updated itself from 1.117.0 to 1.118.0 and changed 1 file.';
const UNSEEN = '.paqad/state/last-update.json';
const SEEN = '.paqad/state/last-update.seen.json';

let root: string;

function seedRecord(project: string): void {
  mkdirSync(join(project, '.paqad/state'), { recursive: true });
  writeFileSync(join(project, '.paqad/framework-path.txt'), 'x\n', 'utf8');
  writeFileSync(
    join(project, UNSEEN),
    JSON.stringify({
      previous_version: '1.117.0',
      target_version: '1.118.0',
      changed_files: ['a.md'],
      skipped: [],
      config_keys_pruned: [],
      team_setup_notes: [],
      git_workflow_notes: [],
      updated_at: 'then',
    }),
    'utf8',
  );
}

function runCommand(
  command: string,
  project: string,
  payload: Record<string, unknown>,
): { status: number | null; stdout: string } {
  const home = join(project, 'home');
  mkdirSync(home, { recursive: true });
  const result = spawnSync(command, {
    shell: true,
    cwd: project,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_PROJECT_DIR: project,
      PAQAD_PROJECT_ROOT: project,
      CLAUDE_PLUGIN_ROOT: REPO_ROOT,
    },
  });
  return { status: result.status, stdout: result.stdout };
}

function sessionStartCommand(
  chain: ReadonlyArray<{ nativeEvent: string; command: string }>,
): string {
  const hook = chain.find(
    (entry) =>
      entry.nativeEvent === 'SessionStart' &&
      entry.command.includes('agent-entry-session-start.mjs'),
  );
  expect(hook).toBeDefined();
  return hook!.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', REPO_ROOT);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-last-update-hook-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(!HAS_ENTRY)('the SessionStart hook with a built dist', () => {
  const env = { PAQAD_FRAMEWORK_HOME: RUNTIME };

  it.each([
    ['claude-code', () => buildHostHookChain('claude-code', env)],
    ['codex-cli', () => buildHostHookChain('codex-cli', env)],
    ['plugin', () => buildPluginHookChain(env)],
  ])('AC-15: the rendered %s chain adds the line once', (_name, chain) => {
    seedRecord(root);
    const command = sessionStartCommand(chain());
    const first = runCommand(command, root, { source: 'startup', session_id: 's1' });
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(LINE);
    expect(existsSync(join(root, SEEN))).toBe(true);
    const second = runCommand(command, root, { source: 'startup', session_id: 's2' });
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain('paqad updated itself');
  });

  it('AC-14: a compact session stays quiet and keeps the record unseen', () => {
    seedRecord(root);
    const command = sessionStartCommand(buildHostHookChain('claude-code', env));
    const result = runCommand(command, root, { source: 'compact', session_id: 's1' });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('paqad updated itself');
    expect(existsSync(join(root, UNSEEN))).toBe(true);
  });

  it('AC-14: invalid JSON gives no line and exit 0', () => {
    seedRecord(root);
    writeFileSync(join(root, UNSEEN), '{ corrupt', 'utf8');
    const command = sessionStartCommand(buildHostHookChain('claude-code', env));
    const result = runCommand(command, root, { source: 'startup', session_id: 's1' });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('paqad updated itself');
  });
});

describe('the SessionStart hook with an older dist', () => {
  it('AC-15: exits 0 with no line when the entry is missing', () => {
    const pkg = join(root, 'pkg');
    cpSync(join(RUNTIME, 'hooks'), join(pkg, 'runtime/hooks'), { recursive: true });
    cpSync(join(RUNTIME, 'scripts'), join(pkg, 'runtime/scripts'), { recursive: true });
    mkdirSync(join(pkg, 'dist'), { recursive: true });
    const project = join(root, 'project');
    mkdirSync(project, { recursive: true });
    seedRecord(project);
    const env = { PAQAD_FRAMEWORK_HOME: join(pkg, 'runtime') };
    const command = sessionStartCommand(buildHostHookChain('claude-code', env));
    const result = runCommand(command, project, { source: 'startup', session_id: 's1' });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('paqad updated itself');
    expect(existsSync(join(project, UNSEEN))).toBe(true);
  });
});
