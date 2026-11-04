import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { execa } from 'execa';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ensureBuiltDist } from './helpers/ensure-built';

const REPO = process.cwd();
const START = resolve(REPO, 'runtime/hooks/stage-agent-start.mjs');
const CLI = resolve(REPO, 'dist/cli/index.js');
const LAUNCHER_TEMPLATE = resolve(REPO, 'runtime/templates/team-bootstrap/hook.mjs');
const SESSION = 'ses_routes';

let launcherHome = '';
const roots: string[] = [];

beforeAll(async () => {
  await ensureBuiltDist();
  launcherHome = mkdtempSync(join(tmpdir(), 'paqad-recipe-home-'));
  const copy = join(launcherHome, '.paqad-ai', 'team-plugin');
  mkdirSync(copy, { recursive: true });
  copyFileSync(join(REPO, 'package.json'), join(copy, 'package.json'));
  for (const part of ['dist', 'runtime']) {
    cpSync(join(REPO, part), join(copy, part), { recursive: true });
  }
}, 240_000);

afterAll(() => {
  if (launcherHome) rmSync(launcherHome, { recursive: true, force: true });
});

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function launcherEnv(root: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CLAUDE_PROJECT_DIR: root,
    HOME: launcherHome,
    USERPROFILE: launcherHome,
    CLAUDE_CONFIG_DIR: join(launcherHome, '.claude'),
    USE_LAUNCHER: '1',
    ...extra,
  };
}

const ROUTES: ReadonlyArray<{ name: string; env: (root: string) => NodeJS.ProcessEnv }> = [
  { name: 'npm', env: (root) => ({ CLAUDE_PROJECT_DIR: root }) },
  { name: 'plugin', env: (root) => ({ CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: REPO }) },
  {
    name: 'launcher then npm',
    env: (root) => launcherEnv(root, { PAQAD_FRAMEWORK_HOME: resolve(REPO, 'runtime') }),
  },
  { name: 'launcher then team copy', env: (root) => launcherEnv(root) },
];

async function runStart(routeEnv: NodeJS.ProcessEnv, payload: unknown) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...routeEnv };
  let command = [START];
  if (env.USE_LAUNCHER) {
    delete env.USE_LAUNCHER;
    const launcher = join(env.CLAUDE_PROJECT_DIR!, '.paqad', 'hook.mjs');
    copyFileSync(LAUNCHER_TEMPLATE, launcher);
    command = [launcher, basename(START)];
  }
  return execa('node', command, {
    input: JSON.stringify(payload),
    env,
    reject: false,
    extendEnv: false,
  });
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-recipe-route-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), `${resolve(REPO, 'runtime')}\n`);
  return root;
}

describe.each(ROUTES)('the recipe reaches a stage agent on the $name route', ({ env }) => {
  it('adds the recipe to the brief and records it', async () => {
    const root = repo();
    await execa('node', [CLI, 'stage', 'start', 'planning', '--title', 'routes', '--issue', '1'], {
      cwd: root,
      env: { SE_SESSION: SESSION },
    });
    const run = await runStart(env(root), {
      session_id: SESSION,
      agent_id: 'agent_route',
      agent_type: 'paqad-review',
      hook_event_name: 'SubagentStart',
    });
    expect(run.exitCode).toBe(0);
    const context = (
      JSON.parse(run.stdout) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext;
    expect(context).toContain('## Your recipe');
    expect(context).toContain('Restate the request');
    const base = join(root, '.paqad/ledger/feature-evidence');
    const dir = readdirSync(base).filter((name) => name !== '_session')[0]!;
    const rows = readFileSync(join(base, dir, 'stage-evidence.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows.find((row) => row.kind === 'recipe-injected')).toMatchObject({
      stage: 'review',
      recipe: 'review-recipe',
      agent_id: 'agent_route',
    });
  }, 60_000);
});
