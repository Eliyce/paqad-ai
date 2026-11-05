import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendFeatureStageRow,
  openFeatureChange,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import {
  judgeStageAgentReturn,
  recordStageAgentCompletion,
  recordStageAgentStart,
} from '@/stage-isolation/subagent-completion.js';

import { useTempRoots } from '../_helpers/temp-roots.js';

const SESSION = 'ses_return';
const AGENT = 'agent_return';
const tempRoot = useTempRoots('paqad-agent-return-');

function changed(root: string): string {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  const dir = openFeatureChange(root, SESSION, {
    adapter: 'claude-code',
    title: 'Return',
    issue: '1',
    ulid: '01JABCDEFGHJKMNPQRSTVWXY80',
    lane: 'full',
  });
  persistLedgerSessionId(root, SESSION);
  return dir;
}

const assistantTurn = (id: number, content: unknown[] = []): string =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id: `msg_${id}`,
      role: 'assistant',
      model: 'claude-test',
      usage: { input_tokens: 1, output_tokens: 1 },
      content,
    },
  });

const handbackRow = (fields: Record<string, unknown> = {}) => ({
  kind: 'stage-handback',
  stage: 'development',
  agent_id: AGENT,
  event_status: 'completed',
  report_status: 'DONE',
  report_stated: true,
  advance: true,
  report_source: 'handback',
  report_hash: 'a'.repeat(64),
  ...fields,
});

describe('judging what a stage agent returned', () => {
  beforeEach(() => {
    vi.stubEnv('SE_AGENT_ID', undefined);
    vi.stubEnv('SE_SESSION', undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const judge = (
    root: string,
    dir: string,
    payload: Record<string, unknown>,
    stage = 'development',
  ) =>
    judgeStageAgentReturn(
      stage,
      { session_id: SESSION, agent_id: AGENT, agent_type: 'paqad-development', ...payload },
      { projectRoot: root, dirName: dir, adapter: 'claude-code' },
    );

  it('copies a handback row, with its decision, stated status and reason', () => {
    const root = tempRoot();
    const dir = changed(root);
    appendFeatureStageRow(
      root,
      SESSION,
      dir,
      handbackRow({
        report_status: 'BLOCKED',
        advance: false,
        decision: 'D-3',
        stated_status: 'DONE',
        reason: 'refused 3 times',
      }),
    );
    expect(judge(root, dir, {})).toMatchObject({
      report_source: 'handback',
      gate_checked: true,
      report_status: 'BLOCKED',
      report_stated: true,
      advance: false,
      decision: 'D-3',
      stated_status: 'DONE',
      reason: 'refused 3 times',
      report_hash: 'a'.repeat(64),
    });
  });

  it('copies a plain handback row without inventing the optional fields', () => {
    const root = tempRoot();
    const dir = changed(root);
    appendFeatureStageRow(root, SESSION, dir, handbackRow());
    const judged = judge(root, dir, {});
    expect(judged).toMatchObject({ advance: true, decision: null, report_status: 'DONE' });
    expect(judged).not.toHaveProperty('stated_status');
    expect(judged).not.toHaveProperty('reason');
    expect(judged).not.toHaveProperty('must_not');
    expect(judged).not.toHaveProperty('api_turns');
  });

  it('does not let a breach advance, even on a passed handback', () => {
    const root = tempRoot();
    const dir = changed(root);
    appendFeatureStageRow(root, SESSION, dir, handbackRow());
    const transcript = join(root, 'agent.jsonl');
    writeFileSync(
      transcript,
      assistantTurn(1, [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }]),
    );
    expect(judge(root, dir, { agent_transcript_path: transcript })).toMatchObject({
      advance: false,
      must_not: ['asked_human'],
      api_turns: 1,
    });
  });

  it('does not count a transcript path that is blank', () => {
    const root = tempRoot();
    const dir = changed(root);
    const judged = judge(root, dir, { agent_transcript_path: '  ' });
    expect(judged).not.toHaveProperty('api_turns');
    expect(judged.report_source).toBe('none');
  });

  it('names the turn limit when a silent agent used all its turns', () => {
    const root = tempRoot();
    const dir = changed(root);
    appendFeatureStageRow(root, SESSION, dir, {
      kind: 'stage_start',
      stage: 'checks',
      agent_id: AGENT,
    });
    const transcript = join(root, 'agent.jsonl');
    writeFileSync(
      transcript,
      Array.from({ length: 20 }, (_, index) => assistantTurn(index)).join('\n'),
    );
    const judged = judge(root, dir, { agent_transcript_path: transcript }, 'checks');
    expect(judged).toMatchObject({ report_source: 'none', api_turns: 20 });
    expect(judged.reason).toMatch(/reached its turn limit of \d+ and returned no report/u);
  });

  it('gives no turn limit reason short of the limit, or for a stage with no limit', () => {
    const root = tempRoot();
    const dir = changed(root);
    const transcript = join(root, 'agent.jsonl');
    writeFileSync(transcript, assistantTurn(1));
    expect(judge(root, dir, { agent_transcript_path: transcript }).reason).toBeUndefined();
    const stranger = judgeStageAgentReturn(
      'not-a-stage',
      { session_id: SESSION, agent_id: 'x', agent_transcript_path: transcript },
      { projectRoot: root, dirName: dir, adapter: 'claude-code' },
    );
    expect(stranger.reason).toBeUndefined();
    expect(stranger.report_status).toBe('BLOCKED');
  });

  it('judges a report text with its hash and refusal', () => {
    const root = tempRoot();
    const dir = changed(root);
    appendFeatureStageRow(root, SESSION, dir, {
      kind: 'stage_start',
      stage: 'review',
      agent_id: AGENT,
    });
    const judged = judge(
      root,
      dir,
      { agent_type: 'paqad-review', last_assistant_message: 'Status: DONE' },
      'review',
    );
    expect(judged).toMatchObject({
      report_source: 'text',
      report_status: 'DONE',
      stated_status: 'DONE',
      advance: false,
    });
    expect(judged.reason).toContain('review ended without its artifact');
    expect(judged.report_hash).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('recording a stage agent start', () => {
  const start = (root: string, payload: Record<string, unknown>) =>
    recordStageAgentStart({ projectRoot: root, payload: { session_id: SESSION, ...payload } });

  it('does nothing for a type that is not text, or no stage', () => {
    const root = tempRoot();
    const dir = changed(root);
    const before = readFeatureStageUnit(root, dir).length;
    expect(start(root, { agent_type: 7 })).toBe(false);
    expect(start(root, { agent_type: 'general-purpose' })).toBe(false);
    expect(readFeatureStageUnit(root, dir)).toHaveLength(before);
  });

  it('does nothing when no change is active', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
    expect(start(root, { agent_type: 'paqad-review' })).toBe(false);
  });

  it('writes the started row with the host agent id', () => {
    const root = tempRoot();
    const dir = changed(root);
    expect(start(root, { agent_type: 'paqad-review', agent_id: AGENT })).toBe(true);
    expect(readFeatureStageUnit(root, dir).at(-1)).toMatchObject({
      kind: 'stage-agent',
      stage: 'review',
      event_status: 'started',
      agent_id: AGENT,
      agent: 'paqad-review',
    });
  });
});

describe('recording a stage agent completion', () => {
  const complete = (root: string, payload: Record<string, unknown>, log?: (line: string) => void) =>
    recordStageAgentCompletion({
      projectRoot: root,
      payload: { session_id: SESSION, ...payload },
      transcriptText: '',
      adapter: 'claude-code',
      log,
    });

  it('logs a return with no report, naming the agent or none', () => {
    const root = tempRoot();
    changed(root);
    const lines: string[] = [];
    expect(
      complete(root, { agent_type: 'paqad-review', agent_id: AGENT }, (line) => lines.push(line)),
    ).toBe(true);
    expect(complete(root, { agent_type: 'paqad-review' }, (line) => lines.push(line))).toBe(true);
    expect(lines[0]).toContain(`no report found agent=${AGENT} stage=review`);
    expect(lines[1]).toContain('no report found agent=none stage=review');
  });

  it('survives having no log, and writes nothing for a type that is not text', () => {
    const root = tempRoot();
    changed(root);
    expect(complete(root, { agent_type: 'paqad-review', agent_id: AGENT })).toBe(true);
    expect(complete(root, { agent_type: 7 })).toBe(false);
  });
});
