import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { buildStageReport } from '@/stage-isolation/stage-handback.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const COMPLETION = join(process.cwd(), 'runtime/hooks/stage-agent-completion.mjs');
const SESSION = 'ses_report';
const AGENT = 'agent_report';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-stage-report-'));
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

async function report(root: string, agent = AGENT) {
  const run = await cli(root, ['stage', 'report', agent]);
  return { exitCode: run.exitCode, json: JSON.parse(run.stdout) as Record<string, unknown> };
}

async function stop(root: string, message: string | undefined) {
  await execa('node', [COMPLETION], {
    input: JSON.stringify({
      session_id: SESSION,
      agent_id: AGENT,
      agent_type: 'paqad-planning',
      hook_event_name: 'SubagentStop',
      agent_transcript_path: '/nowhere/agent.jsonl',
      last_assistant_message: message,
    }),
    env: { PAQAD_PROJECT_ROOT: root },
    reject: false,
  });
}

async function endPlanning(root: string): Promise<void> {
  const plan = join(bundleDir(root), 'plan.json');
  writeFileSync(plan, '{}\n');
  await cli(root, ['stage', 'end', 'planning', '--artifact', plan]);
}

async function openPlanning(root: string): Promise<void> {
  await cli(root, ['stage', 'start', 'planning', '--title', 'report', '--issue', '1']);
}

const row = (fields: Record<string, unknown>): SessionLedgerRow =>
  ({ agent_id: AGENT, stage: 'planning', content_hash: 'h', ...fields }) as SessionLedgerRow;

describe('a stage agent running the brief command line', () => {
  it('AC-6: writes its own name on the end row', async () => {
    const root = tempRoot();
    await cli(root, ['stage', 'start', 'review', '--title', 'agent', '--issue', '1']);
    await cli(root, ['stage', 'end', 'review', '--agent', 'paqad-review']);
    const rows = readFileSync(join(bundleDir(root), 'stage-evidence.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows.find((row) => row.kind === 'stage_end')?.agent).toBe('paqad-review');
  });
});

describe('paqad-ai stage report', () => {
  it('AC-5: prints the JSON object for a finished agent', async () => {
    const root = tempRoot();
    await openPlanning(root);
    await endPlanning(root);
    await stop(root, 'Status: DONE');
    const { exitCode, json } = await report(root);
    expect(exitCode).toBe(0);
    expect(json).toMatchObject({
      agent_id: AGENT,
      stage: 'planning',
      report_status: 'DONE',
      advance: true,
      decision: null,
      report_source: 'text',
      resume_advice: 'resume',
    });
    expect(json).toHaveProperty('reason');
    expect(json).toHaveProperty('tokens_not_recarried');
  });

  it('AC-5, AC-57: flips to dispatch-fresh above 150,000 tokens, and stays resume at the boundary', () => {
    const completed = (tokens: number) =>
      row({
        kind: 'stage-agent',
        event_status: 'completed',
        report_status: 'DONE',
        report_stated: true,
        advance: true,
        report_source: 'text',
        tokens_not_recarried: tokens,
      });
    expect(buildStageReport([completed(150_000)], AGENT)?.resume_advice).toBe('resume');
    expect(buildStageReport([completed(150_001)], AGENT)?.resume_advice).toBe('dispatch-fresh');
  });

  describe('a return with no Status line', () => {
    const noClaim = (stage: string, extra: Record<string, unknown> = {}) => [
      row({ kind: 'stage_start', stage }),
      row({ kind: 'stage_end', stage, artifact_digest: 'd', artifact_paths: [`x/${stage}.json`] }),
      row({
        kind: 'stage-agent',
        stage,
        event_status: 'completed',
        report_status: 'BLOCKED',
        report_stated: false,
        report_source: 'none',
        advance: false,
        ...extra,
      }),
    ];

    it('AC-23: reads as done when the end row is there and nothing is wrong', () => {
      const report = buildStageReport(noClaim('review'), AGENT, { checksRed: () => false });
      expect(report).toMatchObject({ report_status: 'DONE', advance: true });
    });

    it('AC-22: does not advance on red checks', () => {
      const report = buildStageReport(noClaim('checks'), AGENT, {
        checksRed: (stage) => stage === 'checks',
      });
      expect(report?.advance).toBe(false);
      expect(report?.reason).toContain('the checks are red');
      expect(report?.next_action).toContain('stop and tell the developer');
    });

    it('does not advance on a must-not breach', () => {
      const report = buildStageReport(noClaim('review', { must_not: ['bundle_write'] }), AGENT);
      expect(report?.advance).toBe(false);
      expect(report?.reason).toContain('bundle_write');
    });
  });

  describe('next_action', () => {
    it('says to wait for an agent still running', () => {
      const report = buildStageReport(
        [row({ kind: 'stage-agent', event_status: 'started' })],
        AGENT,
      );
      expect(report?.next_action).toBe('wait for the agent to return');
    });

    it('says to wait for an agent whose handback was sent back', () => {
      const report = buildStageReport(
        [
          row({
            kind: 'stage-handback',
            event_status: 'denied',
            report_status: 'DONE',
            report_stated: true,
            report_source: 'handback',
            advance: false,
            reason: 'no end row',
          }),
        ],
        AGENT,
      );
      expect(report?.next_action).toContain('wait for the agent');
    });

    it('says to resume with the answer once the paused decision is resolved', () => {
      const paused = [
        row({
          kind: 'stage-agent',
          event_status: 'completed',
          report_status: 'BLOCKED',
          report_stated: true,
          report_source: 'text',
          decision: 'D-1',
          advance: false,
        }),
      ];
      expect(buildStageReport(paused, AGENT)?.next_action).toContain('present the decision D-1');
      expect(buildStageReport(paused, AGENT, { decisionAnswered: () => true })?.next_action).toBe(
        'resume the agent with the answer to D-1',
      );
    });
  });

  it('AC-57: exits 1 with JSON for an unknown agent id', async () => {
    const root = tempRoot();
    await openPlanning(root);
    const { exitCode, json } = await report(root, 'never_seen');
    expect(exitCode).toBe(1);
    expect(json).toMatchObject({ agent_id: 'never_seen', advance: false });
    expect(String(json.reason)).toContain('never_seen');
  });

  it('answers with JSON when no change is active or the ledger cannot be read', async () => {
    const empty = tempRoot();
    const none = await report(empty);
    expect(none.exitCode).toBe(1);
    expect(none.json.advance).toBe(false);

    const broken = tempRoot();
    await openPlanning(broken);
    const file = join(bundleDir(broken), 'stage-evidence.jsonl');
    rmSync(file);
    mkdirSync(file);
    const unread = await report(broken);
    expect(unread.json.advance).toBe(false);
    expect(String(unread.json.reason)).not.toBe('');
  });

  it('AC-57: reads an agent still running as not yet known, and a row with no token figure as resume', () => {
    const report = buildStageReport([row({ kind: 'stage-agent', event_status: 'started' })], AGENT);
    expect(report).toMatchObject({
      report_status: 'UNKNOWN',
      advance: false,
      tokens_not_recarried: null,
      resume_advice: 'resume',
    });
  });

  it('reads a row written by the old parser as legacy, never as a real BLOCKED', () => {
    const report = buildStageReport(
      [
        row({
          kind: 'stage-agent',
          event_status: 'completed',
          report_status: 'BLOCKED',
          report_stated: false,
          advance: false,
        }),
      ],
      AGENT,
    );
    expect(report).toMatchObject({
      report_status: 'UNKNOWN',
      advance: null,
      report_source: 'legacy',
    });
  });

  it('AC-18, AC-19, AC-20: names the missing artifact after a plain text DONE used its refusals', async () => {
    const root = tempRoot();
    await openPlanning(root);
    for (let attempt = 0; attempt < 4; attempt += 1) await stop(root, 'Status: DONE');
    const { json } = await report(root);
    expect(json).toMatchObject({ report_status: 'BLOCKED', advance: false });
    expect(String(json.reason)).toContain('refused 3 times');
    expect(String(json.reason)).toContain('paqad-ai stage end planning');
  });

  it('reads no Status line with its end row and artifact as completed', async () => {
    const root = tempRoot();
    await openPlanning(root);
    await endPlanning(root);
    await stop(root, 'I finished but forgot the line.');
    const { json } = await report(root);
    expect(json).toMatchObject({ report_status: 'DONE', advance: true, report_source: 'none' });
  });

  it('AC-21: gives a next action for a run with no report and no end row', async () => {
    const root = tempRoot();
    await openPlanning(root);
    await stop(root, undefined);
    const { json } = await report(root);
    expect(json).toMatchObject({ report_source: 'none', advance: false });
    expect(String(json.next_action)).toContain('resume the agent once');
  });

  it('keeps a red checks report from advancing', () => {
    const report = buildStageReport(
      [
        row({
          stage: 'checks',
          kind: 'stage-agent',
          event_status: 'completed',
          report_status: 'DONE_WITH_CONCERNS',
          report_stated: true,
          report_source: 'text',
          advance: false,
        }),
      ],
      AGENT,
    );
    expect(report).toMatchObject({ report_status: 'DONE_WITH_CONCERNS', advance: false });
  });

  it('prints the decision of a paused stage as what to present', () => {
    const report = buildStageReport(
      [
        row({
          kind: 'stage-handback',
          event_status: 'completed',
          report_status: 'BLOCKED',
          report_stated: true,
          report_source: 'handback',
          advance: false,
          decision: 'D-01ABC',
        }),
      ],
      AGENT,
    );
    expect(report?.decision).toBe('D-01ABC');
    expect(report?.next_action).toContain('D-01ABC');
  });
});
