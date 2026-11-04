import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { liveStageAgents } from '@/stage-evidence/stage-agent-holds.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

const COMPLETION = join(process.cwd(), 'runtime/hooks/stage-agent-completion.mjs');
const HANDBACK = join(process.cwd(), 'runtime/hooks/stage-agent-handback.mjs');
const CLI = join(process.cwd(), 'dist/cli/index.js');
const SESSION = 'ses_back';
const AGENT = 'agent_back';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-send-back-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '/nowhere\n');
  return root;
}

async function cli(root: string, args: string[]) {
  return execa('node', [CLI, ...args], {
    cwd: root,
    env: { SE_SESSION: SESSION, SE_AGENT_ID: AGENT },
    reject: false,
  });
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

function stopPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const parsed = JSON.parse(
    readFileSync(
      join(process.cwd(), 'tests/fixtures/hooks/claude/subagent-stop-text.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;
  return {
    ...parsed,
    session_id: SESSION,
    agent_id: AGENT,
    agent_type: 'paqad-planning',
    transcript_path: '/nowhere/parent.jsonl',
    agent_transcript_path: '/nowhere/agent.jsonl',
    last_assistant_message: 'all good\nStatus: DONE',
    ...overrides,
  };
}

async function stop(root: string, payload: unknown, argv: string[] = []) {
  return execa('node', [COMPLETION, ...argv], {
    input: JSON.stringify(payload),
    env: { PAQAD_PROJECT_ROOT: root },
    reject: false,
  });
}

async function handback(root: string, id: string) {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/hooks/claude/subagent-handback.json'), 'utf8'),
  ) as Record<string, unknown>;
  return execa('node', [HANDBACK], {
    input: JSON.stringify({
      ...fixture,
      session_id: SESSION,
      agent_id: AGENT,
      tool_use_id: id,
      tool_input: { message: 'Status: DONE' },
    }),
    env: { PAQAD_PROJECT_ROOT: root },
    reject: false,
  });
}

async function openPlanning(root: string): Promise<void> {
  await cli(root, ['stage', 'start', 'planning', '--title', 'back', '--issue', '1']);
}

function denied(root: string) {
  return ledger(root).filter(
    (row) => row.kind === 'stage-handback' && row.event_status === 'denied',
  );
}

function completed(root: string) {
  return ledger(root).filter(
    (row) => row.kind === 'stage-agent' && row.event_status === 'completed',
  );
}

describe('the stop check sends an unfinished stage back', () => {
  it('blocks a plain text DONE with no artifact, writes no completed row, keeps the hold', async () => {
    const root = tempRoot();
    await openPlanning(root);
    const startRow = {
      ...stopPayload(),
      hook_event_name: 'SubagentStart',
    };
    await execa('node', [join(process.cwd(), 'runtime/hooks/stage-agent-start.mjs')], {
      input: JSON.stringify(startRow),
      env: { PAQAD_PROJECT_ROOT: root },
      reject: false,
    });
    const result = await stop(root, stopPayload());
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as { decision: string; reason: string };
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('planning ended without its artifact');
    expect(denied(root)).toMatchObject([{ report_source: 'text', stated_status: 'DONE' }]);
    expect(completed(root)).toEqual([]);
    const live = liveStageAgents(ledger(root) as unknown as SessionLedgerRow[]);
    expect(live.map((agent) => agent.agentId)).toContain(AGENT);
  });

  it('shares the count with the handback path and lets the fourth attempt through as BLOCKED', async () => {
    const root = tempRoot();
    await openPlanning(root);
    expect((await handback(root, 'h1')).exitCode).toBe(2);
    expect((await handback(root, 'h2')).exitCode).toBe(2);
    const third = await stop(root, stopPayload());
    expect(JSON.parse(third.stdout)).toMatchObject({ decision: 'block' });
    const fourth = await stop(root, stopPayload());
    expect(fourth.stdout).toBe('');
    expect(completed(root)).toHaveLength(1);
    expect(completed(root)[0]).toMatchObject({
      report_status: 'BLOCKED',
      stated_status: 'DONE',
      advance: false,
    });
    expect(String(completed(root)[0]!.reason)).toContain('refused 3 times');
  });

  it('does not judge a stop the handback already let through', async () => {
    const root = tempRoot();
    await openPlanning(root);
    for (const id of ['h1', 'h2', 'h3']) await handback(root, id);
    expect((await handback(root, 'h4')).exitCode).toBe(0);
    const result = await stop(root, stopPayload({ last_assistant_message: undefined }));
    expect(result.stdout).toBe('');
    expect(completed(root)[0]).toMatchObject({
      report_status: 'BLOCKED',
      report_source: 'handback',
    });
  });

  it('judges again after a refused handback: the work done passes as text', async () => {
    const root = tempRoot();
    await openPlanning(root);
    await handback(root, 'h1');
    const plan = join(bundleDir(root), 'plan.json');
    writeFileSync(plan, '{}\n');
    await cli(root, ['stage', 'end', 'planning', '--artifact', plan]);
    const result = await stop(root, stopPayload());
    expect(result.stdout).toBe('');
    expect(completed(root)[0]).toMatchObject({
      report_status: 'DONE',
      report_source: 'text',
      advance: true,
    });
  });

  it('restarts the count on a resume, still refusing until the requirement is met', async () => {
    const root = tempRoot();
    await openPlanning(root);
    for (const id of ['h1', 'h2', 'h3']) await handback(root, id);
    await handback(root, 'h4');
    await stop(root, stopPayload({ last_assistant_message: undefined }));
    expect((await handback(root, 'h5')).exitCode).toBe(2);
  });

  it('judges a resumed agent on its current stage with a fresh count', async () => {
    const root = tempRoot();
    await openPlanning(root);
    const plan = join(bundleDir(root), 'plan.json');
    writeFileSync(plan, '{}\n');
    await cli(root, ['stage', 'end', 'planning', '--artifact', plan]);
    await cli(root, ['stage', 'start', 'specification']);
    const result = await stop(root, stopPayload());
    expect(JSON.parse(result.stdout).reason).toContain('specification ended without its artifact');
  });

  it('does not send back a report with no Status line, a seat, or Codex', async () => {
    const root = tempRoot();
    await openPlanning(root);
    const noStatus = await stop(root, stopPayload({ last_assistant_message: 'no line here' }));
    expect(noStatus.stdout).toBe('');
    const other = tempRoot();
    await openPlanning(other);
    const seat = await stop(other, stopPayload({ agent_type: 'paqad-expert' }));
    expect(seat.stdout).toBe('');
    const codex = await stop(other, stopPayload(), ['codex-cli']);
    expect(codex.stdout).toBe('');
  });

  it('lets the agent stop when the check cannot read the ledger, and logs it', async () => {
    const root = tempRoot();
    await openPlanning(root);
    const file = join(bundleDir(root), 'stage-evidence.jsonl');
    rmSync(file);
    mkdirSync(file);
    const result = await stop(root, stopPayload());
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, '.paqad/logs/hooks.log'), 'utf8')).toContain(
      'send-back check failed',
    );
  });

  it('writes nothing with no active change', async () => {
    const root = tempRoot();
    const result = await stop(root, stopPayload());
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(0);
  });
});
