import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { PAQAD_STAGE_HELPER_MATCHER } from '@/adapters/shared/paqad-hooks.js';
import { readStageReportStatus } from '@/stage-isolation/stage-agents.js';

const HOOK = join(process.cwd(), 'runtime/hooks/stage-agent-handback.mjs');
const CLI = join(process.cwd(), 'dist/cli/index.js');
const SESSION = 'ses_handback';
const AGENT = 'agent_handback';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()!;
    try {
      chmodSync(bundleDir(root), 0o755);
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-handback-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '/nowhere\n');
  return root;
}

async function cli(root: string, args: string[], agentId = AGENT) {
  return execa('node', [CLI, ...args], {
    cwd: root,
    env: { SE_SESSION: SESSION, SE_AGENT_ID: agentId },
    reject: false,
  });
}

async function openChange(root: string, stage = 'planning', agentId = AGENT): Promise<void> {
  await cli(root, ['stage', 'start', stage, '--title', 'handback', '--issue', '1'], agentId);
}

function bundleDir(root: string): string {
  const base = join(root, '.paqad/ledger/feature-evidence');
  return join(base, readdirSync(base).filter((name) => name !== '_session')[0]!);
}

function ledger(root: string): Array<Record<string, unknown>> {
  return readFileSync(join(bundleDir(root), 'stage-evidence.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function handbackRows(root: string): Array<Record<string, unknown>> {
  return ledger(root).filter((row) => row.kind === 'stage-handback');
}

function handback(message: string, overrides: Record<string, unknown> = {}) {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/hooks/claude/subagent-handback.json'), 'utf8'),
  ) as Record<string, unknown>;
  return {
    ...fixture,
    session_id: SESSION,
    agent_id: AGENT,
    agent_type: 'paqad-planning',
    tool_input: { message },
    ...overrides,
  };
}

async function runHook(root: string, payload: unknown, env: Record<string, string> = {}) {
  return execa('node', [HOOK], {
    input: JSON.stringify(payload),
    env: { PAQAD_PROJECT_ROOT: root, ...env },
    reject: false,
  });
}

async function endWithPlanArtifact(root: string): Promise<void> {
  const plan = join(bundleDir(root), 'plan.json');
  writeFileSync(plan, '{}\n');
  await cli(root, ['stage', 'end', 'planning', '--artifact', plan]);
}

describe('stage-agent-handback.mjs', () => {
  it('refuses DONE with no plan digest, naming the command, and passes after the end row', async () => {
    const root = tempRoot();
    await openChange(root);
    const refused = await runHook(root, handback('Status: DONE'));
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain('planning ended without its artifact');
    expect(refused.stderr).toContain('--agent paqad-planning');
    expect(handbackRows(root)).toMatchObject([
      {
        event_status: 'denied',
        stage: 'planning',
        report_source: 'handback',
        stated_status: 'DONE',
      },
    ]);
    await endWithPlanArtifact(root);
    const passed = await runHook(root, handback('Status: DONE', { tool_use_id: 'toolu_second' }));
    expect(passed.exitCode).toBe(0);
    expect(handbackRows(root).at(-1)).toMatchObject({
      event_status: 'completed',
      report_status: 'DONE',
      report_stated: true,
      advance: true,
      report_source: 'handback',
    });
  });

  it('passes a development DONE with a stage end row and no artifact', async () => {
    const root = tempRoot();
    await openChange(root, 'development');
    await cli(root, ['stage', 'end', 'development']);
    const result = await runHook(
      root,
      handback('Status: DONE', { agent_type: 'paqad-development' }),
    );
    expect(result.exitCode).toBe(0);
    expect(handbackRows(root).at(-1)).toMatchObject({
      stage: 'development',
      event_status: 'completed',
      advance: true,
    });
  });

  it.each([
    ['Status: NEEDS_CONTEXT\nI need the spec', 'NEEDS_CONTEXT', null],
    ['Status: BLOCKED', 'BLOCKED', null],
    ['Status: BLOCKED\npaused: D-01ABC', 'BLOCKED', 'D-01ABC'],
    ['paused: D-01ABC\nStatus: DONE', 'DONE', 'D-01ABC'],
  ])('passes %j with no artifact and keeps the status and decision', async (msg, status, id) => {
    const root = tempRoot();
    await openChange(root);
    expect((await runHook(root, handback(msg))).exitCode).toBe(0);
    expect(handbackRows(root).at(-1)).toMatchObject({
      event_status: 'completed',
      report_status: status,
      decision: id,
      advance: false,
    });
  });

  it('stands down when the other route owns the session and writes no row', async () => {
    const root = tempRoot();
    await openChange(root);
    const markerDir = join(root, '.paqad/session/plugin-active.d');
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(
      join(markerDir, SESSION),
      JSON.stringify({ at: new Date().toISOString(), root: tempRoot() }),
    );
    const result = await runHook(root, handback('Status: DONE'));
    expect(result.exitCode).toBe(0);
    expect(handbackRows(root)).toEqual([]);
  });

  it('refuses three times, lets the fourth through as BLOCKED, and counts per agent', async () => {
    const root = tempRoot();
    await openChange(root);
    for (const id of ['t1', 't2', 't3']) {
      const refused = await runHook(root, handback('Status: DONE', { tool_use_id: id }));
      expect(refused.exitCode).toBe(2);
    }
    expect(handbackRows(root).filter((row) => row.event_status === 'denied')).toHaveLength(3);
    const fourth = await runHook(root, handback('Status: DONE', { tool_use_id: 't4' }));
    expect(fourth.exitCode).toBe(0);
    const last = handbackRows(root).at(-1)!;
    expect(last).toMatchObject({
      event_status: 'completed',
      report_status: 'BLOCKED',
      advance: false,
      stated_status: 'DONE',
    });
    expect(String(last.reason)).toMatch(/^refused 3 times: planning ended without its artifact/);

    const other = tempRoot();
    await openChange(other, 'planning', 'agent_other');
    const first = await runHook(
      other,
      handback('Status: DONE', { agent_id: 'agent_other', tool_use_id: 't1' }),
    );
    expect(first.exitCode).toBe(2);
    await runHook(
      other,
      handback('Status: NEEDS_CONTEXT', { agent_id: 'agent_other', tool_use_id: 't2' }),
    );
    expect(handbackRows(other).filter((row) => row.event_status === 'denied')).toHaveLength(1);
  });

  it('AC-40: keeps a row for each fast identical retry and still reaches the ceiling', async () => {
    const root = tempRoot();
    await openChange(root);
    const exits: number[] = [];
    for (const id of ['r1', 'r2', 'r3', 'r4']) {
      const run = await runHook(root, handback('Status: DONE', { tool_use_id: id }));
      exits.push(run.exitCode ?? -1);
    }
    expect(exits).toEqual([2, 2, 2, 0]);
    expect(handbackRows(root)).toHaveLength(4);
    expect(handbackRows(root).at(-1)).toMatchObject({ report_status: 'BLOCKED' });
  });

  it('exits 0 and logs when the bundle cannot be read', async () => {
    const root = tempRoot();
    await openChange(root);
    rmSync(join(bundleDir(root), 'stage-evidence.jsonl'));
    mkdirSync(join(bundleDir(root), 'stage-evidence.jsonl'));
    const result = await runHook(root, handback('Status: DONE'));
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, '.paqad/logs/hooks.log'), 'utf8')).toContain(
      'stage-agent-handback: failed',
    );
  });

  it('AC-14: exits 0 and writes no row for an agent outside the helper pattern or with no open row', async () => {
    const root = tempRoot();
    await openChange(root);
    const before = ledger(root).length;
    const outsider = await runHook(root, handback('Status: DONE', { agent_type: 'Explore' }));
    expect(outsider.exitCode).toBe(0);
    const unknown = await runHook(root, handback('Status: DONE', { agent_id: 'never_seen' }));
    expect(unknown.exitCode).toBe(0);
    expect(ledger(root)).toHaveLength(before);
  });

  it('passes an expert seat with no stage and writes no row', async () => {
    const root = tempRoot();
    await openChange(root);
    const before = ledger(root).length;
    const seat = await runHook(root, handback('Status: DONE', { agent_type: 'paqad-expert' }));
    expect(seat.exitCode).toBe(0);
    const plugin = await runHook(
      root,
      handback('Status: DONE', { agent_type: 'paqad:paqad-chief-architect' }),
    );
    expect(plugin.exitCode).toBe(0);
    expect(ledger(root)).toHaveLength(before);
    expect(new RegExp(PAQAD_STAGE_HELPER_MATCHER).test('paqad-expert')).toBe(false);
  });

  it('exits 0 and writes nothing with no active change', async () => {
    const root = tempRoot();
    const result = await runHook(root, handback('Status: DONE'));
    expect(result.exitCode).toBe(0);
  });
});

describe('reading the report', () => {
  it.each([
    ['no status line here', 'BLOCKED', false],
    ['', 'BLOCKED', false],
    ['Status: BLOCKED\nmore work\nStatus: DONE', 'DONE', true],
    ['> Status: BLOCKED\nStatus: DONE', 'DONE', true],
    ['Status: DONE\nThe last agent wrote "Status: BLOCKED" here.', 'DONE', true],
    ['> Status: DONE', 'BLOCKED', false],
    ['Status: FINISHED', 'BLOCKED', false],
    ['status: done', 'BLOCKED', false],
    ['Status: DONE_WITH_CONCERNS', 'DONE_WITH_CONCERNS', true],
    ['**Status: DONE**', 'DONE', true],
    ['```\nStatus: BLOCKED\n```', 'BLOCKED', true],
  ])('%j reads as %s (stated %s)', (text, status, stated) => {
    const reading = readStageReportStatus(text);
    expect(reading.status).toBe(status);
    expect(reading.stated).toBe(stated);
  });

  it('keeps a paused line beside a DONE line', () => {
    expect(readStageReportStatus('Status: DONE\npaused: D-01ABC')).toMatchObject({
      status: 'DONE',
      decision: 'D-01ABC',
    });
  });
});
