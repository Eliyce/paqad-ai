import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const COMPLETION = join(process.cwd(), 'runtime/hooks/stage-agent-completion.mjs');
const HANDBACK = join(process.cwd(), 'runtime/hooks/stage-agent-handback.mjs');
const CLI = join(process.cwd(), 'dist/cli/index.js');
const SESSION = 'ses_source';
const AGENT = 'agent_source';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-report-source-'));
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

function completedRow(root: string): Record<string, unknown> {
  return ledger(root)
    .filter((row) => row.kind === 'stage-agent' && row.event_status === 'completed')
    .at(-1)!;
}

async function openAndEndPlanning(root: string): Promise<void> {
  await cli(root, ['stage', 'start', 'planning', '--title', 'source', '--issue', '1']);
  const plan = join(bundleDir(root), 'plan.json');
  writeFileSync(plan, '{}\n');
  await cli(root, ['stage', 'end', 'planning', '--artifact', plan]);
}

function fixture(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const parsed = JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/hooks/claude', name), 'utf8'),
  ) as Record<string, unknown>;
  return {
    ...parsed,
    session_id: SESSION,
    agent_id: AGENT,
    transcript_path: '/nowhere/parent.jsonl',
    agent_transcript_path: '/nowhere/agent.jsonl',
    ...overrides,
  };
}

async function hook(file: string, root: string, payload: unknown, argv: string[] = []) {
  return execa('node', [file, ...argv], {
    input: JSON.stringify(payload),
    env: { PAQAD_PROJECT_ROOT: root },
    reject: false,
  });
}

function agentTranscript(root: string, lines: unknown[]): string {
  const path = join(root, 'agent.jsonl');
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n'));
  return path;
}

function assistant(content: unknown): Record<string, unknown> {
  return { type: 'assistant', message: { role: 'assistant', content } };
}

describe('where the completed row reads its report from', () => {
  it('copies the handback row from the live fixtures', async () => {
    const root = tempRoot();
    await openAndEndPlanning(root);
    const pass = await hook(HANDBACK, root, fixture('subagent-handback.json'));
    expect(pass.exitCode).toBe(0);
    await hook(COMPLETION, root, fixture('subagent-stop.json'));
    expect(completedRow(root)).toMatchObject({
      report_status: 'DONE',
      report_stated: true,
      advance: true,
      report_source: 'handback',
      gate_checked: true,
    });
  });

  it('reads the final message in default mode, with the requirement met', async () => {
    const root = tempRoot();
    await openAndEndPlanning(root);
    await hook(COMPLETION, root, fixture('subagent-stop-text.json'));
    expect(completedRow(root)).toMatchObject({
      report_status: 'DONE',
      report_source: 'text',
      advance: true,
    });
  });

  it('writes source none when there is no report anywhere and logs it', async () => {
    const root = tempRoot();
    await openAndEndPlanning(root);
    await hook(COMPLETION, root, fixture('subagent-stop.json'));
    expect(completedRow(root)).toMatchObject({
      report_source: 'none',
      report_stated: false,
      advance: false,
    });
    expect(readFileSync(join(root, '.paqad/logs/hooks.log'), 'utf8')).toContain('no report found');
  });

  it('does not let a Status line quoted earlier win when the final message has none', async () => {
    const root = tempRoot();
    await openAndEndPlanning(root);
    const path = agentTranscript(root, [assistant('He wrote:\nStatus: DONE\n')]);
    await hook(
      COMPLETION,
      root,
      fixture('subagent-stop-text.json', {
        agent_transcript_path: path,
        last_assistant_message: 'Out of ideas.',
      }),
    );
    expect(completedRow(root)).toMatchObject({ report_source: 'none', report_stated: false });
  });

  it('AC-79: reads a handback from the transcript when the hook crashed, and says the gate did not run', async () => {
    const root = tempRoot();
    await openAndEndPlanning(root);
    const path = agentTranscript(root, [
      assistant([
        {
          type: 'tool_use',
          id: 'toolu_crash',
          name: 'SubagentHandback',
          input: { message: 'done\nStatus: DONE' },
        },
      ]),
    ]);
    await hook(COMPLETION, root, fixture('subagent-stop.json', { agent_transcript_path: path }));
    expect(completedRow(root)).toMatchObject({
      report_status: 'DONE',
      report_source: 'handback',
      gate_checked: false,
      advance: true,
    });
  });

  it('never reads a Status line from another tool input as the report', async () => {
    const root = tempRoot();
    await openAndEndPlanning(root);
    const path = agentTranscript(root, [
      assistant([
        { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'echo "Status: DONE"' } },
      ]),
    ]);
    await hook(COMPLETION, root, fixture('subagent-stop.json', { agent_transcript_path: path }));
    expect(completedRow(root)).toMatchObject({ report_source: 'none', report_stated: false });
  });

  it('keeps advance false on red checks, whatever the Status line says', async () => {
    const root = tempRoot();
    await cli(root, ['stage', 'start', 'checks', '--title', 'red', '--issue', '1']);
    const checks = join(bundleDir(root), 'checks.json');
    writeFileSync(checks, JSON.stringify({ passed: false, results: [] }));
    await cli(root, ['stage', 'end', 'checks', '--artifact', checks]);
    await hook(
      COMPLETION,
      root,
      fixture('subagent-stop-text.json', {
        agent_type: 'paqad-checks',
        last_assistant_message: 'a check failed\nStatus: DONE_WITH_CONCERNS',
      }),
    );
    expect(completedRow(root)).toMatchObject({
      report_status: 'DONE_WITH_CONCERNS',
      advance: false,
    });
  });

  it('names the rollout on Codex, and asks for no handback there', async () => {
    const root = tempRoot();
    await openAndEndPlanning(root);
    const path = agentTranscript(root, [assistant('finished\nStatus: DONE')]);
    await hook(COMPLETION, root, fixture('subagent-stop.json', { agent_transcript_path: path }), [
      'codex-cli',
    ]);
    expect(completedRow(root)).toMatchObject({ report_status: 'DONE', report_source: 'rollout' });
  });

  it('names the turn limit when a run ends with no report at its limit', async () => {
    const root = tempRoot();
    await cli(root, ['stage', 'start', 'checks', '--title', 'limit', '--issue', '1']);
    const usage = { input_tokens: 1, output_tokens: 1 };
    const turns = Array.from({ length: 20 }, (_, index) => ({
      type: 'assistant',
      message: { id: `m${index}`, role: 'assistant', model: 'm', usage, content: 'working' },
    }));
    const path = agentTranscript(root, turns);
    await hook(
      COMPLETION,
      root,
      fixture('subagent-stop.json', { agent_type: 'paqad-checks', agent_transcript_path: path }),
    );
    expect(completedRow(root)).toMatchObject({ report_source: 'none', api_turns: 20 });
    expect(String(completedRow(root).reason)).toContain('turn limit of 20');
  });

  it('records the API turns from the agent transcript', async () => {
    const root = tempRoot();
    await openAndEndPlanning(root);
    const usage = { input_tokens: 1, output_tokens: 1 };
    const turn = (id: string) => ({
      type: 'assistant',
      message: { id, role: 'assistant', model: 'm', usage, content: 'x' },
    });
    const path = agentTranscript(root, [turn('m1'), turn('m2')]);
    await hook(
      COMPLETION,
      root,
      fixture('subagent-stop-text.json', { agent_transcript_path: path }),
    );
    expect(completedRow(root)).toMatchObject({ api_turns: 2 });
  });
});
