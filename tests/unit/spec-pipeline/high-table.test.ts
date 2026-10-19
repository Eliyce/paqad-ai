import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import {
  CHIEF_BUDGET_TOKENS,
  CHIEF_ROLE,
  foldHighTable,
  readHighTable,
  recordHighTableUsage,
  roleFromSubagentTranscript,
} from '@/spec-pipeline/high-table.js';
import { readExperts } from '@/spec-pipeline/run-store.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

import { pinSpecPipelineOff } from '../../shared/spec-pipeline-off.js';
import {
  fixtureTotal,
  ORD_501_ON_CALL,
  ORD_501_REQUEST,
  ORD_501_SEATS,
  seatNote,
  writeSeatTranscript,
  type FixtureUsage,
} from './high-table.fixture.js';

// Issue #639, Part 13: the High Table recorded as it happens: seated, writing and done rows from
// the experts verbs, exact per-seat tokens from the SubagentStop recorder, granted budgets after
// the ceiling, and the chief's fixed budget.

const SES = 'ses_high_table';
const roots: string[] = [];

function tempRoot(ceiling?: number): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-high-table-'));
  roots.push(root);
  pinSpecPipelineOff(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad', '.config'),
    [
      'spec_pipeline_enabled=true',
      'spec_pipeline_experts_enabled=true',
      ...(ceiling === undefined ? [] : [`spec_pipeline_token_ceiling=${ceiling}`]),
    ].join('\n'),
    'utf8',
  );
  return root;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  process.exitCode = 0;
});
beforeEach(() => {
  process.exitCode = 0;
});

function openChange(root: string): string {
  const dir = openFeatureChange(root, SES, {
    adapter: 'claude-code',
    title: 'ORD-501 csv export',
    issue: 'ORD-501',
    lane: 'full',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ1',
  });
  persistLedgerSessionId(root, SES);
  return dir;
}

function writeArtifact(root: string, name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return path;
}

async function run(root: string, args: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void out.push(String(m)));
  vi.spyOn(console, 'error').mockImplementation((m?: unknown) => void err.push(String(m)));
  await createSpecPipelineCommand().parseAsync(
    [...args, '--project-root', root, '--session', SES],
    {
      from: 'user',
    },
  );
  vi.restoreAllMocks();
  return { out, err };
}

async function seatOrd501(root: string): Promise<void> {
  await run(root, ['ground']);
  await run(root, ['label', ORD_501_REQUEST]);
  await run(root, [
    'experts',
    'record',
    writeArtifact(root, 'need.json', { experts: ORD_501_ON_CALL }),
  ]);
}

function rowsOf(root: string, dir: string, event: string): SessionLedgerRow[] {
  return readHighTable(root, dir).filter((row) => row.event === event);
}

const SEAT_USAGE: FixtureUsage[] = [
  { input: 3, output: 120, cacheRead: 4000, cacheWrite: 9000 },
  { input: 2, output: 640, cacheRead: 13000, cacheWrite: 500 },
];

describe('High Table rows from the experts verbs (#639 Part 13)', () => {
  it('AC-43: each seat carries its granted budget after the ceiling, and the chief carries 10000', async () => {
    // 44000 tokens of budgets under a 22000 ceiling: every seat is halved and marked clamped.
    const root = tempRoot(22000);
    const dir = openChange(root);
    await seatOrd501(root);

    const seated = rowsOf(root, dir, 'seated');
    expect(seated.map((row) => row.role)).toEqual([...ORD_501_SEATS, CHIEF_ROLE]);
    const budgets = Object.fromEntries(seated.map((row) => [row.role, row.budget_tokens]));
    expect(budgets).toEqual({
      'security-auditor': 4000,
      'db-expert': 3000,
      'performance-analyst': 3000,
      'product-owner': 2500,
      'application-architect': 4000,
      'user-flow-writer': 2500,
      'qa-engineer': 3000,
      'chief-architect': 10000,
    });
    expect(CHIEF_BUDGET_TOKENS).toBe(10000);
    for (const row of seated) {
      expect(row.clamped).toBe(row.role !== CHIEF_ROLE);
      expect(row.recorded_at).toEqual(expect.any(String));
      expect(row.session_id).toBe(SES);
    }
    // The granted budget is the one on the roster.
    const roster = readExperts(root, dir)!.roster;
    for (const entry of roster) expect(budgets[entry.role]).toBe(entry.budget_tokens);
    const origins = Object.fromEntries(seated.map((row) => [row.role, row.origin]));
    expect(origins['db-expert']).toBe('detector');
    expect(origins['qa-engineer']).toBe('standing');
  });

  it('AC-43: under the ceiling no seat is clamped and each keeps its full budget', async () => {
    const root = tempRoot(100000);
    const dir = openChange(root);
    await seatOrd501(root);
    const seated = rowsOf(root, dir, 'seated');
    expect(seated.every((row) => row.clamped === false)).toBe(true);
    expect(seated.find((row) => row.role === 'security-auditor')?.budget_tokens).toBe(8000);
  });

  it('AC-38: brief appends one writing row, notes appends one done row, the chief gets context and synthesis rows', async () => {
    const root = tempRoot();
    const dir = openChange(root);
    await seatOrd501(root);

    await run(root, ['experts', 'brief', 'db-expert']);
    expect(rowsOf(root, dir, 'writing').map((row) => row.role)).toEqual(['db-expert']);

    // Before any note lands the chief has nothing to read: context records no chief row.
    await run(root, ['experts', 'context']);
    expect(rowsOf(root, dir, 'writing').map((row) => row.role)).toEqual(['db-expert']);

    await run(root, [
      'experts',
      'notes',
      writeArtifact(root, 'db.json', seatNote('db-expert', 1800)),
    ]);
    const done = rowsOf(root, dir, 'done');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      role: 'db-expert',
      findings: 2,
      tokens_estimate: 1800,
      tokens_label: 'estimate',
    });

    await run(root, ['experts', 'context']);
    expect(rowsOf(root, dir, 'writing').map((row) => row.role)).toEqual(['db-expert', CHIEF_ROLE]);

    const synthesis = writeArtifact(root, 'synthesis.json', {
      verdict: 'ready',
      accepted: ['EX-db-expert-1', 'EX-db-expert-2'],
      declined: [],
      conflicts: [],
      gaps: [],
      questions: [],
      tokens: 2600,
    });
    const syn = await run(root, ['experts', 'synthesis', synthesis]);
    expect(syn.err).toEqual([]);
    expect(process.exitCode).toBe(0);
    const chiefDone = rowsOf(root, dir, 'done').filter((row) => row.role === CHIEF_ROLE);
    expect(chiefDone).toHaveLength(1);
    expect(chiefDone[0]).toMatchObject({
      findings: null,
      tokens_estimate: 2600,
      tokens_label: 'estimate',
    });
  });

  it('AC-38: a refused brief records no writing row', async () => {
    const root = tempRoot();
    const dir = openChange(root);
    await seatOrd501(root);
    await run(root, ['experts', 'brief', 'data-modeler']);
    expect(process.exitCode).toBe(1);
    expect(rowsOf(root, dir, 'writing')).toEqual([]);
  });

  it('keeps the verb result when a High Table row cannot be written, saying so on stderr', async () => {
    const root = tempRoot();
    const dir = openChange(root);
    await seatOrd501(root);
    // A directory where the ledger file should be makes every append fail.
    const ledger = join(root, '.paqad/ledger/feature-evidence', dir, 'high-table.jsonl');
    rmSync(ledger, { force: true });
    mkdirSync(ledger);
    const { out, err } = await run(root, ['experts', 'brief', 'db-expert']);
    expect(process.exitCode).toBe(0);
    expect(out[0]).toContain('db-expert');
    expect(err.join('\n')).toMatch(/could not record the High Table writing row/);
  });

  it('AC-37: ORD-501, seven seats move seated, writing, done with times, two write at once, exact tokens from host usage', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let clock = Date.parse('2026-10-19T10:00:00.000Z');
    const tick = (): void => {
      clock += 1000;
      vi.setSystemTime(clock);
    };
    tick();
    const root = tempRoot();
    const dir = openChange(root);
    await seatOrd501(root);
    const transcripts = join(root, 'subagents');

    // All seven seats are dispatched in parallel: every brief runs before the first note lands.
    for (const role of ORD_501_SEATS) {
      tick();
      await run(root, ['experts', 'brief', role]);
    }
    for (const [index, role] of ORD_501_SEATS.entries()) {
      tick();
      await run(root, [
        'experts',
        'notes',
        writeArtifact(root, `${role}.json`, seatNote(role, 1000 + index * 100)),
      ]);
      expect(process.exitCode).toBe(0);
      // The seat's subagent finishes: the SubagentStop recorder reads its own transcript.
      const path = writeSeatTranscript(
        transcripts,
        `seat${index}`,
        `SE_SESSION=${SES} paqad-ai spec pipeline experts brief ${role}`,
        SEAT_USAGE,
      );
      expect(
        recordHighTableUsage({
          projectRoot: root,
          payload: {
            agent_type: 'paqad:paqad-expert',
            agent_id: `agent${index}`,
            agent_transcript_path: path,
          },
        }),
      ).toBe('recorded');
    }

    const seats = foldHighTable(readHighTable(root, dir));
    expect([...seats.keys()]).toEqual([...ORD_501_SEATS, CHIEF_ROLE]);
    for (const role of ORD_501_SEATS) {
      const seat = seats.get(role)!;
      expect(seat.state).toBe('done');
      expect(seat.seated_at).not.toBeNull();
      expect(seat.started_at).not.toBeNull();
      expect(seat.done_at).not.toBeNull();
      expect(Date.parse(seat.seated_at!)).toBeLessThan(Date.parse(seat.started_at!));
      expect(Date.parse(seat.started_at!)).toBeLessThan(Date.parse(seat.done_at!));
      expect(seat.tokens?.total).toBe(fixtureTotal(SEAT_USAGE));
      expect(seat.tokens!.total).toBeGreaterThan(0);
    }
    // At least two seats were writing at the same time: one started before another finished.
    const first = seats.get(ORD_501_SEATS[0]!)!;
    const second = seats.get(ORD_501_SEATS[1]!)!;
    expect(Date.parse(second.started_at!)).toBeLessThan(Date.parse(first.done_at!));
    const overlapping = ORD_501_SEATS.filter(
      (role) => Date.parse(seats.get(role)!.started_at!) < Date.parse(first.done_at!),
    );
    expect(overlapping.length).toBeGreaterThanOrEqual(2);
    // Thirteen findings across the seven seats, every note kept.
    expect(readExperts(root, dir)!.findings).toHaveLength(13);
    expect(seats.get(CHIEF_ROLE)!.state).toBe('seated');
  });
});

describe('the SubagentStop usage recorder (#639 Part 13)', () => {
  it('reads the role from the seat transcript, and the chief from its agent name', async () => {
    const root = tempRoot();
    const dir = openChange(root);
    const transcripts = join(root, 'subagents');
    const expert = writeSeatTranscript(
      transcripts,
      'sec',
      'paqad-ai spec pipeline experts brief security-auditor',
      SEAT_USAGE,
    );
    expect(roleFromSubagentTranscript(expert)).toBe('security-auditor');
    const chief = writeSeatTranscript(
      transcripts,
      'chief',
      'paqad-ai spec pipeline experts context',
      SEAT_USAGE,
    );
    expect(roleFromSubagentTranscript(chief)).toBeNull();
    expect(
      recordHighTableUsage({
        projectRoot: root,
        payload: {
          agent_type: 'paqad-chief-architect',
          agent_id: 'c1',
          agent_transcript_path: chief,
        },
      }),
    ).toBe('recorded');
    const usage = rowsOf(root, dir, 'usage');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ role: CHIEF_ROLE, agent_id: 'c1', tokens_label: 'exact' });
    expect(
      (usage[0]!.by_model as Record<string, { total: number }>)['claude-opus-5-5']!.total,
    ).toBe(fixtureTotal(SEAT_USAGE));
  });

  it('writes nothing for a stage agent, a missing or empty transcript, an unknown role, or no change', () => {
    const root = tempRoot();
    const transcripts = join(root, 'subagents');
    const good = writeSeatTranscript(
      transcripts,
      'qa',
      'paqad-ai spec pipeline experts brief qa-engineer',
      SEAT_USAGE,
    );
    expect(
      recordHighTableUsage({
        projectRoot: root,
        payload: { agent_type: 'paqad-expert', agent_transcript_path: good },
      }),
    ).toBe('no-feature');
    const dir = openChange(root);
    const noBrief = writeSeatTranscript(transcripts, 'nobrief', 'ls', SEAT_USAGE);
    const badRole = writeSeatTranscript(
      transcripts,
      'bad',
      'paqad-ai spec pipeline experts brief chief-of-staff',
      SEAT_USAGE,
    );
    const empty = writeSeatTranscript(transcripts, 'empty', 'ls', []);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ agent_type: 'paqad-development', agent_transcript_path: good }, 'not-high-table'],
      [{ agent_type: 7, agent_transcript_path: good }, 'not-high-table'],
      [{ agent_type: 'paqad-expert' }, 'no-transcript'],
      [{ agent_type: 'paqad-expert', agent_transcript_path: '  ' }, 'no-transcript'],
      [
        { agent_type: 'paqad-expert', agent_transcript_path: join(root, 'missing.jsonl') },
        'no-usage',
      ],
      [{ agent_type: 'paqad-expert', agent_transcript_path: empty }, 'no-usage'],
      [{ agent_type: 'paqad-expert', agent_transcript_path: noBrief }, 'no-role'],
      [{ agent_type: 'paqad-expert', agent_transcript_path: badRole }, 'no-role'],
    ];
    for (const [payload, outcome] of cases) {
      expect(recordHighTableUsage({ projectRoot: root, payload })).toBe(outcome);
    }
    expect(readHighTable(root, dir)).toEqual([]);
  });

  it('counts one subagent once when its SubagentStop fires twice, and sums two runs of one seat', () => {
    const root = tempRoot();
    const dir = openChange(root);
    const path = writeSeatTranscript(
      join(root, 'subagents'),
      'db',
      'paqad-ai spec pipeline experts brief db-expert',
      SEAT_USAGE,
    );
    const payload = { agent_type: 'paqad-expert', agent_id: 'a1', agent_transcript_path: path };
    recordHighTableUsage({ projectRoot: root, payload });
    recordHighTableUsage({ projectRoot: root, payload });
    recordHighTableUsage({ projectRoot: root, payload: { ...payload, agent_id: 'a2' } });
    const seat = foldHighTable(readHighTable(root, dir)).get('db-expert')!;
    expect(seat.tokens?.total).toBe(2 * fixtureTotal(SEAT_USAGE));
    // Usage alone never moves a seat's state.
    expect(seat.state).toBeNull();
  });
});

describe('foldHighTable', () => {
  const row = (event: string, role: unknown, at: string, extra: Record<string, unknown> = {}) =>
    ({ event, role, recorded_at: at, ...extra }) as unknown as SessionLedgerRow;

  it('starts a seat over on a new seated row, and ignores rows with no role or an unknown event', () => {
    const seats = foldHighTable([
      row('seated', 'qa-engineer', 't1', {
        budget_tokens: 6000,
        clamped: false,
        origin: 'standing',
      }),
      row('writing', 'qa-engineer', 't2'),
      row('done', 'qa-engineer', 't3', { findings: 2, tokens_estimate: 900 }),
      row('seated', 'qa-engineer', 't4', { budget_tokens: 3000, clamped: true, reason: 'redo' }),
      row('writing', null, 't5'),
      row('mystery', 'qa-engineer', 't6'),
      row('usage', 'qa-engineer', 't7', { tokens: 'not an object' }),
      { event: 'writing', role: 'db-expert', ts: 'legacy' } as unknown as SessionLedgerRow,
    ]);
    expect(seats.get('qa-engineer')).toMatchObject({
      state: 'seated',
      seated_at: 't4',
      started_at: null,
      done_at: null,
      budget_tokens: 3000,
      clamped: true,
      reason: 'redo',
      findings: null,
      tokens: null,
    });
    expect(seats.get('db-expert')).toMatchObject({ state: 'writing', started_at: 'legacy' });
  });
});
