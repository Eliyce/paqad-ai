import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { execa } from 'execa';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ensureBuiltDist } from './helpers/ensure-built';

const REPO = process.cwd();
const CLI = resolve(REPO, 'dist/cli/index.js');
const PLUGIN_HOOK = resolve(REPO, 'runtime/hooks/stage-agent-completion.mjs');
const LAUNCHER_TEMPLATE = resolve(REPO, 'runtime/templates/team-bootstrap/hook.mjs');
const LAUNCHER_LINE = 'node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" stage-agent-completion.mjs';

let home = '';
const roots: string[] = [];

beforeAll(async () => {
  await ensureBuiltDist();
  home = mkdtempSync(join(tmpdir(), 'paqad-one-chain-home-'));
  const copy = join(home, '.paqad-ai', 'team-plugin');
  mkdirSync(copy, { recursive: true });
  copyFileSync(join(REPO, 'package.json'), join(copy, 'package.json'));
  for (const part of ['dist', 'runtime']) {
    cpSync(join(REPO, part), join(copy, part), { recursive: true });
  }
}, 240_000);

afterAll(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

async function onboardedChange(): Promise<{ root: string; payload: string }> {
  const root = mkdtempSync(join(tmpdir(), 'paqad-one-chain-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  writeFileSync(
    join(root, '.claude/settings.json'),
    JSON.stringify({
      hooks: {
        SubagentStop: [
          { matcher: '^(paqad:)?paqad-', hooks: [{ type: 'command', command: LAUNCHER_LINE }] },
        ],
      },
    }),
  );
  copyFileSync(LAUNCHER_TEMPLATE, join(root, '.paqad/hook.mjs'));
  await execa('node', [CLI, 'stage', 'start', 'planning', '--title', 'one chain', '--issue', '9'], {
    cwd: root,
    env: { ...process.env, SE_SESSION: 'one-chain' },
    reject: false,
  });
  const transcript = join(root, 'sub.jsonl');
  writeFileSync(
    transcript,
    `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'work' } })}\n`,
  );
  const payload = JSON.stringify({
    session_id: 'sub-one',
    cwd: root,
    transcript_path: transcript,
    agent_id: 'agent-one',
    agent_type: 'paqad-development',
    hook_event_name: 'SubagentStop',
  });
  return { root, payload };
}

function stageAgentRows(root: string): number {
  const base = join(root, '.paqad/ledger/feature-evidence');
  const dir = readdirSync(base).find((name) => name !== '_session')!;
  return readFileSync(join(base, dir, 'stage-evidence.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { kind?: string })
    .filter((row) => row.kind === 'stage-agent').length;
}

function baseEnv(root: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_PROJECT_DIR: root,
    CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    ...extra,
  };
}

async function runLauncher(root: string, payload: string, env: NodeJS.ProcessEnv): Promise<number> {
  const result = await execa(
    'node',
    [join(root, '.paqad/hook.mjs'), 'stage-agent-completion.mjs'],
    { input: payload, env, extendEnv: false, reject: false },
  );
  return result.exitCode ?? 0;
}

async function runPluginHook(root: string, payload: string, env: NodeJS.ProcessEnv): Promise<void> {
  await execa('node', [PLUGIN_HOOK], {
    input: payload,
    env: { ...env, CLAUDE_PLUGIN_ROOT: REPO },
    extendEnv: false,
    reject: false,
  });
}

function installPlugin(root: string): void {
  const dir = join(root, 'claude-config', 'plugins');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: { 'paqad@eliyce': [{ scope: 'user', installPath: REPO }] },
    }),
  );
}

describe('AC-33: exactly one hook chain acts on each route', () => {
  it('launcher then team copy writes one stage-agent row', async () => {
    const { root, payload } = await onboardedChange();
    expect(await runLauncher(root, payload, baseEnv(root))).toBe(0);
    expect(stageAgentRows(root)).toBe(1);
  });

  it('launcher then npm writes one stage-agent row and leaves ~/.paqad-ai/current alone', async () => {
    const { root, payload } = await onboardedChange();
    const env = baseEnv(root, { PAQAD_FRAMEWORK_HOME: resolve(REPO, 'runtime') });
    expect(await runLauncher(root, payload, env)).toBe(0);
    expect(stageAgentRows(root)).toBe(1);
    expect(existsSync(join(home, '.paqad-ai', 'current'))).toBe(false);
  });

  it('plugin installed plus launcher lines: the launcher steps aside and the plugin writes one row', async () => {
    const { root, payload } = await onboardedChange();
    installPlugin(root);
    const env = baseEnv(root);
    expect(await runLauncher(root, payload, env)).toBe(0);
    expect(stageAgentRows(root)).toBe(0);
    await runPluginHook(root, payload, env);
    expect(stageAgentRows(root)).toBe(1);
  });

  it('npm and plugin installed plus launcher lines: still one row', async () => {
    const { root, payload } = await onboardedChange();
    installPlugin(root);
    const env = baseEnv(root, { PAQAD_FRAMEWORK_HOME: resolve(REPO, 'runtime') });
    await runLauncher(root, payload, env);
    await runPluginHook(root, payload, env);
    expect(stageAgentRows(root)).toBe(1);
  });
});
