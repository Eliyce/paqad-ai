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
import { pathToFileURL } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { readCostCache } from '@/cost/change-cost.js';
import { refreshChangeCostFromHook } from '@/cost/hook-cost.js';
import { hudCostCachePath } from '@/hud/files.js';
import { appendRouteTurn } from '@/pipeline/route-turns.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';

import { assistant } from '../cost/cost.fixture.js';

const REPO = process.cwd();
const STOP = join(REPO, 'runtime/hooks/verification-completion.mjs');
const SUBAGENT_STOP = join(REPO, 'runtime/hooks/stage-agent-completion.mjs');
const CLI = join(REPO, 'dist/cli/index.js');
const COST_LIB = pathToFileURL(join(REPO, 'runtime/hooks/lib/cost-refresh.mjs')).href;
const SES = 'ses_cost_hook';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-cost-hook-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

async function openFeature(root: string): Promise<string> {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  await execa('node', [CLI, 'stage', 'start', 'planning', '--title', 'ord501', '--issue', '501'], {
    cwd: root,
    env: { SE_SESSION: SES },
    reject: false,
  });
  const base = join(root, '.paqad/ledger/feature-evidence');
  const dirs = readdirSync(base).filter((name) => name !== '_session');
  return join(base, dirs[0]!);
}

function transcripts(root: string): { main: string; agent: string } {
  const now = new Date().toISOString();
  const restamp = (line: string) => line.replace(/"timestamp":"[^"]+"/, `"timestamp":"${now}"`);
  const dir = join(root, 'transcripts');
  mkdirSync(dir, { recursive: true });
  const main = join(dir, 'main.jsonl');
  const agent = join(dir, 'agent-dev.jsonl');
  writeFileSync(main, restamp(assistant('m1', '10:00', { input: 1000, output: 2000 })) + '\n');
  writeFileSync(agent, restamp(assistant('d1', '10:00', { input: 500, output: 500 })) + '\n');
  return { main, agent };
}

async function runHook(hook: string, root: string, payload: Record<string, unknown>) {
  return execa('node', [hook], {
    input: JSON.stringify({ session_id: SES, cwd: root, ...payload }),
    env: { PAQAD_PROJECT_ROOT: root, CLAUDE_PROJECT_DIR: root },
    reject: false,
  });
}

function hooksLog(root: string): string {
  const path = join(root, '.paqad/logs/hooks.log');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('cost.json from the Stop and SubagentStop hooks (AC-52)', () => {
  it('SubagentStop writes cost.json; a failed write keeps exit code and output and is logged', async () => {
    const root = tempRoot();
    const bundle = await openFeature(root);
    const { main, agent } = transcripts(root);
    const payload = {
      hook_event_name: 'SubagentStop',
      transcript_path: main,
      agent_id: 'agent_dev',
      agent_type: 'paqad-development',
      agent_transcript_path: agent,
    };
    const ok = await runHook(SUBAGENT_STOP, root, payload);
    const cost = JSON.parse(readFileSync(join(bundle, 'cost.json'), 'utf8')) as {
      tokens: { total: number };
      by_stage: Array<{ stage: string; tokens: { total: number } }>;
    };
    expect(cost.tokens.total).toBe(4000);
    expect(cost.by_stage.find((line) => line.stage === 'development')?.tokens.total).toBe(1000);
    const snapshot = JSON.parse(
      readFileSync(join(root, '.paqad/session/hud', `${SES}.json`), 'utf8'),
    ) as { cost: { tokens: { total: number } } | null };
    expect(snapshot.cost?.tokens.total).toBe(4000);

    rmSync(join(bundle, 'cost.json'));
    mkdirSync(join(bundle, 'cost.json'));
    const failed = await runHook(SUBAGENT_STOP, root, payload);
    expect(failed.exitCode).toBe(ok.exitCode);
    expect(failed.stdout).toBe(ok.stdout);
    expect(hooksLog(root)).toMatch(/stage-agent-completion: cost not recorded/);
  });

  it('Stop writes cost.json; a failed write keeps exit code and output and is logged', async () => {
    const root = tempRoot();
    const bundle = await openFeature(root);
    const { main } = transcripts(root);
    const payload = { hook_event_name: 'Stop', transcript_path: main };
    const ok = await runHook(STOP, root, payload);
    expect(
      (JSON.parse(readFileSync(join(bundle, 'cost.json'), 'utf8')) as { usd: number }).usd,
    ).toBe(0.044);

    rmSync(join(bundle, 'cost.json'));
    mkdirSync(join(bundle, 'cost.json'));
    const failed = await runHook(STOP, root, payload);
    expect(failed.exitCode).toBe(ok.exitCode);
    expect(failed.stdout).toBe(ok.stdout);
    expect(hooksLog(root)).toMatch(/verification-completion: cost not recorded/);
  }, 60_000);
});

describe('the cost seam (cost-refresh.mjs and hook-cost.ts)', () => {
  it('logs a failed load to hooks.log and never throws', async () => {
    const root = tempRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
    const { refreshCostFromHook } = (await import(COST_LIB)) as {
      refreshCostFromHook: (
        input: string,
        hook: string,
        load: (href: string) => Promise<unknown>,
      ) => Promise<void>;
    };
    const input = JSON.stringify({ session_id: SES, cwd: root });
    const previous = process.env.PAQAD_PROJECT_ROOT;
    process.env.PAQAD_PROJECT_ROOT = root;
    try {
      await expect(
        refreshCostFromHook(input, 'test-hook', () => Promise.reject(new Error('no dist'))),
      ).resolves.toBeUndefined();
      expect(hooksLog(root)).toMatch(/test-hook: cost not recorded: no dist/);
      let loaded = false;
      await refreshCostFromHook('', 'test-hook', () => {
        loaded = true;
        return Promise.resolve({});
      });
      expect(loaded).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.PAQAD_PROJECT_ROOT;
      else process.env.PAQAD_PROJECT_ROOT = previous;
    }
  });

  it('AC-41: with no change it keeps the session main transcript and writes no bundle', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
    appendRouteTurn(root, SES, { at: '2026-10-19T10:00:00.000Z', workflow: 'project-question' });
    const main = join(root, 'main.jsonl');
    writeFileSync(
      main,
      [assistant('before', '09:00', { output: 5 }), assistant('q1', '10:05', { output: 7 })].join(
        '\n',
      ) + '\n',
    );
    expect(
      refreshChangeCostFromHook({
        projectRoot: root,
        payload: { session_id: SES, transcript_path: main },
      }),
    ).toBe('no-feature');
    const cache = readCostCache(hudCostCachePath(root, SES), SES);
    expect(Object.keys(cache.sources[main]!.messages)).toEqual(['q1']);
    expect(existsSync(join(root, '.paqad/ledger/feature-evidence'))).toBe(false);
  });

  it('floors a session with no route-turn log at its turn start, then at now', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
    const main = join(root, 'main.jsonl');
    writeFileSync(main, `${assistant('q1', '10:05', { output: 7 })}\n`);
    const payload = { session_id: SES, transcript_path: main };
    refreshChangeCostFromHook({
      projectRoot: root,
      payload,
      now: () => new Date('2026-10-19T11:00:00.000Z'),
    });
    expect(readCostCache(hudCostCachePath(root, SES), SES).sources[main]!.floor).toBe(
      '2026-10-19T11:00:00.000Z',
    );
    writeWorkflowState(root, SES, {
      active: { workflow: 'project-question' },
      paused: [],
      turn_started_at: '2026-10-19T10:00:00.000Z',
    });
    refreshChangeCostFromHook({ projectRoot: root, payload });
    expect(readCostCache(hudCostCachePath(root, SES), SES).sources[main]!.floor).toBe(
      '2026-10-19T10:00:00.000Z',
    );
  });

  it('writes nothing without an active change or without any transcript', async () => {
    const root = tempRoot();
    expect(refreshChangeCostFromHook({ projectRoot: root, payload: {} })).toBe('no-feature');
    const bundle = await openFeature(root);
    expect(refreshChangeCostFromHook({ projectRoot: root, payload: {} })).toBe('no-sources');
    expect(existsSync(join(bundle, 'cost.json'))).toBe(false);

    const ledger = join(bundle, 'stage-evidence.jsonl');
    const kept = readFileSync(ledger, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.includes('"kind":"open"'));
    writeFileSync(ledger, kept.join('\n') + '\n');
    expect(
      refreshChangeCostFromHook({
        projectRoot: root,
        payload: { transcript_path: '/nowhere.jsonl' },
      }),
    ).toBe('no-window');
  });
});
