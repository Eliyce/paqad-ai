import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  changeCostWindow,
  computeChangeCost,
  updateCostCache,
  writeChangeCost,
} from '@/cost/change-cost.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { hudVerdictPath } from '@/hud/files.js';
import { buildHudSnapshot, type HudSnapshot } from '@/hud/snapshot.js';
import { deferCompletionForBackgroundStage } from '@/stage-evidence/completion-deferred.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';
import {
  recordStageAgentCompletion,
  recordStageAgentStart,
} from '@/stage-isolation/subagent-completion.js';

import { desktopHeadline, stageStrip } from '../../../runtime/claude-plugin/mod/desktop-view.ts';
import { IDLE_LIVE, type LiveState } from '../../../runtime/claude-plugin/mod/live.ts';
import { parseSnapshot } from '../../../runtime/claude-plugin/mod/model.ts';

import { cleanupScopeFixtures, openChangeHere, repoRoot } from './scope-fixtures.js';

afterEach(cleanupScopeFixtures);

interface ReplayStep {
  at: number;
  event:
    | 'stage_start'
    | 'stage_end'
    | 'agent_start'
    | 'agent_stop'
    | 'usage'
    | 'turn_end'
    | 'permission_ask';
  stage?: string;
  agent_id?: string;
  artifact?: 'plan' | 'specification';
  tokens?: number;
  background_tasks?: unknown[];
  tool_use_id?: string;
}

const REPLAY = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/hud/live-run-replay.json'), 'utf8'),
) as { lane: 'full'; steps: ReplayStep[] };

const S = 'ses-replay';
const OPENED = Date.parse('2026-10-19T10:00:00.000Z');
const clock = (seconds: number) => () => new Date(OPENED + seconds * 1000);

const FALSE_FLAGS = ['isolation-missing', 'rules-not-loaded', 'branch:shared'];

function usageLine(id: string, seconds: number, tokens: number): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: clock(seconds)().toISOString(),
    message: {
      id,
      model: 'claude-opus-5-5',
      role: 'assistant',
      content: [{ type: 'text', text: 'x' }],
      usage: {
        input_tokens: tokens,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  });
}

function agentPayload(step: ReplayStep) {
  return {
    agent_id: step.agent_id,
    agent_type: `paqad-${step.stage}`,
    session_id: S,
  };
}

describe('AC-7 / NFR-4: the scrubbed replay of a healthy full-lane run', () => {
  it('never judges, never paints red, raises no false flag, never waits on the person, and counts tokens up', () => {
    const root = repoRoot();
    const dir = openChangeHere(root, S, 'X-1 replayed change', REPLAY.lane, clock(0)());
    const transcript = join(root, 'transcripts', 'main.jsonl');
    mkdirSync(join(root, 'transcripts'), { recursive: true });
    writeFileSync(transcript, '');
    let spent = 0;
    const live: LiveState = IDLE_LIVE;
    const tokensSeen: number[] = [];

    const checkHud = (seconds: number): HudSnapshot => {
      const now = clock(seconds);
      const snapshot = buildHudSnapshot(root, S, { now, turnRunning: true });
      expect(snapshot.scope.qualified, `t=${seconds}`).toBe(true);
      expect(snapshot.verdict, `t=${seconds}`).toBeNull();
      expect(snapshot.headline.tone, `t=${seconds}`).not.toBe('bad');
      expect(snapshot.headline.text, `t=${seconds}`).not.toMatch(/half done/i);
      const flags = snapshot.flags.map((flag) => flag.id);
      for (const id of FALSE_FLAGS) expect(flags, `t=${seconds}`).not.toContain(id);
      const mod = parseSnapshot(JSON.stringify(snapshot))!;
      const head = desktopHeadline(mod, now().getTime(), live);
      expect(head.text, `t=${seconds}`).not.toContain('Waiting for your permission');
      expect(stageStrip(mod, live).value, `t=${seconds}`).not.toContain('paused');
      return snapshot;
    };

    for (const step of REPLAY.steps) {
      const now = clock(step.at);
      const at = { sessionId: S, dirName: dir, adapter: 'claude-code', now };
      if (step.event === 'stage_start') startStage(root, step.stage!, at);
      if (step.event === 'stage_end') {
        const artifact = featureFilePath(dir, step.artifact!);
        writeFileSync(join(root, artifact), `{"${step.artifact}":true}\n`);
        endStage(root, step.stage!, { artifactPaths: [artifact] }, at);
      }
      if (step.event === 'agent_start') {
        recordStageAgentStart({ projectRoot: root, payload: agentPayload(step), now });
      }
      if (step.event === 'agent_stop') {
        recordStageAgentCompletion({
          projectRoot: root,
          payload: agentPayload(step),
          transcriptText: 'done',
          adapter: 'claude-code',
          now,
        });
      }
      if (step.event === 'usage') {
        appendFileSync(transcript, `${usageLine(`m-${step.at}`, step.at, step.tokens! - spent)}\n`);
        spent = step.tokens!;
        updateCostCache({
          projectRoot: root,
          sessionId: S,
          dirName: dir,
          payload: { transcript_path: transcript },
          floor: changeCostWindow(root, dir, now)!.from,
        });
        writeChangeCost(root, dir, computeChangeCost(root, dir, { now })!);
      }
      if (step.event === 'turn_end') {
        const deferral = deferCompletionForBackgroundStage({
          projectRoot: root,
          backgroundTasks: step.background_tasks,
          sessionId: S,
          adapter: 'claude-code',
          now,
        });
        expect(deferral.deferred, `turn end at t=${step.at}`).toBe(true);
      }
      const snapshot = checkHud(step.at);
      if (step.event === 'usage') tokensSeen.push(snapshot.cost?.tokens.total ?? 0);
    }

    const rows = readFeatureStageUnit(root, dir);
    expect(rows.some((row) => row.kind === 'verify')).toBe(false);
    expect(rows.some((row) => row.evidence_source === 'inferred-git')).toBe(false);
    expect(tokensSeen[0]).toBeGreaterThan(0);
    for (let index = 1; index < tokensSeen.length; index += 1) {
      expect(tokensSeen[index]).toBeGreaterThan(tokensSeen[index - 1]!);
    }
  });
});

describe('a verdict judged while a background stage agent runs', () => {
  const failedEarly = (root: string, dir: string, seconds: number) =>
    writeFileSync(
      hudVerdictPath(root, S),
      JSON.stringify({
        schema: 'paqad.hud-verdict/1',
        session_id: S,
        change: dir,
        word: 'Needs your attention',
        kind: 'fail',
        work_kind: 'fail',
        passed: false,
        reasons: [],
        written_at: clock(seconds)().toISOString(),
      }),
    );

  const startBuild = (root: string, dir: string, withAgent: boolean) => {
    const now = clock(10);
    startStage(root, 'development', { sessionId: S, dirName: dir, adapter: 'claude-code', now });
    if (withAgent) {
      recordStageAgentStart({
        projectRoot: root,
        payload: agentPayload({
          at: 11,
          event: 'agent_start',
          stage: 'development',
          agent_id: 'a',
        }),
        now: clock(11),
      });
    }
  };

  it('keeps the running Build as the headline, never Needs your attention', () => {
    const root = repoRoot();
    const dir = openChangeHere(root, S, 'X-2 replayed change', 'full', clock(0)());
    startBuild(root, dir, true);
    mkdirSync(dirname(hudVerdictPath(root, S)), { recursive: true });
    failedEarly(root, dir, 20);

    const snapshot = buildHudSnapshot(root, S, { now: clock(30) });
    expect(snapshot.verdict?.kind).toBe('fail');
    expect(snapshot.headline).toMatchObject({ row: 15, tone: 'working' });
    const head = desktopHeadline(parseSnapshot(JSON.stringify(snapshot))!, clock(30)().getTime());
    expect(head.text).not.toContain('Needs your attention');
  });

  it('shows the verdict once no stage agent holds the stage, without the bare verdict words', () => {
    const root = repoRoot();
    const dir = openChangeHere(root, S, 'X-3 replayed change', 'full', clock(0)());
    startBuild(root, dir, false);
    mkdirSync(dirname(hudVerdictPath(root, S)), { recursive: true });
    failedEarly(root, dir, 20);

    const snapshot = buildHudSnapshot(root, S, { now: clock(30) });
    expect(snapshot.headline).toMatchObject({ row: 13, text: 'Inconclusive', tone: 'warn' });
  });
});
