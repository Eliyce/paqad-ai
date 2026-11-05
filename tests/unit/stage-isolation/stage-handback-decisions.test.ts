import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  openFeatureChange,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { REPORT_REPAIR_REASON } from '@/stage-evidence/report-repair.js';
import {
  buildStageReport,
  currentStageOfAgent,
  decideHandback,
  decideStageStop,
  isChecksRed,
  missingRequirementReason,
  refusalsSinceLastPass,
  resolveStageReport,
  stageEndCommand,
  stageReportOptions,
  stageRequirementMet,
  stageStartRefusal,
  unknownAgentReport,
} from '@/stage-isolation/stage-handback.js';

const SESSION = 'ses_decide';
const AGENT = 'agent_decide';
const ULID = '01JABCDEFGHJKMNPQRSTVWXY10';
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const compliantSha = sha256('report');

const row = (fields: Record<string, unknown>): SessionLedgerRow =>
  ({ schema_version: 3, content_hash: 'h', agent_id: AGENT, ...fields }) as SessionLedgerRow;

describe('deciding a stage agent handback and stop against a real ledger', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    vi.stubEnv('SE_SESSION', '');
    vi.stubEnv('SE_AGENT_ID', '');
    vi.stubEnv('CLAUDE_SESSION_ID', '');
    root = mkdtempSync(join(tmpdir(), 'paqad-handback-decide-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    dir = openFeatureChange(root, SESSION, {
      adapter: 'claude-code',
      title: 'Decide',
      issue: '1',
      ulid: ULID,
      lane: 'full',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  const append = (fields: Record<string, unknown>) =>
    appendFeatureStageRow(root, SESSION, dir, fields);
  const startPlanning = () =>
    append({ kind: 'stage_start', stage: 'planning', agent_id: AGENT, agent: 'paqad-planning' });
  const ledger = () => readFeatureStageUnit(root, dir);
  const handbacks = () => ledger().filter((entry) => entry.kind === 'stage-handback');

  const payload = (message: unknown, extra: Record<string, unknown> = {}) => ({
    session_id: SESSION,
    agent_id: AGENT,
    agent_type: 'paqad-planning',
    tool_input: { message },
    ...extra,
  });

  describe('decideHandback', () => {
    it.each([
      ['no agent type', { agent_type: undefined }],
      ['a blank agent id', { agent_id: '   ' }],
      ['an agent that is no stage', { agent_type: 'general-purpose' }],
    ])('lets %s through without writing a row', (_name, extra) => {
      startPlanning();
      const decision = decideHandback({
        projectRoot: root,
        payload: payload('Status: DONE', extra),
      });
      expect(decision).toEqual({ exit: 0, wrote: false });
      expect(handbacks()).toEqual([]);
    });

    it('lets an agent the ledger has never seen through without a row', () => {
      startPlanning();
      const decision = decideHandback({
        projectRoot: root,
        payload: payload('Status: DONE', { agent_id: 'stranger' }),
      });
      expect(decision).toEqual({ exit: 0, wrote: false });
      expect(handbacks()).toEqual([]);
    });

    it('lets everything through when no change is active', () => {
      const empty = mkdtempSync(join(tmpdir(), 'paqad-handback-empty-'));
      try {
        mkdirSync(join(empty, '.paqad'), { recursive: true });
        expect(decideHandback({ projectRoot: empty, payload: payload('Status: DONE') })).toEqual({
          exit: 0,
          wrote: false,
        });
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });

    it('refuses DONE with no artifact: denied row, the reason, and a fresh refusal id', () => {
      startPlanning();
      const decision = decideHandback({
        projectRoot: root,
        payload: payload('Status: DONE'),
      });
      expect(decision.exit).toBe(2);
      expect(decision.reason).toContain('planning ended without its artifact');
      const [denied] = handbacks();
      expect(denied).toMatchObject({
        event_status: 'denied',
        stage: 'planning',
        agent: 'paqad-planning',
        stated_status: 'DONE',
        report_source: 'handback',
      });
      expect(typeof denied!.refusal_id).toBe('string');
      expect(denied!.tool_use_id).toBeUndefined();
    });

    it('keeps the host tool use id on the row in place of a refusal id', () => {
      startPlanning();
      decideHandback({
        projectRoot: root,
        payload: payload('Status: DONE', { tool_use_id: 'toolu_1' }),
      });
      const [denied] = handbacks();
      expect(denied!.tool_use_id).toBe('toolu_1');
      expect(denied!.refusal_id).toBeUndefined();
    });

    it('turns the fourth refusal into a stated BLOCKED and lets the agent return', () => {
      startPlanning();
      for (const id of ['t1', 't2', 't3']) {
        expect(
          decideHandback({
            projectRoot: root,
            payload: payload('Status: DONE', { tool_use_id: id }),
          }).exit,
        ).toBe(2);
      }
      const decision = decideHandback({
        projectRoot: root,
        payload: payload('Status: DONE', { tool_use_id: 't4' }),
      });
      expect(decision).toEqual({ exit: 0, wrote: true });
      expect(handbacks().at(-1)).toMatchObject({
        event_status: 'completed',
        report_status: 'BLOCKED',
        stated_status: 'DONE',
        advance: false,
      });
      expect(String(handbacks().at(-1)!.reason)).toContain('refused 3 times');
    });

    it('records a message that is not a string as no report, and does not refuse it', () => {
      startPlanning();
      const decision = decideHandback({ projectRoot: root, payload: payload(42) });
      expect(decision).toEqual({ exit: 0, wrote: true });
      expect(handbacks()[0]).toMatchObject({ report_stated: false, advance: false });
    });

    it('records a tool input with no message the same way', () => {
      startPlanning();
      const decision = decideHandback({
        projectRoot: root,
        payload: payload('x', { tool_input: null }),
      });
      expect(decision).toEqual({ exit: 0, wrote: true });
      expect(handbacks()[0]).toMatchObject({ report_stated: false });
    });

    it('never advances a DONE from a checks stage whose checks are red', () => {
      append({ kind: 'stage_start', stage: 'checks', agent_id: AGENT });
      const artifact = featureFilePath(dir, 'checks');
      writeFileSync(join(root, artifact), JSON.stringify({ passed: false }));
      append({
        kind: 'stage_end',
        stage: 'checks',
        artifact_digest: 'd',
        artifact_paths: [artifact],
      });
      const decision = decideHandback({
        projectRoot: root,
        payload: payload('Status: DONE', { agent_type: 'paqad-checks' }),
      });
      expect(decision).toEqual({ exit: 0, wrote: true });
      expect(handbacks()[0]).toMatchObject({ advance: false, report_status: 'DONE' });
    });

    it('takes the stage from the agent name when the agent has only a stage-agent row', () => {
      append({
        kind: 'stage-agent',
        stage: 'review',
        event_status: 'started',
        agent_id: AGENT,
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      });
      decideHandback({
        projectRoot: root,
        payload: payload('Status: NEEDS_CONTEXT', { agent_type: 'paqad-review' }),
      });
      expect(handbacks()[0]).toMatchObject({ stage: 'review', advance: false });
    });
  });

  describe('isChecksRed', () => {
    it('is false for another stage, an unreadable report and a green one', () => {
      expect(isChecksRed(root, dir, 'review')).toBe(false);
      expect(isChecksRed(root, dir, 'checks')).toBe(false);
      writeFileSync(join(root, featureFilePath(dir, 'checks')), '{not json');
      expect(isChecksRed(root, dir, 'checks')).toBe(false);
      writeFileSync(join(root, featureFilePath(dir, 'checks')), '{"passed":true}');
      expect(isChecksRed(root, dir, 'checks')).toBe(false);
      writeFileSync(join(root, featureFilePath(dir, 'checks')), '{"passed":false}');
      expect(isChecksRed(root, dir, 'checks')).toBe(true);
    });
  });

  describe('stageReportOptions', () => {
    it('answers a decision only once its resolved file exists', () => {
      const options = stageReportOptions(root, dir);
      expect(options.decisionAnswered!('D-1')).toBe(false);
      const resolved = join(root, '.paqad/decisions/resolved');
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, 'D-1.json'), '{}');
      expect(stageReportOptions(root, dir).decisionAnswered!('D-1')).toBe(true);
    });
  });

  describe('decideStageStop', () => {
    const stopPayload = (extra: Record<string, unknown> = {}) => ({
      session_id: SESSION,
      agent_id: AGENT,
      agent_type: 'paqad-planning',
      ...extra,
    });
    const stop = (extra: Record<string, unknown> = {}, adapter = 'claude-code') =>
      decideStageStop({ projectRoot: root, payload: stopPayload(extra), adapter });

    it('never holds a Codex stage agent', () => {
      startPlanning();
      expect(stop({ last_assistant_message: 'Status: DONE' }, 'codex-cli')).toEqual({
        block: false,
      });
      expect(handbacks()).toEqual([]);
    });

    it.each([
      ['no agent type', { agent_type: 7 }],
      ['no agent id', { agent_id: null }],
      ['an agent that is no stage', { agent_type: 'Explore' }],
      ['an agent the ledger has never seen', { agent_id: 'stranger' }],
    ])('lets %s stop', (_name, extra) => {
      startPlanning();
      expect(stop({ last_assistant_message: 'Status: DONE', ...extra })).toEqual({ block: false });
      expect(handbacks()).toEqual([]);
    });

    it('lets the agent stop when no change is active', () => {
      const empty = mkdtempSync(join(tmpdir(), 'paqad-stop-empty-'));
      try {
        mkdirSync(join(empty, '.paqad'), { recursive: true });
        expect(
          decideStageStop({
            projectRoot: empty,
            payload: stopPayload({ last_assistant_message: 'Status: DONE' }),
            adapter: 'claude-code',
          }),
        ).toEqual({ block: false });
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });

    it('holds a final text DONE with no artifact, recording a denied text row', () => {
      startPlanning();
      const decision = stop({ last_assistant_message: 'All good.\nStatus: DONE' });
      expect(decision.block).toBe(true);
      expect(decision.reason).toContain('planning ended without its artifact');
      expect(handbacks()[0]).toMatchObject({
        event_status: 'denied',
        report_source: 'text',
        stated_status: 'DONE',
        report_status: 'DONE',
      });
      expect(typeof handbacks()[0]!.refusal_id).toBe('string');
    });

    it('lets a stage that already handed back stop without judging it again', () => {
      startPlanning();
      append({
        kind: 'stage-handback',
        stage: 'planning',
        agent_id: AGENT,
        event_status: 'completed',
        report_status: 'BLOCKED',
        report_stated: true,
        advance: false,
        report_source: 'handback',
        report_hash: compliantSha,
      });
      const before = handbacks().length;
      expect(stop({ last_assistant_message: 'Status: DONE' })).toEqual({ block: false });
      expect(handbacks()).toHaveLength(before);
    });

    it('lets a stage with no Status line stop: the completion row judges that', () => {
      startPlanning();
      expect(stop({ last_assistant_message: 'I think that went fine.' })).toEqual({ block: false });
      expect(handbacks()).toEqual([]);
    });

    it('lets the agent stop after the fourth try: the ceiling is never a loop', () => {
      startPlanning();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(stop({ last_assistant_message: `Status: DONE\n\n${attempt}` }).block).toBe(true);
      }
      expect(stop({ last_assistant_message: 'Status: DONE' })).toEqual({ block: false });
    });
  });

  describe('resolveStageReport from a transcript', () => {
    const transcriptWith = (entries: unknown[]): string => {
      const path = join(root, 'agent.jsonl');
      writeFileSync(
        path,
        entries
          .map((content) => JSON.stringify({ message: { role: 'assistant', content } }))
          .join('\n'),
      );
      return path;
    };
    const handbackUse = (message: unknown, id?: string) => [
      { type: 'tool_use', name: 'SubagentHandback', input: { message }, ...(id ? { id } : {}) },
    ];
    const resolve = (payloadFields: Record<string, unknown>, adapter = 'claude-code', extra = {}) =>
      resolveStageReport({
        rows: ledger(),
        agentId: AGENT,
        payload: payloadFields,
        adapter,
        ...extra,
      });

    it('takes a handback the hook never saw, and marks it as not gate checked', () => {
      const path = transcriptWith([handbackUse('Status: DONE')]);
      const report = resolve({ agent_transcript_path: path });
      expect(report).toMatchObject({
        source: 'handback',
        gateChecked: false,
        message: 'Status: DONE',
      });
      expect(report.reading.status).toBe('DONE');
    });

    it('ignores a transcript handback whose tool use the ledger already holds', () => {
      append({
        kind: 'stage-handback',
        stage: 'planning',
        agent_id: AGENT,
        event_status: 'denied',
        report_status: 'DONE',
        report_stated: true,
        advance: false,
        report_source: 'handback',
        report_hash: compliantSha,
        tool_use_id: 'toolu_seen',
      });
      const path = transcriptWith([handbackUse('Status: DONE', 'toolu_seen')]);
      const report = resolve({
        agent_transcript_path: path,
        last_assistant_message: 'Status: NEEDS_CONTEXT',
      });
      expect(report).toMatchObject({ source: 'text', gateChecked: true });
      expect(report.reading.status).toBe('NEEDS_CONTEXT');
    });

    it('ignores a transcript handback whose message is not text', () => {
      const path = transcriptWith([handbackUse(9)]);
      const report = resolve({
        agent_transcript_path: path,
        last_assistant_message: 'Status: DONE',
      });
      expect(report.source).toBe('text');
    });

    it('ignores a resumed agent replaying the handback it already finished with', () => {
      append({
        kind: 'stage-agent',
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
        stage: 'planning',
        agent_id: AGENT,
        event_status: 'completed',
        report_status: 'DONE',
        report_stated: true,
        report_hash: sha256('Status: DONE'),
      });
      const path = transcriptWith([handbackUse('Status: DONE')]);
      const report = resolve({ agent_transcript_path: path });
      expect(report.source).not.toBe('handback');
    });

    it('reads no report from a missing transcript path', () => {
      expect(resolve({ agent_transcript_path: join(root, 'gone.jsonl') })).toMatchObject({
        source: 'none',
        message: null,
        gateChecked: true,
      });
    });

    it('reads no report from a blank transcript path or a blank final message', () => {
      expect(resolve({ agent_transcript_path: '   ', last_assistant_message: '   ' }).source).toBe(
        'none',
      );
    });

    it('reads the assistant text out of the transcript when no final message came', () => {
      const path = transcriptWith([[{ type: 'text', text: 'Status: DONE_WITH_CONCERNS' }]]);
      const report = resolve({ agent_transcript_path: path });
      expect(report.source).toBe('text');
      expect(report.reading.status).toBe('DONE_WITH_CONCERNS');
    });

    it('calls text with no Status line no report, and keeps the text', () => {
      const report = resolve({ last_assistant_message: 'done, I think' });
      expect(report).toMatchObject({ source: 'none', message: 'done, I think' });
      expect(report.reading.stated).toBe(false);
    });

    it('reads a Codex report from the rollout fallback when the hook has no transcript', () => {
      const rollout = JSON.stringify({
        message: { role: 'assistant', content: [{ type: 'text', text: 'Status: DONE' }] },
      });
      const report = resolve({}, 'codex-cli', { fallbackTranscript: rollout });
      expect(report.source).toBe('rollout');
      expect(report.reading.status).toBe('DONE');
    });

    it('has no report for Codex with neither a transcript nor a fallback', () => {
      expect(resolve({}, 'codex-cli').source).toBe('none');
    });

    it('ignores the Codex fallback for any other adapter', () => {
      const rollout = JSON.stringify({
        message: { role: 'assistant', content: [{ type: 'text', text: 'Status: DONE' }] },
      });
      expect(resolve({}, 'claude-code', { fallbackTranscript: rollout }).source).toBe('none');
    });

    it('reads no agent handback at all when the host gave no agent id', () => {
      const path = transcriptWith([handbackUse('Status: DONE')]);
      const report = resolveStageReport({
        rows: ledger(),
        agentId: null,
        payload: { agent_transcript_path: path },
        adapter: 'claude-code',
      });
      expect(report.source).not.toBe('handback');
    });

    it('reads a fresh handback row, and stops reading it once the agent completed', () => {
      const handed = {
        kind: 'stage-handback',
        stage: 'planning',
        agent_id: AGENT,
        event_status: 'completed',
        report_status: 'NEEDS_CONTEXT',
        report_stated: true,
        advance: false,
        decision: 'D-9',
        report_source: 'handback',
        report_hash: compliantSha,
        tool_use_id: 'toolu_fresh',
      };
      append(handed);
      const fresh = resolve({});
      expect(fresh).toMatchObject({ source: 'handback', gateChecked: true, message: null });
      expect(fresh.reading).toMatchObject({
        status: 'NEEDS_CONTEXT',
        decision: 'D-9',
        stated: true,
        advance: false,
      });
      append({
        kind: 'stage-agent',
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
        stage: 'planning',
        agent_id: AGENT,
        event_status: 'completed',
        report_status: 'NEEDS_CONTEXT',
        report_stated: true,
      });
      expect(resolve({}).handbackRow).toBeNull();
    });

    it('does not take a denied handback row for a report', () => {
      append({
        kind: 'stage-handback',
        stage: 'planning',
        agent_id: AGENT,
        event_status: 'denied',
        report_status: 'DONE',
        report_stated: true,
        advance: false,
        report_source: 'handback',
        report_hash: compliantSha,
        tool_use_id: 'toolu_denied',
      });
      expect(resolve({}).handbackRow).toBeNull();
    });
  });

  it('writes valid JSON lines only', () => {
    startPlanning();
    decideHandback({ projectRoot: root, payload: payload('Status: DONE') });
    const raw = readFileSync(join(root, featureFilePath(dir, 'stageEvidence')), 'utf8');
    expect(() =>
      raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown),
    ).not.toThrow();
  });
});

describe('what a stage must prove', () => {
  it('names the artifact only for a rigid stage', () => {
    expect(stageEndCommand('review')).toContain('--artifact <the review.json path>');
    expect(stageEndCommand('development')).toBe(
      'paqad-ai stage end development --agent paqad-development',
    );
    expect(missingRequirementReason('development')).toContain('its stage end row');
    expect(missingRequirementReason('review')).toContain('its artifact');
  });

  it('takes a plain end row for a mutation stage', () => {
    const rows = [row({ kind: 'stage_start', stage: 'development' })];
    expect(stageRequirementMet(rows, 'development', AGENT)).toBe(false);
    expect(
      stageRequirementMet(
        [...rows, row({ kind: 'stage_end', stage: 'development' })],
        'development',
        AGENT,
      ),
    ).toBe(true);
  });

  it('wants a digest and the named artifact for a rigid stage', () => {
    const start = row({ kind: 'stage_start', stage: 'review' });
    const end = (fields: Record<string, unknown>) =>
      row({ kind: 'stage_end', stage: 'review', ...fields });
    expect(stageRequirementMet([start, end({})], 'review', AGENT)).toBe(false);
    expect(
      stageRequirementMet(
        [start, end({ artifact_digest: 'd', artifact_paths: 'x/review.json' })],
        'review',
        AGENT,
      ),
    ).toBe(false);
    expect(
      stageRequirementMet(
        [start, end({ artifact_digest: 'd', artifact_paths: [7, 'plan.json'] })],
        'review',
        AGENT,
      ),
    ).toBe(false);
    expect(
      stageRequirementMet(
        [start, end({ artifact_digest: '  ', artifact_paths: ['x/review.json'] })],
        'review',
        AGENT,
      ),
    ).toBe(false);
    expect(
      stageRequirementMet(
        [start, end({ artifact_digest: 'd', artifact_paths: ['x/review.json'] })],
        'review',
        AGENT,
      ),
    ).toBe(true);
  });

  it('reads an end row before another agent start as stale, and with no id any start counts', () => {
    const rows = [
      row({ kind: 'stage_start', stage: 'development', agent_id: 'other' }),
      row({ kind: 'stage_end', stage: 'development', agent_id: 'other' }),
      row({ kind: 'stage_start', stage: 'development', agent_id: 'second' }),
    ];
    expect(stageRequirementMet(rows, 'development', null)).toBe(false);
    expect(stageRequirementMet(rows, 'development', 'other')).toBe(true);
    expect(stageRequirementMet(rows, 'development', 'nobody')).toBe(false);
  });
});

describe('the stage an agent is working on', () => {
  it('prefers its newest start, then its name, then gives up', () => {
    const rows = [
      row({ kind: 'stage_start', stage: 'planning' }),
      row({ kind: 'stage_start', stage: 'specification' }),
    ];
    expect(currentStageOfAgent(rows, AGENT, 'paqad-planning')).toBe('specification');
    expect(currentStageOfAgent(rows, null, ' paqad-planning ')).toBe('planning');
    expect(currentStageOfAgent(rows, 'other', null)).toBeNull();
    expect(currentStageOfAgent(rows, null, 'general-purpose')).toBeNull();
  });

  it('falls back to the name when its start row names no stage', () => {
    const rows = [row({ kind: 'stage_start', stage: '  ' })];
    expect(currentStageOfAgent(rows, AGENT, 'paqad-review')).toBe('review');
  });
});

describe('counting refusals', () => {
  const denied = (fields: Record<string, unknown>) =>
    row({ kind: 'stage-handback', stage: 'planning', event_status: 'denied', ...fields });

  it('has nothing to count with no agent id', () => {
    expect(refusalsSinceLastPass([denied({})], null, 'planning')).toEqual([]);
  });

  it('counts one retry of one tool use once, keyed on tool use, refusal, then hash', () => {
    const rows = [
      denied({ tool_use_id: 't1', content_hash: 'a' }),
      denied({ tool_use_id: 't1', content_hash: 'b' }),
      denied({ refusal_id: 'r1', content_hash: 'c' }),
      denied({ refusal_id: 'r1', content_hash: 'd' }),
      denied({ content_hash: 'e' }),
      denied({ content_hash: 'e' }),
    ];
    expect(refusalsSinceLastPass(rows, AGENT, 'planning')).toHaveLength(3);
  });

  it('starts again after a pass or a stage agent row of its own', () => {
    const passed = row({ kind: 'stage-handback', stage: 'planning', event_status: 'completed' });
    const completed = row({ kind: 'stage-agent', stage: 'planning', event_status: 'completed' });
    const one = denied({ tool_use_id: 't1' });
    const two = denied({ tool_use_id: 't2' });
    expect(refusalsSinceLastPass([one, passed, two], AGENT, 'planning')).toEqual([two]);
    expect(refusalsSinceLastPass([one, completed, two], AGENT, 'planning')).toEqual([two]);
  });

  it('ignores another agent, another stage and a row of another kind', () => {
    const rows = [
      denied({ tool_use_id: 't1', agent_id: 'other' }),
      denied({ tool_use_id: 't2', stage: 'review' }),
      row({ kind: 'stage_end', stage: 'planning', event_status: 'denied', tool_use_id: 't3' }),
    ];
    expect(refusalsSinceLastPass(rows, AGENT, 'planning')).toEqual([]);
  });
});

describe('buildStageReport edge rows', () => {
  const completed = (fields: Record<string, unknown>) =>
    row({
      kind: 'stage-agent',
      tokens_used: 0,
      tokens_not_recarried: 0,
      estimate: true,
      event_status: 'completed',
      stage: 'review',
      report_source: 'text',
      ...fields,
    });

  it('has no report for an agent with no rows', () => {
    expect(buildStageReport([], AGENT)).toBeNull();
  });

  it('carries the concerns to the receipt on an advancing DONE_WITH_CONCERNS', () => {
    const report = buildStageReport(
      [completed({ report_status: 'DONE_WITH_CONCERNS', report_stated: true, advance: true })],
      AGENT,
    );
    expect(report?.next_action).toBe('continue, and carry the concerns to the receipt');
  });

  it('continues on an advancing DONE', () => {
    const report = buildStageReport(
      [completed({ report_status: 'DONE', report_stated: true, advance: true })],
      AGENT,
    );
    expect(report?.next_action).toBe('continue to the next stage');
  });

  it('presents an unanswered decision and resumes an answered one', () => {
    const rows = [
      completed({ report_status: 'BLOCKED', report_stated: true, decision: 'D-7', advance: false }),
    ];
    expect(buildStageReport(rows, AGENT)?.next_action).toContain('present the decision D-7');
    expect(buildStageReport(rows, AGENT, { decisionAnswered: () => true })?.next_action).toContain(
      'resume the agent with the answer to D-7',
    );
  });

  it('asks what a NEEDS_CONTEXT named', () => {
    const report = buildStageReport(
      [completed({ report_status: 'NEEDS_CONTEXT', report_stated: true, advance: false })],
      AGENT,
    );
    expect(report?.next_action).toBe('resume the agent with what it names');
  });

  it('stops with the reason on a stated BLOCKED, and without one too', () => {
    const blocked = { report_status: 'BLOCKED', report_stated: true, advance: false };
    expect(buildStageReport([completed({ ...blocked, reason: 'why' })], AGENT)).toMatchObject({
      reason: 'why',
      next_action: 'stop and tell the developer the reason',
    });
    expect(buildStageReport([completed(blocked)], AGENT)).toMatchObject({
      reason: null,
      next_action: 'stop and tell the developer which stage stopped',
    });
  });

  it('calls a row with no source and no claim a legacy row', () => {
    const report = buildStageReport(
      [completed({ report_source: undefined, report_stated: false, reason: 'old' })],
      AGENT,
    );
    expect(report).toMatchObject({
      report_status: 'UNKNOWN',
      advance: null,
      report_source: 'legacy',
      reason: 'old',
    });
    expect(report?.next_action).toContain('stage-evidence.jsonl');
  });

  it('treats a stated row with no source as text', () => {
    const report = buildStageReport(
      [completed({ report_source: undefined, report_stated: true, report_status: 'DONE' })],
      AGENT,
    );
    expect(report?.report_source).toBe('text');
  });

  it('says current for a stage it cannot name, and holds nothing for it', () => {
    const silent = () =>
      completed({ stage: undefined, report_source: 'none', report_stated: false });
    const report = buildStageReport([silent(), silent()], AGENT);
    expect(report?.next_action).toContain('the current stage returned twice');
    expect(report?.stage).toBeNull();
    expect(report?.reason).toBe('the agent returned no report');
  });

  it('reports DONE_WITH_CONCERNS for a silent stage whose end row exists with a breach', () => {
    const rows = [
      row({ kind: 'stage_start', stage: 'development' }),
      row({ kind: 'stage_end', stage: 'development' }),
      completed({
        stage: 'development',
        report_source: 'none',
        report_stated: false,
        must_not: ['bundle_write', 'bundle_write'],
      }),
    ];
    expect(buildStageReport(rows, AGENT)).toMatchObject({
      report_status: 'DONE_WITH_CONCERNS',
      advance: false,
      report_source: 'none',
      reason: 'no Status line, and the agent breached a must-not: bundle_write',
      next_action: 'stop and tell the developer the reason',
    });
  });

  it('reports a silent stage done from its end row when nothing holds it', () => {
    const silent = [
      row({ kind: 'stage_start', stage: 'development' }),
      row({ kind: 'stage_end', stage: 'development' }),
      completed({ stage: 'development', report_source: 'none', report_stated: false }),
    ];
    expect(buildStageReport(silent, AGENT)).toMatchObject({
      report_status: 'DONE',
      advance: true,
      report_source: 'none',
    });
  });

  it('sends a red silent checks stage back to development', () => {
    const rows = [
      row({ kind: 'stage_start', stage: 'checks' }),
      row({
        kind: 'stage_end',
        stage: 'checks',
        artifact_digest: 'd',
        artifact_paths: ['checks.json'],
      }),
      completed({ stage: 'checks', report_source: 'none', report_stated: false }),
    ];
    const report = buildStageReport(rows, AGENT, { checksRed: () => true });
    expect(report).toMatchObject({
      report_status: 'DONE_WITH_CONCERNS',
      advance: false,
      reason: 'no Status line, and the checks are red',
    });
    expect(report?.next_action).toContain('resume the development agent');
  });

  it('says wait when the newest handback was sent back', () => {
    const report = buildStageReport(
      [
        row({
          kind: 'stage-handback',
          event_status: 'denied',
          stage: 'review',
          report_status: 'DONE',
          report_stated: true,
          report_source: 'handback',
          reason: 'no artifact',
        }),
      ],
      AGENT,
    );
    expect(report?.next_action).toContain('its handback was sent back');
  });

  it('keeps its token count, and advises a fresh dispatch past the handover size', () => {
    const big = buildStageReport(
      [
        completed({
          report_status: 'DONE',
          report_stated: true,
          advance: true,
          tokens_not_recarried: 10_000_000,
        }),
      ],
      AGENT,
    );
    expect(big).toMatchObject({
      tokens_not_recarried: 10_000_000,
      resume_advice: 'dispatch-fresh',
    });
    const odd = buildStageReport(
      [
        completed({
          report_status: 'DONE',
          report_stated: true,
          advance: true,
          tokens_not_recarried: Number.NaN,
        }),
      ],
      AGENT,
    );
    expect(odd).toMatchObject({ tokens_not_recarried: null, resume_advice: 'resume' });
  });

  it('reads a repaired report for a silent agent: blocked is not finished', () => {
    const repair = (status: string) =>
      row({
        kind: 'record-repair',
        reason: REPORT_REPAIR_REASON,
        note: `${AGENT} development: ${status} (text)`,
      });
    const silent = completed({ stage: 'development', report_source: 'none', report_stated: false });
    const end = row({ kind: 'stage_end', stage: 'development' });
    const start = row({ kind: 'stage_start', stage: 'development' });
    expect(buildStageReport([start, end, silent, repair('BLOCKED')], AGENT)).toMatchObject({
      report_status: 'BLOCKED',
      advance: false,
      report_source: 'text',
      reason: REPORT_REPAIR_REASON,
    });
    expect(buildStageReport([start, end, silent, repair('DONE')], AGENT)).toMatchObject({
      report_status: 'DONE',
      advance: true,
    });
    expect(buildStageReport([start, silent, repair('DONE')], AGENT)?.advance).toBe(false);
    const breached = completed({
      stage: 'development',
      report_source: 'none',
      report_stated: false,
      must_not: ['asked_human'],
    });
    expect(buildStageReport([start, end, breached, repair('DONE')], AGENT)).toMatchObject({
      advance: false,
      reason: 'no Status line, and the agent breached a must-not: asked_human',
    });
  });
});

describe('unknownAgentReport', () => {
  it('names the agent and the reason, and asks the orchestrator to resume once', () => {
    expect(unknownAgentReport('a9', 'no stage row')).toMatchObject({
      agent_id: 'a9',
      stage: null,
      report_status: 'UNKNOWN',
      advance: false,
      report_source: 'none',
      reason: 'no stage row',
      tokens_not_recarried: null,
      resume_advice: 'resume',
    });
  });
});

describe('stageStartRefusal edges', () => {
  const blocked = (fields: Record<string, unknown> = {}) =>
    row({
      kind: 'stage-agent',
      tokens_used: 0,
      tokens_not_recarried: 0,
      estimate: true,
      event_status: 'completed',
      stage: 'review',
      report_status: 'BLOCKED',
      report_stated: true,
      report_source: 'text',
      ...fields,
    });

  it('leaves a stage outside the order alone', () => {
    expect(stageStartRefusal([blocked()], 'not-a-stage', 'full')).toBeNull();
  });

  it('leaves a legacy ledger alone', () => {
    const legacy = blocked({ schema_version: 2 });
    expect(stageStartRefusal([legacy], 'checks', 'full')).toBeNull();
  });

  it.each(['fast', 'graduated'])('leaves the %s lane alone', (lane) => {
    expect(stageStartRefusal([blocked()], 'checks', lane)).toBeNull();
  });

  it('does not count a report that is unstated, sourced none or from a live agent', () => {
    expect(stageStartRefusal([blocked({ report_stated: false })], 'checks', 'full')).toBeNull();
    expect(stageStartRefusal([blocked({ report_source: 'none' })], 'checks', 'full')).toBeNull();
    expect(stageStartRefusal([blocked({ report_source: undefined })], 'checks', 'full')).toBeNull();
    expect(stageStartRefusal([blocked({ event_status: 'started' })], 'checks', 'full')).toBeNull();
  });

  it('reads a completed handback row as a report, and not a denied one', () => {
    const handed = (status: string) =>
      row({
        kind: 'stage-handback',
        event_status: status,
        stage: 'review',
        report_status: 'BLOCKED',
        report_stated: true,
        report_source: 'handback',
      });
    expect(stageStartRefusal([handed('completed')], 'checks', 'full')?.stage).toBe('review');
    expect(stageStartRefusal([handed('denied')], 'checks', 'full')).toBeNull();
  });

  it('lets the later stage start once the blocked stage proved its end row', () => {
    const end = row({
      kind: 'stage_end',
      stage: 'review',
      artifact_digest: 'd',
      artifact_paths: ['x/review.json'],
    });
    expect(stageStartRefusal([blocked(), end], 'checks', 'full')).toBeNull();
  });

  it('words a report with no agent id or reason plainly, with the default next step', () => {
    const refusal = stageStartRefusal(
      [blocked({ agent_id: undefined, reason: undefined })],
      'checks',
      'full',
    );
    expect(refusal?.message).toBe(
      'checks cannot start: review is unfinished (BLOCKED). Next: resume the stage agent.',
    );
  });

  it('takes the stage from the row when the agent has no start row', () => {
    const refusal = stageStartRefusal([blocked({ agent_id: 'lonely' })], 'checks', 'full');
    expect(refusal?.stage).toBe('review');
  });
});
