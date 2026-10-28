import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  featureStagePath,
  openFeatureChange,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { liveStageAgents } from '@/stage-evidence/completion-deferred.js';
import { readStageAgentRows } from '@/stage-isolation/isolation-summary.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import { startStage } from '@/stage-evidence/recorder.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import {
  estimateTokens,
  recordStageAgentCompletion,
  recordStageAgentStart,
  resolveTokenCounts,
  stageFromAgentType,
} from '@/stage-isolation/subagent-completion.js';
import { writeStageSettings } from '@/stage-isolation/stage-settings.js';

import { useTempRoots } from '../_helpers/temp-roots.js';

const tempRoot = useTempRoots('paqad-subagent-stop-');

function activeFeature(root: string): string {
  const dir = openFeatureChange(root, 'ses_orch', {
    adapter: 'claude-code',
    title: 'Stage isolation',
    issue: '567',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
  persistLedgerSessionId(root, 'ses_orch');
  return dir;
}

describe('stageFromAgentType', () => {
  it('strips the paqad- prefix to the stage name', () => {
    expect(stageFromAgentType('paqad-development')).toBe('development');
    expect(stageFromAgentType('paqad-documentation-sync')).toBe('documentation_sync');
  });

  it('strips the optional paqad: plugin namespace before the paqad- prefix', () => {
    expect(stageFromAgentType('paqad:paqad-development')).toBe('development');
    expect(stageFromAgentType('paqad:paqad-documentation-sync')).toBe('documentation_sync');
  });

  it('returns null for a non-paqad agent or an empty stage', () => {
    expect(stageFromAgentType('general-purpose')).toBeNull();
    expect(stageFromAgentType('paqad-')).toBeNull();
    expect(stageFromAgentType('paqad:general-purpose')).toBeNull();
    expect(stageFromAgentType('paqad:paqad-')).toBeNull();
    expect(stageFromAgentType(null)).toBeNull();
    expect(stageFromAgentType(undefined)).toBeNull();
  });
});

describe('estimateTokens', () => {
  it('is bytes/4 rounded up, and 0 for empty', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('resolveTokenCounts', () => {
  it('uses host usage when present and marks the row exact', () => {
    const counts = resolveTokenCounts(
      { usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30 } },
      'ignored when usage present',
    );
    expect(counts).toEqual({
      tokens_input: 100,
      tokens_cached: 30,
      tokens_output: 20,
      exact: true,
    });
  });

  it('accepts the Codex cached-token field name too', () => {
    const counts = resolveTokenCounts(
      { usage: { input_tokens: 5, output_tokens: 5, cached_input_tokens: 2 } },
      '',
    );
    expect(counts.tokens_cached).toBe(2);
    expect(counts.exact).toBe(true);
  });

  it('estimates from the transcript and marks the row inexact when no usage is present', () => {
    const counts = resolveTokenCounts({}, 'abcdefgh');
    expect(counts).toEqual({
      tokens_input: 2,
      tokens_cached: 0,
      tokens_output: 0,
      exact: false,
    });
  });

  it('defaults cached tokens to 0 when usage has input+output but no cache field', () => {
    const counts = resolveTokenCounts({ usage: { input_tokens: 7, output_tokens: 3 } }, 'ignored');
    expect(counts).toEqual({
      tokens_input: 7,
      tokens_cached: 0,
      tokens_output: 3,
      exact: true,
    });
  });
});

describe('recordStageAgentCompletion', () => {
  it('writes one row keyed on the orchestrator session id for a paqad stage agent', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const written = recordStageAgentCompletion({
      projectRoot: root,
      payload: { agent_id: 'agent_x', agent_type: 'paqad-development' },
      transcriptText: 'some subagent work '.repeat(10),
      adapter: 'claude-code',
    });
    expect(written).toBe(true);

    const rows = readStageAgentRows(root, dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'stage-agent',
      stage: 'development',
      agent: 'paqad-development',
      session_id: 'ses_orch',
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      tokens_used: 48,
      tokens_not_recarried: 48,
      estimate: true,
    });
    expect(rows[0]).not.toHaveProperty('adapter');
    expect(validateStageEvidenceRow(rows[0])).toEqual([]);
  });

  it('adds the requested effort and model from the session stage settings to the one stage-agent row', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    writeStageSettings(root, 'ses_orch', { PAQAD_STAGE_MODEL_REVIEW: 'opus' });
    recordStageAgentCompletion({
      projectRoot: root,
      payload: { agent_id: 'agent_r', agent_type: 'paqad-review' },
      transcriptText: 'review work',
      adapter: 'claude-code',
    });
    const rows = readStageAgentRows(root, dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stage: 'review',
      requested_effort: 'high',
      requested_model: 'opus',
    });
    expect(rows[0]).not.toHaveProperty('effort');
    expect(rows[0]).not.toHaveProperty('model');
    expect(validateStageEvidenceRow(rows[0])).toEqual([]);
  });

  it('leaves the requested effort and model off the row when no stage settings were recorded', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    recordStageAgentCompletion({
      projectRoot: root,
      payload: { agent_type: 'paqad-checks' },
      transcriptText: 'checks work',
      adapter: 'claude-code',
    });
    const [row] = readStageAgentRows(root, dir);
    expect(row).not.toHaveProperty('requested_effort');
    expect(row).not.toHaveProperty('requested_model');
    expect(validateStageEvidenceRow(row)).toEqual([]);
  });

  it('rejects a stage-agent row with an unknown requested effort or model', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    recordStageAgentCompletion({
      projectRoot: root,
      payload: { agent_type: 'paqad-checks' },
      transcriptText: 'checks work',
      adapter: 'claude-code',
    });
    const [row] = readStageAgentRows(root, dir);
    expect(validateStageEvidenceRow({ ...row, requested_effort: 'turbo' })).not.toEqual([]);
    expect(validateStageEvidenceRow({ ...row, requested_model: 'gpt' })).not.toEqual([]);
  });

  it('sums host-reported input and output as tokens_used, still labelled an estimate', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    recordStageAgentCompletion({
      projectRoot: root,
      payload: {
        agent_type: 'paqad-review',
        usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 50 },
      },
      transcriptText: 'review work',
      adapter: 'claude-code',
    });
    const [row] = readStageAgentRows(root, dir);
    expect(row).toMatchObject({ stage: 'review', tokens_used: 1500, estimate: true });
  });

  it('writes nothing, and never throws, when the ledger cannot be appended', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    rmSync(join(root, featureStagePath(dir)));
    mkdirSync(join(root, featureStagePath(dir)));
    expect(
      recordStageAgentCompletion({
        projectRoot: root,
        payload: { agent_type: 'paqad-planning' },
        transcriptText: 'x',
        adapter: 'claude-code',
      }),
    ).toBe(false);
  });

  it('does nothing for a non-paqad subagent', () => {
    const root = tempRoot();
    activeFeature(root);
    const written = recordStageAgentCompletion({
      projectRoot: root,
      payload: { agent_id: 'a', agent_type: 'general-purpose' },
      transcriptText: 'x',
      adapter: 'claude-code',
    });
    expect(written).toBe(false);
  });

  it('does nothing when no feature is active (no bundle to attach to)', () => {
    const root = tempRoot();
    persistLedgerSessionId(root, 'ses_orch');
    const written = recordStageAgentCompletion({
      projectRoot: root,
      payload: { agent_id: 'a', agent_type: 'paqad-planning' },
      transcriptText: 'x',
      adapter: 'claude-code',
    });
    expect(written).toBe(false);
  });

  it('never throws on a malformed payload', () => {
    const root = tempRoot();
    activeFeature(root);
    expect(() =>
      recordStageAgentCompletion({
        projectRoot: root,
        payload: {},
        transcriptText: '',
        adapter: 'claude-code',
      }),
    ).not.toThrow();
  });
});

describe('the stages a resumed agent ran', () => {
  const PLANNER = { agent_id: 'agent_plan_1', agent_type: 'paqad-planning' };

  function complete(root: string, payload: Record<string, unknown>) {
    recordStageAgentCompletion({
      projectRoot: root,
      payload,
      transcriptText: 'x',
      adapter: 'claude-code',
    });
    return readStageAgentRows(root, currentDir.get(root)!).at(-1)!;
  }

  const currentDir = new Map<string, string>();

  function opened(): string {
    const root = tempRoot();
    currentDir.set(root, activeFeature(root));
    return root;
  }

  it('AC-35: lists planning and specification when the planning agent started specification by its id', () => {
    const root = opened();
    const dirName = currentDir.get(root)!;
    for (const stage of ['planning', 'specification']) {
      startStage(root, stage, {
        sessionId: 'ses_orch',
        dirName,
        adapter: 'claude-code',
        agentId: 'agent_plan_1',
      });
    }
    const row = complete(root, PLANNER);
    expect(row).toMatchObject({ stage: 'planning', stages: ['planning', 'specification'] });
    expect(validateStageEvidenceRow(row)).toEqual([]);
  });

  it('AC-35: reads stage start markers from the agent transcript with the marker parse', () => {
    const root = opened();
    const transcript = join(root, 'agent.jsonl');
    writeFileSync(
      transcript,
      [
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: 'paqad:stage planning start' },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'paqad:stage specification start' }],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'paqad:stage review start' },
        }),
      ].join('\n'),
      'utf8',
    );
    const row = complete(root, { ...PLANNER, agent_transcript_path: transcript });
    expect(row.stages).toEqual(['planning', 'specification']);
  });

  it('adds no stages list for an agent that ran only its own stage, or a start by another agent', () => {
    const root = opened();
    startStage(root, 'specification', {
      sessionId: 'ses_orch',
      dirName: currentDir.get(root)!,
      adapter: 'claude-code',
      agentId: 'agent_other',
    });
    const row = complete(root, { ...PLANNER, agent_transcript_path: join(root, 'missing.jsonl') });
    expect(row.stage).toBe('planning');
    expect(row).not.toHaveProperty('stages');
  });
});

describe('stage agent liveness rows (hud-live-run-truth)', () => {
  it('SubagentStart writes one started row and SubagentStop stamps the same agent id, completed', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const payload = { agent_id: 'agent_plan_1', agent_type: 'paqad:paqad-planning' };
    expect(recordStageAgentStart({ projectRoot: root, payload })).toBe(true);
    const unit = readFeatureStageUnit(root, dir).filter((row) => row.kind === 'stage-agent');
    expect(unit).toHaveLength(1);
    expect(unit[0]).toMatchObject({
      stage: 'planning',
      agent_id: 'agent_plan_1',
      event_status: 'started',
      host_pid: process.ppid,
    });
    expect(validateStageEvidenceRow(unit[0])).toEqual([]);
    expect(readStageAgentRows(root, dir)).toHaveLength(0);
    expect(liveStageAgents(readFeatureStageUnit(root, dir))).toHaveLength(1);

    recordStageAgentCompletion({
      projectRoot: root,
      payload,
      transcriptText: 'x',
      adapter: 'claude-code',
    });
    const done = readStageAgentRows(root, dir);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ agent_id: 'agent_plan_1', event_status: 'completed' });
    expect(liveStageAgents(readFeatureStageUnit(root, dir))).toHaveLength(0);
  });

  it('writes no started row for a High Table seat or a non-paqad agent', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    expect(
      recordStageAgentStart({
        projectRoot: root,
        payload: { agent_id: 'a', agent_type: 'paqad-expert' },
      }),
    ).toBe(false);
    expect(
      recordStageAgentStart({
        projectRoot: root,
        payload: { agent_id: 'b', agent_type: 'Explore' },
      }),
    ).toBe(false);
    expect(readFeatureStageUnit(root, dir).filter((row) => row.kind === 'stage-agent')).toEqual([]);
  });
});
