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

import { refreshChangeCostFromHook } from '@/cost/hook-cost.js';

import { assistant } from '../cost/cost.fixture.js';

// Issue #639, Part 23 (AC-52, decision D-01M5AM0F03B730SDSAPVC96W38): the EXISTING Stop and
// SubagentStop hooks, unchanged in matcher, order and registration, rewrite the change's
// cost.json after their decision is final. A failed write is logged to .paqad/logs/hooks.log and
// leaves the hook's exit code and output byte-identical.

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

/** Transcripts with usage stamped after the change opened, so the window holds them. */
function transcripts(root: string): { main: string; agent: string } {
  const now = new Date().toISOString();
  // The fixture helper stamps a fixed day; restamp each line to now, just after the open row.
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
    // The HUD refresh that follows picks the cost up.
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

  it('writes nothing without an active change or without any transcript', async () => {
    const root = tempRoot();
    expect(refreshChangeCostFromHook({ projectRoot: root, payload: {} })).toBe('no-feature');
    const bundle = await openFeature(root);
    expect(refreshChangeCostFromHook({ projectRoot: root, payload: {} })).toBe('no-sources');
    expect(existsSync(join(bundle, 'cost.json'))).toBe(false);

    // A change whose ledger lost its open row has no window to count in.
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
