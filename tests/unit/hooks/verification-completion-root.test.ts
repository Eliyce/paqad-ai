import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow } from '@/feature-evidence/stage-ledger.js';
import { endStage } from '@/stage-evidence/recorder.js';

const HOOK = join(process.cwd(), 'runtime/hooks/verification-completion.mjs');

describe('runtime/hooks/verification-completion.mjs — project-root resolution', () => {
  let disabledProject: string;
  let foreignCwd: string;

  beforeEach(() => {
    disabledProject = mkdtempSync(join(tmpdir(), 'paqad-vc-off-'));
    mkdirSync(join(disabledProject, '.paqad'), { recursive: true });
    writeFileSync(join(disabledProject, '.paqad', '.config'), 'paqad_enable=false\n');
    foreignCwd = mkdtempSync(join(tmpdir(), 'paqad-vc-cwd-'));
  });

  afterEach(() => {
    rmSync(disabledProject, { recursive: true, force: true });
    rmSync(foreignCwd, { recursive: true, force: true });
  });

  it('respects OFF from CLAUDE_PROJECT_DIR even when cwd is a different directory', async () => {
    const result = await execa('node', [HOOK], {
      cwd: foreignCwd,
      reject: false,
      input: JSON.stringify({ session_id: 'vc-root', hook_event_name: 'Stop' }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: disabledProject, PAQAD_PROJECT_ROOT: '' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});

describe('runtime/hooks/verification-completion.mjs — a live stage agent defers the judgement', () => {
  const REPO = process.cwd();
  const CLI = join(REPO, 'dist/cli/index.js');
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  async function openPlanning(session: string): Promise<{ root: string; dir: string }> {
    const root = mkdtempSync(join(tmpdir(), 'paqad-vc-live-'));
    roots.push(root);
    const git = (...args: string[]) => execa('git', args, { cwd: root });
    await git('init', '-q', '-b', 'fix/live');
    await git('config', 'user.email', 't@t.dev');
    await git('config', 'user.name', 'Test');
    mkdirSync(join(root, '.paqad'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'CLAUDE.md'), '# entry');
    writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
    writeFileSync(join(root, 'src/base.ts'), 'export const base = 1;\n');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'chore: base');
    await execa('node', [CLI, 'stage', 'start', 'planning', '--title', 'live', '--issue', '7'], {
      cwd: root,
      env: { ...process.env, SE_SESSION: session },
      reject: false,
    });
    writeFileSync(join(root, 'src/feature.ts'), 'export const feature = 2;\n');
    const base = join(root, '.paqad/ledger/feature-evidence');
    const dir = readdirSync(base).find((name) => name !== '_session')!;
    return { root, dir };
  }

  function rows(root: string, dir: string): Array<Record<string, unknown>> {
    return readFileSync(
      join(root, '.paqad/ledger/feature-evidence', dir, 'stage-evidence.jsonl'),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  function verdictFiles(root: string): string[] {
    const hud = join(root, '.paqad/session/hud');
    return existsSync(hud) ? readdirSync(hud).filter((name) => name.endsWith('.verdict.json')) : [];
  }

  async function stop(root: string, session: string, extra: Record<string, unknown> = {}) {
    return execa('node', [HOOK], {
      cwd: root,
      reject: false,
      input: JSON.stringify({
        session_id: session,
        cwd: root,
        hook_event_name: 'Stop',
        stop_hook_active: false,
        ...extra,
      }),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_PROJECT_DIR: root },
      extendEnv: false,
    });
  }

  it('AC-2 / AC-28: no background_tasks but a started planning agent in the ledger: nothing is judged', async () => {
    const session = 'ses-live-defer';
    const { root, dir } = await openPlanning(session);
    appendFeatureStageRow(root, session, dir, {
      kind: 'stage-agent',
      stage: 'planning',
      agent: 'paqad-planning',
      agent_id: 'agent-plan-1',
      event_status: 'started',
      tokens_used: 0,
      tokens_not_recarried: 0,
      estimate: true,
    });

    const result = await stop(root, session);

    expect(result.exitCode).toBe(0);
    const kinds = rows(root, dir).map((row) => `${String(row.kind)}:${String(row.stage)}`);
    expect(kinds).not.toContain('verify:undefined');
    expect(rows(root, dir).some((row) => row.kind === 'verify')).toBe(false);
    expect(rows(root, dir).some((row) => row.kind === 'stage_end')).toBe(false);
    expect(rows(root, dir).filter((row) => row.kind === 'completion-deferred')).toHaveLength(1);
    expect(existsSync(join(root, '.paqad/ledger/feature-evidence', dir, 'receipt.json'))).toBe(
      false,
    );
    expect(verdictFiles(root)).toEqual([]);
  }, 60_000);

  it('AC-3: a turn end between stages writes no verify, no verdict, and nudges the next stage once', async () => {
    const session = 'ses-between';
    const { root, dir } = await openPlanning(session);
    await execa('node', [CLI, 'lane', 'set', 'full'], {
      cwd: root,
      env: { ...process.env, SE_SESSION: session },
      reject: false,
    });
    const plan = featureFilePath(dir, 'plan');
    writeFileSync(join(root, plan), '{"steps":[{"id":"S1"}]}\n');
    endStage(
      root,
      'planning',
      { artifactPaths: [plan] },
      {
        sessionId: session,
        dirName: dir,
        adapter: 'claude-code',
      },
    );

    const first = await stop(root, session, { background_tasks: [] });
    expect(first.stdout).toContain('"decision":"block"');
    expect(first.stdout).toContain('specification has not started');
    const again = await stop(root, session, { background_tasks: [], stop_hook_active: true });
    expect(again.stdout).toBe('');

    expect(rows(root, dir).some((row) => row.kind === 'verify')).toBe(false);
    expect(verdictFiles(root)).toEqual([]);
  }, 60_000);

  it('AC-4: the same open stage with no live stage agent is still judged', async () => {
    const session = 'ses-live-judged';
    const { root, dir } = await openPlanning(session);

    await stop(root, session, { background_tasks: [] });

    expect(rows(root, dir).some((row) => row.kind === 'verify')).toBe(true);
    expect(rows(root, dir).some((row) => row.kind === 'completion-deferred')).toBe(false);
  }, 60_000);
});
