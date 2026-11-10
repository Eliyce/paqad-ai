import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRulesCommand } from '@/cli/commands/rules.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { SkillLoader } from '@/skills/loader.js';
import { applyProposal } from '@/rules-discovery/apply.js';
import { listUnjudgedDecisions } from '@/rules-discovery/decisions.js';
import { docsStep } from '@/rules-discovery/docs.js';
import { proposeStep, reviewStep, signoffStep } from '@/rules-discovery/flow.js';
import { absRunFile } from '@/rules-discovery/paths.js';
import { readProposal } from '@/rules-discovery/proposal.js';
import { readRun, updateRun } from '@/rules-discovery/run-store.js';
import { checkResume, reportLine, startRun, statusLines } from '@/rules-discovery/session.js';
import { SIGN_OFF } from '@/rules-discovery/signoff.js';

import { TempProject } from './fixtures.js';
import { NOW, flowProject, type FlowProject } from './flow-fixtures.js';

const cleanup: Array<{ dispose(): void }> = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (cleanup.length > 0) cleanup.pop()!.dispose();
});

function fresh(): FlowProject {
  const fp = flowProject();
  cleanup.push(fp.project);
  return fp;
}

function waitingAtSignoff(fp: FlowProject): string {
  proposeStep(fp.project.root, fp.runId, NOW);
  for (const row of readProposal(fp.project.root, fp.runId)!.rows) {
    reviewStep(
      fp.project.root,
      fp.runId,
      row.row_id,
      row.change === 'conflict' ? 'take_new' : 'keep',
    );
  }
  return signoffStep(fp.project.root, fp.runId, NOW).decision_id;
}

async function cli(root: string, ...args: string[]): Promise<string> {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line: string) => lines.push(String(line)));
  await createRulesCommand().parseAsync(['discovery', ...args, '--project-root', root], {
    from: 'user',
  });
  process.exitCode = 0;
  return lines.join('\n');
}

describe('rules discovery run state', () => {
  it('AC-63 asks to continue or start fresh when a run waits on its sign-off', () => {
    const fp = fresh();
    waitingAtSignoff(fp);
    const outcome = startRun(fp.project.root, { now: NOW });
    expect(outcome.state).toBe('choose');
    expect(outcome.state === 'choose' && outcome.question).toContain('Continue it or start fresh?');
    expect(startRun(fp.project.root, { now: NOW, continueOpen: true }).state).toBe('resume');
  });

  it('AC-64 start fresh abandons the old run, answers its sign-off not now and leaves decisions untagged', () => {
    const fp = fresh();
    const decisionId = waitingAtSignoff(fp);
    const outcome = startRun(fp.project.root, {
      fresh: true,
      now: new Date('2026-11-02T00:00:00Z'),
    });
    expect(outcome.state).toBe('opened');
    expect(outcome.state === 'opened' && outcome.record.run_id).not.toBe(fp.runId);
    const old = readRun(fp.project.root, fp.runId);
    expect(old.state === 'ok' && old.record.status).toBe('abandoned');
    const answered = new DecisionStore(fp.project.root).readResolved(decisionId)!;
    expect(answered.human_response?.chosen_option_key).toBe('not_now');
    expect(listUnjudgedDecisions(fp.project.root).map((d) => d.id)).toEqual(['D-1', 'D-2', 'D-3']);
  });

  it('AC-65 reports a missing, unreadable or changed run.json and offers start fresh', () => {
    const fp = fresh();
    const record = readRun(fp.project.root, fp.runId);
    const revision = record.state === 'ok' ? record.record.revision : 0;
    expect(checkResume(fp.project.root, fp.runId, revision).ok).toBe(true);
    updateRun(fp.project.root, fp.runId, revision, { step: 'decisions' });
    const changed = checkResume(fp.project.root, fp.runId, revision);
    expect(changed).toMatchObject({ ok: false, offer: 'start fresh' });
    expect(!changed.ok && changed.reason).toMatch(/another session changed it/);
    expect(() => proposeStep(fp.project.root, fp.runId, NOW, revision)).toThrow(/start fresh/);
    writeFileSync(absRunFile(fp.project.root, fp.runId, 'run'), '{ broken');
    expect(checkResume(fp.project.root, fp.runId, revision)).toMatchObject({
      ok: false,
      offer: 'start fresh',
    });
    expect(startRun(fp.project.root, { now: NOW })).toMatchObject({
      state: 'broken',
      offer: 'start fresh',
    });
    expect(startRun(fp.project.root, { now: NOW, fresh: true }).state).toBe('opened');
  });

  it('AC-66 a finished run reports every count', async () => {
    const fp = fresh();
    const decisionId = waitingAtSignoff(fp);
    new DecisionStore(fp.project.root).resolve({
      decisionId,
      humanResponse: {
        chosen_option_key: SIGN_OFF,
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: NOW.toISOString(),
        responded_by: 'human',
        carry_over_scope: 'none',
      },
    });
    applyProposal(fp.project.root, fp.runId, { now: NOW });
    const { report } = await docsStep(fp.project.root, fp.runId, NOW);
    expect(report).toEqual({
      run_id: fp.runId,
      rules_added: 2,
      rules_changed: 1,
      rules_removed: 1,
      decisions_tagged: 3,
      stack_docs_updated: 3,
      checks_offered: 1,
    });
    expect(reportLine(report)).toBe(
      'done — 2 rules added, 1 changed, 1 removed; 3 decisions tagged; 3 stack docs updated; 1 checks offered.',
    );
    expect(
      JSON.parse(readFileSync(absRunFile(fp.project.root, fp.runId, 'report'), 'utf8')),
    ).toEqual(report);
    const run = readRun(fp.project.root, fp.runId);
    expect(run.state === 'ok' && run.record).toMatchObject({ step: 'done', status: 'done' });
  });

  it('AC-67 status prints the open run or that none is open', async () => {
    const empty = new TempProject();
    cleanup.push(empty);
    expect(statusLines(empty.root)).toEqual(['no rules discovery run is open.']);
    expect(await cli(empty.root, 'status')).toContain('no rules discovery run is open.');
    const fp = fresh();
    const printed = await cli(fp.project.root, 'status');
    expect(printed).toContain(
      `run ${fp.runId} · step inventory · open · opened ${NOW.toISOString()}`,
    );
    expect(printed).toContain(`updated ${NOW.toISOString()}`);
  });

  it('AC-65 the start verb refuses a broken run and points at start fresh', async () => {
    const fp = fresh();
    writeFileSync(absRunFile(fp.project.root, fp.runId, 'run'), '{ broken');
    expect(await cli(fp.project.root, 'start')).toContain('start --fresh');
  });

  it('AC-68 rules-discovery is the only skill the rules-discovery workflow triggers', async () => {
    const base = join(process.cwd(), 'runtime/base/skills');
    const names = ['rules-discovery', 'rules-decision-miner', 'rules-researcher', 'rules-proposer'];
    const skills = await new SkillLoader().load(
      readdirSync(base)
        .map((dir) => ({ path: join(base, dir, 'SKILL.md'), level: 0 as const, source: dir }))
        .filter((artifact) => existsSync(artifact.path)),
    );
    const triggered = skills
      .filter((skill) =>
        skill.triggers.some((trigger) => JSON.stringify(trigger).includes('"rules-discovery"')),
      )
      .map((skill) => skill.name);
    expect(triggered).toEqual(['rules-discovery']);
    for (const name of names) expect(skills.map((skill) => skill.name)).toContain(name);
  });
});
