import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import {
  cliCommandRunner,
  fitToCeiling,
  runStageBegin,
  stageContentMarkdown,
  STAGE_CONTENT_TRUNCATED_LINE,
  type CommandRun,
  type CommandRunner,
} from '@/stage-isolation/stage-begin.js';

const SESSION = 'ses_begin_steps';
const OK: CommandRun = { ok: true, stdout: '', stderr: '' };

describe('stage begin: each step it runs', () => {
  let root: string;
  let dir: string;
  const calls: string[][] = [];

  beforeEach(() => {
    vi.stubEnv('SE_AGENT_ID', '');
    root = mkdtempSync(join(tmpdir(), 'paqad-begin-steps-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    dir = openFeatureChange(root, SESSION, {
      adapter: 'claude-code',
      title: 'Begin steps',
      issue: '1',
      ulid: '01JABCDEFGHJKMNPQRSTVWXY20',
      lane: 'full',
    });
    calls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  const answering =
    (answers: Record<string, CommandRun> = {}): CommandRunner =>
    (args) => {
      calls.push([...args]);
      return answers[args[0]!] ?? OK;
    };

  const begin = (stage: string, run: CommandRunner, extra: { agent?: string } = {}) =>
    runStageBegin({ projectRoot: root, sessionId: SESSION, stage, run, ...extra });

  const start = (stage: string) => {
    appendFeatureStageRow(root, SESSION, dir, { kind: 'stage_start', stage });
  };

  it.each([
    ['development', 'rules', 'rules load'],
    ['review', 'review', 'review digest'],
    ['checks', 'checks', 'checks plan'],
  ])('%s stops at a failed %s step, naming %s and its stderr', (stage, command, step) => {
    start(stage);
    const result = begin(
      stage,
      answering({ [command]: { ok: false, stdout: '', stderr: ` ${step} broke \n` } }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatchObject({
      stage,
      started: false,
      failed_step: step,
      error: `${step} broke`,
      pillars: [],
    });
  });

  it('stops when the start row could not be written, passing the agent to it', () => {
    const result = begin(
      'planning',
      answering({ stage: { ok: false, stdout: '', stderr: 'no ledger' } }),
      { agent: 'paqad-planning' },
    );
    expect(result.output).toMatchObject({ failed_step: 'stage start', error: 'no ledger' });
    expect(calls[0]).toEqual(
      expect.arrayContaining(['stage', 'start', 'planning', '--agent', 'paqad-planning']),
    );
  });

  it('leaves the agent flag off when no agent was named', () => {
    begin('planning', answering());
    expect(calls[0]).not.toContain('--agent');
  });

  it('refuses a stage past an unfinished one before running anything', () => {
    appendFeatureStageRow(root, SESSION, dir, {
      kind: 'stage-agent',
      stage: 'review',
      agent_id: 'a1',
      event_status: 'completed',
      report_status: 'BLOCKED',
      report_stated: true,
      report_source: 'text',
      tokens_used: 0,
      tokens_not_recarried: 0,
      estimate: true,
    });
    const result = begin('checks', answering());
    expect(result.exitCode).toBe(1);
    expect(result.output.failed_step).toBe('stage start');
    expect(result.output.error).toContain('checks cannot start: review is unfinished');
    expect(calls).toEqual([]);
  });

  it('reports that no change is active when the start opened none', () => {
    const empty = mkdtempSync(join(tmpdir(), 'paqad-begin-none-'));
    try {
      mkdirSync(join(empty, '.paqad'), { recursive: true });
      const result = runStageBegin({
        projectRoot: empty,
        sessionId: SESSION,
        stage: 'planning',
        run: () => OK,
      });
      expect(result.exitCode).toBe(1);
      expect(result.output).toMatchObject({
        failed_step: 'stage start',
        error: `no active change for session ${SESSION}`,
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('does not start a stage twice, and starts it again after its end row', () => {
    start('planning');
    expect(begin('planning', answering()).output.started).toBe(false);
    expect(calls).toEqual([]);
    appendFeatureStageRow(root, SESSION, dir, { kind: 'stage_end', stage: 'planning' });
    expect(begin('planning', answering()).output.started).toBe(true);
  });

  it('is not fooled by an open start of another stage', () => {
    start('specification');
    expect(begin('planning', answering()).output.started).toBe(true);
  });

  it('says rules are not loaded when the load wrote no record', () => {
    start('development');
    const result = begin('development', answering());
    expect(result.exitCode).toBe(0);
    expect(result.output.rules_loaded).toBe(false);
    expect(result.output.paths.rules_loaded).toBeUndefined();
  });

  it('holds no digest path when the digest step printed no JSON', () => {
    start('review');
    const result = begin('review', answering({ review: { ...OK, stdout: 'plain words' } }));
    expect(result.exitCode).toBe(0);
    expect(result.output.paths.review_digest).toBeUndefined();
    expect(result.output.content.review_digest).toBeUndefined();
  });

  it('holds no digest path when the JSON names no path', () => {
    start('review');
    const result = begin(
      'review',
      answering({ review: { ...OK, stdout: JSON.stringify({ written: false, path: 7 }) } }),
    );
    expect(result.output.paths.review_digest).toBeUndefined();
  });

  it('carries the path but no text when the digest file is gone', () => {
    start('review');
    const result = begin(
      'review',
      answering({ review: { ...OK, stdout: JSON.stringify({ path: 'gone.md' }) } }),
    );
    expect(result.output.paths.review_digest).toBe('gone.md');
    expect(result.output.content.review_digest).toBeUndefined();
  });

  it('reads a digest named by an absolute path', () => {
    start('review');
    const digest = join(root, 'absolute-digest.md');
    writeFileSync(digest, 'absolute digest');
    const result = begin(
      'review',
      answering({ review: { ...OK, stdout: JSON.stringify({ path: digest }) } }),
    );
    expect(result.output.content.review_digest).toBe('absolute digest');
  });

  it('parses a JSON checks plan and keeps a plain one as text', () => {
    start('checks');
    expect(
      begin('checks', answering({ checks: { ...OK, stdout: 'note\n{"commands":["a"]}\n' } })).output
        .checks_plan,
    ).toEqual({ commands: ['a'] });
    expect(
      begin('checks', answering({ checks: { ...OK, stdout: ' run the tests \n' } })).output
        .checks_plan,
    ).toBe('run the tests');
  });

  it('leaves out a pillar that was never written and lists the one that was', () => {
    start('development');
    writeFileSync(join(root, featureFilePath(dir, 'plan')), '{"a":1}');
    const { output } = begin('development', answering());
    expect(output.pillars).toEqual([featureFilePath(dir, 'plan')]);
    expect(Object.keys(output.content.pillars)).toEqual(['plan']);
  });

  it('cuts the longest text to fit, and names what it cut', () => {
    start('development');
    writeFileSync(join(root, featureFilePath(dir, 'plan')), 'p'.repeat(40_000));
    const { output } = begin('development', answering());
    expect(output.truncated).toEqual(['plan']);
    expect(output.content.pillars.plan).toContain(STAGE_CONTENT_TRUNCATED_LINE);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(28_000);
  });

  it('renders stage content as markdown with no pillars for a stage with none', () => {
    const text = stageContentMarkdown(root, dir, 'planning', 10_000);
    expect(text).toContain('## Request');
    expect(text).not.toContain('## Previous pillar');
  });

  it('renders an empty request when the bundle has no record and no stage is known', () => {
    const text = stageContentMarkdown(root, 'nothing-01JABCDEFGHJKMNPQRSTVWXY21', 'no-stage', 500);
    expect(text).toBe('## Request\n\n');
  });
});

describe('fitToCeiling when it cannot fit', () => {
  it('stops with empty slots rather than looping when the ceiling is below any size', () => {
    const slots = [{ name: 'request', full: 'x'.repeat(5000), kept: 5000 }];
    const content = fitToCeiling(slots, () => 100, 1);
    expect(slots[0]!.kept).toBe(0);
    expect(content.request).toContain(STAGE_CONTENT_TRUNCATED_LINE);
  });

  it('stops at once with no slots at all', () => {
    expect(fitToCeiling([], () => 100, 1)).toEqual({ request: '', pillars: {} });
  });
});

describe('the CLI runner', () => {
  const argvBefore = process.argv[1];
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-begin-runner-'));
  });

  afterEach(() => {
    process.argv[1] = argvBefore!;
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs this same entry point in the project, returning its output', () => {
    const entry = join(dir, 'entry.mjs');
    writeFileSync(
      entry,
      "console.log(process.argv.slice(2).join(' '));console.error('warned');process.exit(process.argv[2]==='bad'?3:0);",
    );
    process.argv[1] = entry;
    const run = cliCommandRunner(dir);
    expect(run(['good', 'args'])).toEqual({ ok: true, stdout: 'good args\n', stderr: 'warned\n' });
    expect(run(['bad'])).toMatchObject({ ok: false, stdout: 'bad\n' });
  });

  it('fails plainly when the process could not even start', () => {
    const run = cliCommandRunner(join(dir, 'no-such-directory'));
    expect(run(['x'])).toEqual({ ok: false, stdout: '', stderr: '' });
  });
});
