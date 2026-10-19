import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { buildHighTableView } from '@/hud/high-table-view.js';
import { readHighTable, recordDoneRow, recordWritingRow } from '@/spec-pipeline/high-table.js';

import {
  fixtureTotal,
  writeSeatTranscript,
  type FixtureUsage,
} from '../spec-pipeline/high-table.fixture.js';

// Issue #639, Part 13 (AC-40, AC-41): the EXISTING SubagentStop hook, unchanged in matcher,
// order and registration, records a High Table seat's exact tokens from the seat's own
// transcript, never a stage-agent row, and leaves the seat's estimate alone when the host gave
// no subagent transcript.

const HOOK = join(process.cwd(), 'runtime/hooks/stage-agent-completion.mjs');
const CLI = join(process.cwd(), 'dist/cli/index.js');
const SES = 'ses_ht_hook';

const USAGE: FixtureUsage[] = [
  { input: 4, output: 310, cacheRead: 12000, cacheWrite: 7000 },
  { input: 1, output: 920, cacheRead: 19000, cacheWrite: 600 },
];

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-ht-hook-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

async function openFeature(root: string): Promise<string> {
  await execa('node', [CLI, 'stage', 'start', 'planning', '--title', 'ord501', '--issue', '501'], {
    cwd: root,
    env: { SE_SESSION: SES },
    reject: false,
  });
  const base = join(root, '.paqad/ledger/feature-evidence');
  const dirs = readdirSync(base).filter((name) => name !== '_session');
  return join(base, dirs[0]!);
}

async function runHook(root: string, payload: Record<string, unknown>) {
  return execa('node', [HOOK], {
    input: JSON.stringify({ session_id: 'sub_ht', hook_event_name: 'SubagentStop', ...payload }),
    env: { PAQAD_PROJECT_ROOT: root },
    reject: false,
  });
}

function stageAgentRows(bundle: string): unknown[] {
  return readFileSync(join(bundle, 'stage-evidence.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { kind?: string })
    .filter((row) => row.kind === 'stage-agent');
}

describe('SubagentStop for a High Table seat (#639 Part 13)', () => {
  it('AC-40: paqad-expert and paqad-chief-architect with agent_transcript_path record exact tokens and no stage-agent row', async () => {
    const root = tempRoot();
    const bundle = await openFeature(root);
    const dir = basename(bundle);
    const transcripts = join(root, 'subagents');
    const expert = writeSeatTranscript(
      transcripts,
      'sec',
      `SE_SESSION=${SES} paqad-ai spec pipeline experts brief security-auditor`,
      USAGE,
    );
    const chief = writeSeatTranscript(
      transcripts,
      'chief',
      `SE_SESSION=${SES} paqad-ai spec pipeline experts context`,
      USAGE,
    );

    const a = await runHook(root, {
      agent_id: 'agent_sec',
      agent_type: 'paqad-expert',
      agent_transcript_path: expert,
    });
    const b = await runHook(root, {
      agent_id: 'agent_chief',
      agent_type: 'paqad:paqad-chief-architect',
      agent_transcript_path: chief,
    });
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);

    const usage = readHighTable(root, dir).filter((row) => row.event === 'usage');
    expect(usage.map((row) => row.role)).toEqual(['security-auditor', 'chief-architect']);
    for (const row of usage) {
      expect(row.tokens_label).toBe('exact');
      expect((row.tokens as { total: number }).total).toBe(fixtureTotal(USAGE));
      expect(row.session_id).toBe(SES);
    }
    expect(usage[0]!.tokens).toMatchObject({
      input: 5,
      output: 1230,
      cache_read: 31000,
      cache_write: 7600,
    });
    // Neither seat is a stage: no stage-agent row.
    expect(stageAgentRows(bundle)).toEqual([]);

    const table = buildHighTableView(root, dir, null, 'full')!;
    const seat = table.seats.find((entry) => entry.role === 'security-auditor')!;
    expect(seat.tokens_exact).toBe(true);
    expect(seat.tokens?.total).toBe(fixtureTotal(USAGE));
    expect(table.chief?.tokens_exact).toBe(true);
  });

  it('still writes exactly one stage-agent row for a real stage agent and no usage row', async () => {
    const root = tempRoot();
    const bundle = await openFeature(root);
    const path = writeSeatTranscript(join(root, 'subagents'), 'dev', 'pnpm test', USAGE);
    const result = await runHook(root, {
      agent_id: 'agent_dev',
      agent_type: 'paqad-development',
      transcript_path: path,
      agent_transcript_path: path,
    });
    expect(result.exitCode).toBe(0);
    expect(stageAgentRows(bundle)).toHaveLength(1);
    expect(readHighTable(root, basename(bundle))).toEqual([]);
  });

  it('AC-41: with no subagent transcript the seat keeps its self-reported tokens, labelled estimate', async () => {
    const root = tempRoot();
    const bundle = await openFeature(root);
    const dir = basename(bundle);
    recordWritingRow(root, dir, 'db-expert', { sessionId: SES });
    recordDoneRow(
      root,
      dir,
      { role: 'db-expert', findings: 2, tokens_estimate: 1800 },
      { sessionId: SES },
    );

    const result = await runHook(root, { agent_id: 'agent_db', agent_type: 'paqad-expert' });
    expect(result.exitCode).toBe(0);
    const missing = await runHook(root, {
      agent_id: 'agent_db2',
      agent_type: 'paqad-expert',
      agent_transcript_path: join(root, 'no-such-transcript.jsonl'),
    });
    expect(missing.exitCode).toBe(0);

    expect(readHighTable(root, dir).filter((row) => row.event === 'usage')).toEqual([]);
    const done = readHighTable(root, dir).find((row) => row.event === 'done')!;
    expect(done.tokens_label).toBe('estimate');
    const seat = buildHighTableView(root, dir, null, 'full')!.seats.find(
      (entry) => entry.role === 'db-expert',
    )!;
    expect(seat).toMatchObject({ tokens_estimate: 1800, tokens: null, tokens_exact: false });
    expect(stageAgentRows(bundle)).toEqual([]);
  });

  it('logs a failed usage write to hooks.log and keeps the exit code and output byte-identical', async () => {
    const root = tempRoot();
    const bundle = await openFeature(root);
    const path = writeSeatTranscript(
      join(root, 'subagents'),
      'qa',
      'paqad-ai spec pipeline experts brief qa-engineer',
      USAGE,
    );
    const payload = {
      agent_id: 'agent_qa',
      agent_type: 'paqad-expert',
      agent_transcript_path: path,
    };
    const ok = await runHook(root, payload);

    // A directory where the ledger file should be makes the append fail.
    rmSync(join(bundle, 'high-table.jsonl'), { force: true });
    mkdirSync(join(bundle, 'high-table.jsonl'));
    const failed = await runHook(root, { ...payload, agent_id: 'agent_qa2' });

    expect(failed.exitCode).toBe(ok.exitCode);
    expect(failed.stdout).toBe(ok.stdout);
    const log = join(root, '.paqad/logs/hooks.log');
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, 'utf8')).toMatch(
      /stage-agent-completion: high-table usage not recorded/,
    );
    expect(stageAgentRows(bundle)).toEqual([]);
  });
});
