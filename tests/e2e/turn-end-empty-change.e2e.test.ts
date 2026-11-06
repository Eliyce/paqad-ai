import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { writeWorkflowState } from '@/pipeline/workflow-state.js';

import { ensureBuiltDist } from './helpers/ensure-built';

const REPO = process.cwd();
const CLI = resolve(REPO, 'dist/cli/index.js');
const HOOK = resolve(REPO, 'runtime/hooks/verification-completion.mjs');
const SESSION = 'ses-empty-change';

beforeAll(async () => {
  await ensureBuiltDist();
}, 240_000);

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

async function planningOnlyChange(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'paqad-empty-change-'));
  roots.push(root);
  const git = (...args: string[]) => execa('git', args, { cwd: root });
  await git('init', '-q', '-b', 'fix/empty');
  await git('config', 'user.email', 't@t.dev');
  await git('config', 'user.name', 'Test');
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), '.paqad/\n');
  writeFileSync(join(root, 'CLAUDE.md'), '# entry');
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'chore: base');
  const sentinelDir = join(root, '.paqad/.agent-entry-loaded.d');
  mkdirSync(sentinelDir, { recursive: true });
  writeFileSync(join(sentinelDir, SESSION), '{"loaded_at":"now"}');
  const future = new Date(Date.now() + 60_000);
  utimesSync(join(sentinelDir, SESSION), future, future);
  await execa('node', [CLI, 'stage', 'start', 'planning', '--title', 'empty'], {
    cwd: root,
    env: { ...process.env, SE_SESSION: SESSION },
  });
  writeWorkflowState(root, SESSION, {
    active: { workflow: 'feature-development' },
    paused: [],
    turn_started_at: new Date(Date.now() - 60_000).toISOString(),
  });
  return root;
}

async function stop(root: string): Promise<{ exitCode: number; out: string }> {
  const result = await execa('node', [HOOK], {
    input: JSON.stringify({
      session_id: SESSION,
      cwd: root,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    }),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_PROJECT_DIR: root },
    extendEnv: false,
    reject: false,
  });
  return { exitCode: result.exitCode ?? 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('turn end on an open change with no edits', { timeout: 120_000 }, () => {
  it('AC-4: the Stop hook does not hold a change that has no files', async () => {
    const root = await planningOnlyChange();
    const result = await stop(root);
    expect(result.exitCode).toBe(0);
    expect(result.out).not.toContain('"decision":"block"');
  });

  it('AC-23: the first changed file makes the next turn end judge the change', async () => {
    const root = await planningOnlyChange();
    expect((await stop(root)).out).not.toContain('"decision":"block"');

    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    const result = await stop(root);
    expect(result.out).toContain('"decision":"block"');
  });
});
