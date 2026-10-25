import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { writeChecksRunningMarker } from '@/checks/running-marker.js';
import { appendFeatureStageRow } from '@/feature-evidence/stage-ledger.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { ensureBuiltDist } from './helpers/ensure-built';

const REPO = process.cwd();
const HOOKS = resolve(REPO, 'runtime/hooks');
const CLI = resolve(REPO, 'dist/cli/index.js');
const VERIFICATION = join(HOOKS, 'verification-completion.mjs');
const MINUTE = 60_000;

beforeAll(async () => {
  await ensureBuiltDist();
}, 240_000);

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

interface Route {
  name: 'npm' | 'plugin';
  env: (root: string) => NodeJS.ProcessEnv;
}
const ROUTES: Route[] = [
  { name: 'npm', env: (root) => ({ CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: '' }) },
  { name: 'plugin', env: (root) => ({ CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: REPO }) },
];

interface HookResult {
  exitCode: number;
  out: string;
}

async function runHook(
  script: string,
  payload: unknown,
  routeEnv: NodeJS.ProcessEnv,
): Promise<HookResult> {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...routeEnv };
  if (env.CLAUDE_PLUGIN_ROOT === '') delete env.CLAUDE_PLUGIN_ROOT;
  const result = await execa('node', [script], {
    input: JSON.stringify(payload),
    env,
    reject: false,
    extendEnv: false,
  });
  return { exitCode: result.exitCode ?? 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

async function cli(root: string, session: string, args: string[]): Promise<void> {
  await execa('node', [CLI, ...args], {
    cwd: root,
    env: { ...process.env, SE_SESSION: session },
    reject: false,
  });
}

async function changeWithEdit(session: string): Promise<{ root: string; dir: string }> {
  const root = mkdtempSync(join(tmpdir(), 'paqad-stop-defer-'));
  roots.push(root);
  const git = (...args: string[]) => execa('git', args, { cwd: root });
  await git('init', '-q', '-b', 'fix/defer');
  await git('config', 'user.email', 't@t.dev');
  await git('config', 'user.name', 'Test');
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), '# entry');
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  writeFileSync(join(root, 'src/base.ts'), 'export const base = 1;\n');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'chore: base');
  const sentinelDir = join(root, '.paqad/.agent-entry-loaded.d');
  mkdirSync(sentinelDir, { recursive: true });
  writeFileSync(join(sentinelDir, session), '{"loaded_at":"now"}');
  const future = new Date(Date.now() + MINUTE);
  utimesSync(join(sentinelDir, session), future, future);
  await cli(root, session, ['stage', 'start', 'planning', '--title', 'defer', '--issue', '7']);
  await cli(root, session, ['stage', 'end', 'planning']);
  writeFileSync(join(root, 'src/feature.ts'), 'export const feature = 2;\n');
  const base = join(root, '.paqad/ledger/feature-evidence');
  const dir = readdirSync(base).find((name) => name !== '_session')!;
  return { root, dir };
}

function stopPayload(root: string, session: string, tasks: unknown[]): unknown {
  return {
    session_id: session,
    cwd: root,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    background_tasks: tasks,
  };
}

async function stop(root: string, session: string, tasks: unknown[], route: Route) {
  return runHook(VERIFICATION, stopPayload(root, session, tasks), route.env(root));
}

function judgedAndBlocked(result: HookResult): void {
  expect(result.out).toContain('"decision":"block"');
  expect(result.out).toContain('stage-evidence');
}

async function deadPid(): Promise<number> {
  const child = execa('node', ['-e', '']);
  const pid = child.pid!;
  await child;
  return pid;
}

describe('Stop deferral cannot be used to end a turn unjudged', { timeout: 90_000 }, () => {
  for (const route of ROUTES) {
    it(`[${route.name}] judges and blocks as today with no background task and no marker`, async () => {
      const session = `ses-base-${route.name}`;
      const { root } = await changeWithEdit(session);

      judgedAndBlocked(await stop(root, session, [{ id: 'bg-1' }], route));
    });

    it(`[${route.name}] AC-39: a forged checks running marker does not defer`, async () => {
      const session = `ses-forged-${route.name}`;
      const { root, dir } = await changeWithEdit(session);
      writeChecksRunningMarker(root, {
        pid: process.pid,
        session_id: resolveSessionId(root, session),
        change: dir,
        started_at: new Date().toISOString(),
      });

      judgedAndBlocked(await stop(root, session, [{ id: 'bg-1' }], route));
    });

    it(`[${route.name}] AC-39: a marker whose process is dead does not defer`, async () => {
      const session = `ses-dead-${route.name}`;
      const { root, dir } = await changeWithEdit(session);
      writeChecksRunningMarker(root, {
        pid: await deadPid(),
        session_id: resolveSessionId(root, session),
        change: dir,
        started_at: new Date().toISOString(),
      });

      judgedAndBlocked(await stop(root, session, [{ id: 'bg-1' }], route));
    });

    it(`[${route.name}] AC-39: a background task that never finishes stops deferring after 30 minutes`, async () => {
      const session = `ses-endless-${route.name}`;
      const { root, dir } = await changeWithEdit(session);
      const sessionId = resolveSessionId(root, session);
      await cli(root, session, ['stage', 'start', 'development']);
      const turnStart = new Date(Date.now() - 40 * MINUTE);
      writeWorkflowState(root, sessionId, {
        active: { workflow: 'feature-development', lane: 'full' },
        paused: [],
        turn_started_at: turnStart.toISOString(),
      });

      const fresh = await stop(root, session, [{ id: 'bg-1' }], route);
      expect(fresh.out).not.toContain('"decision":"block"');

      appendFeatureStageRow(
        root,
        sessionId,
        dir,
        {
          kind: 'completion-deferred',
          reason: 'background task running while a stage is open',
          tasks: 1,
        },
        () => new Date(Date.now() - 31 * MINUTE),
      );

      judgedAndBlocked(await stop(root, session, [{ id: 'bg-1' }], route));
    });
  }
});
