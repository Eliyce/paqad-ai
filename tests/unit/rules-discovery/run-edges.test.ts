import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DecisionStore } from '@/planning/decision-store.js';
import {
  listUnjudgedDecisions,
  readFromDecisions,
  toUnjudged,
  validateFromDecisions,
} from '@/rules-discovery/decisions.js';
import { docsStep, researchNotes } from '@/rules-discovery/docs.js';
import { atomicWriteJson, readJsonFile } from '@/rules-discovery/files.js';
import {
  advanceRun,
  manifestHashes,
  proposeStep,
  reviewStep,
  signoffStep,
} from '@/rules-discovery/flow.js';
import { absRunFile, isRunId, mintRunId, runDirPath } from '@/rules-discovery/paths.js';
import { readProposal } from '@/rules-discovery/proposal.js';
import {
  findOpenRunId,
  listRunIds,
  openRun,
  readRun,
  updateRun,
} from '@/rules-discovery/run-store.js';
import {
  abandonRun,
  checkResume,
  reportLine,
  startRun,
  statusLines,
  writeRunReport,
} from '@/rules-discovery/session.js';
import { openSignoffDecision, readSignoff, touchedRuleFiles } from '@/rules-discovery/signoff.js';

import { TempProject, resolvedPacket } from './fixtures.js';
import { NOW, flowProject, type FlowProject } from './flow-fixtures.js';

const cleanup: Array<{ dispose(): void }> = [];

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()!.dispose();
});

function temp(): TempProject {
  const project = new TempProject('paqad-rd-edges-');
  cleanup.push(project);
  return project;
}

function fresh(): FlowProject {
  const fp = flowProject();
  cleanup.push(fp.project);
  return fp;
}

function writeRaw(root: string, runId: string, body: string): void {
  const path = absRunFile(root, runId, 'run');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function decideAll(fp: FlowProject): void {
  for (const row of readProposal(fp.project.root, fp.runId)!.rows) {
    reviewStep(
      fp.project.root,
      fp.runId,
      row.row_id,
      row.change === 'conflict' ? 'take_new' : 'keep',
    );
  }
}

describe('AC-5 run ids and json files', () => {
  it('AC-5: refuses to build a run folder from an id that is not a run id', () => {
    expect(() => runDirPath('../escape')).toThrow(/invalid rules discovery run id/);
    expect(isRunId(mintRunId(NOW, 'ab12'))).toBe(true);
    expect(isRunId('rd-2026-1')).toBe(false);
  });

  it('AC-5: reports a missing, broken and good json file', () => {
    const project = temp();
    expect(readJsonFile(join(project.root, 'none.json'))).toEqual({ state: 'missing' });
    const broken = readJsonFile(project.write('broken.json', '{'));
    expect(broken.state).toBe('unreadable');
    expect(readJsonFile(project.write('ok.json', '{"a":1}'))).toEqual({
      state: 'ok',
      value: { a: 1 },
    });
  });
});

describe('AC-5 run store edges', () => {
  it('AC-5: reads a bad id, a foreign json and a broken json as unreadable', () => {
    const project = temp();
    expect(readRun(project.root, 'nope')).toEqual({
      state: 'unreadable',
      reason: '"nope" is not a rules discovery run id',
    });
    const runId = mintRunId(NOW);
    writeRaw(project.root, runId, JSON.stringify({ doc_type: 'other' }));
    expect(readRun(project.root, runId)).toEqual({
      state: 'unreadable',
      reason: 'run.json does not hold a rules discovery run',
    });
    writeRaw(project.root, runId, '[');
    expect(readRun(project.root, runId).state).toBe('unreadable');
    writeRaw(project.root, runId, 'null');
    expect(readRun(project.root, runId).state).toBe('unreadable');
  });

  it('AC-5: lists no runs without a rules discovery folder and ignores stray entries', () => {
    const project = temp();
    expect(listRunIds(project.root)).toEqual([]);
    project.write('.paqad/ledger/rules-discovery/notes.txt', 'x');
    mkdirSync(join(project.root, '.paqad/ledger/rules-discovery/not-a-run'), { recursive: true });
    expect(listRunIds(project.root)).toEqual([]);
    expect(findOpenRunId(project.root)).toBeNull();
  });

  it('AC-5: opens a suffixed run when one with the same second exists', () => {
    const project = temp();
    const first = openRun(project.root, NOW);
    const second = openRun(project.root, NOW);
    expect(second.run_id).toBe(`${first.run_id}-2`);
    expect(findOpenRunId(project.root)).toBe(second.run_id);
  });

  it('AC-5: refuses an update to a missing, broken, moved on, closed or backwards run', () => {
    const project = temp();
    const runId = mintRunId(NOW);
    expect(updateRun(project.root, runId, 1, { step: 'decisions' }, NOW)).toMatchObject({
      ok: false,
      reason: 'missing',
    });
    writeRaw(project.root, runId, '{');
    expect(updateRun(project.root, runId, 1, {}, NOW)).toMatchObject({
      ok: false,
      reason: 'unreadable',
    });
    const run = openRun(project.root, new Date('2026-11-02T00:00:00Z'));
    expect(updateRun(project.root, run.run_id, 9, {}, NOW)).toMatchObject({
      ok: false,
      reason: 'revision-mismatch',
    });
    const moved = updateRun(project.root, run.run_id, 1, { step: 'research' }, NOW);
    expect(moved).toMatchObject({ ok: true, record: { revision: 2, step: 'research' } });
    expect(updateRun(project.root, run.run_id, 2, { step: 'decisions' }, NOW)).toMatchObject({
      ok: false,
      reason: 'step-backwards',
    });
    const same = updateRun(project.root, run.run_id, 2, { signoff_decision: 'D-9' }, NOW);
    expect(same.ok && same.record.steps.length).toBe(2);
    const done = updateRun(project.root, run.run_id, 3, { step: 'done' }, NOW);
    expect(done).toMatchObject({ ok: true, record: { status: 'done' } });
    expect(updateRun(project.root, run.run_id, 4, {}, NOW)).toMatchObject({
      ok: false,
      reason: 'closed',
    });
  });
});

describe('AC-5 session edges', () => {
  it('AC-5: opens a run when none is open and resumes one that is not at sign-off', () => {
    const project = temp();
    const opened = startRun(project.root, { now: NOW });
    expect(opened.state).toBe('opened');
    expect(startRun(project.root, { now: NOW })).toMatchObject({
      state: 'resume',
      record: { run_id: opened.record.run_id },
    });
  });

  it('AC-5: names a missing or unreadable run.json as broken and offers start fresh', () => {
    const project = temp();
    const runId = mintRunId(NOW);
    mkdirSync(join(project.root, runDirPath(runId)), { recursive: true });
    expect(startRun(project.root)).toEqual({
      state: 'broken',
      run_id: runId,
      reason: 'run.json is missing',
      offer: 'start fresh',
    });
    expect(statusLines(project.root)[0]).toContain('run.json is missing');
    writeRaw(project.root, runId, '{');
    const broken = startRun(project.root);
    expect(broken.state === 'broken' && broken.reason).toMatch(/^run\.json is unreadable: /);
    expect(statusLines(project.root)[0]).toContain('run.json is unreadable');
  });

  it('AC-5: start fresh over a broken run marks it abandoned and keeps what it can', () => {
    const project = temp();
    const runId = mintRunId(NOW);
    writeRaw(
      project.root,
      runId,
      JSON.stringify({
        revision: 4,
        step: 'research',
        opened_at: '2026-10-01T00:00:00.000Z',
        signoff_decision: 'D-7',
        proposal_hash: 'abc',
        steps: [{ step: 'inventory', at: 'x' }],
      }),
    );
    const outcome = startRun(project.root, { fresh: true, now: NOW });
    expect(outcome.state).toBe('opened');
    expect(readRun(project.root, runId)).toMatchObject({
      state: 'ok',
      record: {
        status: 'abandoned',
        revision: 5,
        step: 'research',
        opened_at: '2026-10-01T00:00:00.000Z',
        signoff_decision: 'D-7',
        proposal_hash: 'abc',
      },
    });
  });

  it('AC-5: abandoning a run with no readable run.json starts its record over', () => {
    const project = temp();
    const runId = mintRunId(NOW);
    writeRaw(project.root, runId, 'not json');
    abandonRun(project.root, runId, NOW);
    expect(readRun(project.root, runId)).toMatchObject({
      state: 'ok',
      record: {
        status: 'abandoned',
        revision: 1,
        step: 'inventory',
        opened_at: NOW.toISOString(),
        signoff_decision: null,
        proposal_hash: null,
        steps: [],
      },
    });
  });

  it('AC-5: abandoning a closed run throws the update refusal', () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    updateRun(project.root, run.run_id, 1, { step: 'done' }, NOW);
    expect(() => abandonRun(project.root, run.run_id, NOW)).toThrow(/is done/);
  });

  it('AC-5: abandoning a run whose sign-off was already answered leaves the decision alone', () => {
    const fp = fresh();
    proposeStep(fp.project.root, fp.runId, NOW);
    decideAll(fp);
    const { decision_id } = signoffStep(fp.project.root, fp.runId, NOW);
    new DecisionStore(fp.project.root).resolve({
      decisionId: decision_id,
      humanResponse: {
        chosen_option_key: 'sign_off',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: NOW.toISOString(),
        responded_by: 'human',
        carry_over_scope: 'none',
      },
    });
    abandonRun(fp.project.root, fp.runId, NOW);
    expect(readSignoff(fp.project.root, decision_id).state).toBe('signed');
    expect(readRun(fp.project.root, fp.runId)).toMatchObject({
      record: { status: 'abandoned' },
    });
  });

  it('AC-5: continuing a run at sign-off resumes it instead of asking', () => {
    const fp = fresh();
    proposeStep(fp.project.root, fp.runId, NOW);
    decideAll(fp);
    signoffStep(fp.project.root, fp.runId, NOW);
    expect(startRun(fp.project.root, { continueOpen: true, now: NOW }).state).toBe('resume');
  });

  it('AC-5: resume checks report a missing and an unreadable run.json', () => {
    const project = temp();
    const runId = mintRunId(NOW);
    expect(checkResume(project.root, runId, 1)).toEqual({
      ok: false,
      run_id: runId,
      reason: 'run.json is missing',
      offer: 'start fresh',
    });
    writeRaw(project.root, runId, '{');
    const check = checkResume(project.root, runId, 1);
    expect(!check.ok && check.reason).toMatch(/^run\.json is unreadable/);
    const run = openRun(project.root, new Date('2026-11-03T00:00:00Z'));
    expect(checkResume(project.root, run.run_id, 1)).toMatchObject({ ok: true });
  });

  it('AC-5: a report without a proposal counts zero rules and offers no checks', () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    const report = writeRunReport(project.root, run.run_id, 2);
    expect(report).toEqual({
      run_id: run.run_id,
      rules_added: 0,
      rules_changed: 0,
      rules_removed: 0,
      decisions_tagged: 0,
      stack_docs_updated: 2,
      checks_offered: 0,
    });
    expect(reportLine(report)).toContain('2 stack docs updated; 0 checks offered.');
    expect(
      JSON.parse(readFileSync(absRunFile(project.root, run.run_id, 'report'), 'utf8')),
    ).toEqual(report);
  });
});

describe('AC-5 flow edges', () => {
  it('AC-5: hashes present manifests and marks missing ones', () => {
    const project = temp();
    project.write('package.json', '{}');
    const hashes = manifestHashes(project.root, ['package.json', 'gone/package.json']);
    expect(hashes['package.json']).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes['gone/package.json']).toBe('missing');
  });

  it('AC-5: advancing a missing or stale run throws and points at start fresh', () => {
    const project = temp();
    const runId = mintRunId(NOW);
    expect(() => advanceRun(project.root, runId, { step: 'decisions' })).toThrow(
      /has a missing run\.json/,
    );
    const run = openRun(project.root, new Date('2026-11-04T00:00:00Z'));
    expect(() => advanceRun(project.root, run.run_id, { step: 'decisions' }, 7)).toThrow(
      /choose start fresh/,
    );
  });

  it('AC-5: review and sign-off refuse a run with no proposal yet', () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    expect(() => reviewStep(project.root, run.run_id, 'P-1', 'keep')).toThrow(/no proposal yet/);
    expect(() => signoffStep(project.root, run.run_id, NOW)).toThrow(/no proposal yet/);
  });

  it('AC-5: sign-off refuses rows still waiting for a verdict', () => {
    const fp = fresh();
    proposeStep(fp.project.root, fp.runId, NOW);
    expect(() => signoffStep(fp.project.root, fp.runId, NOW)).toThrow(/rows without a keep/);
  });
});

describe('AC-5 sign-off decision edges', () => {
  it('AC-5: reuses the pending decision for the same proposal and replaces it when the proposal changed', () => {
    const fp = fresh();
    proposeStep(fp.project.root, fp.runId, NOW);
    decideAll(fp);
    const proposal = readProposal(fp.project.root, fp.runId)!;
    const hash = 'a'.repeat(64);
    const first = openSignoffDecision(fp.project.root, proposal, hash, NOW);
    expect(openSignoffDecision(fp.project.root, proposal, hash, NOW)).toBe(first);
    const second = openSignoffDecision(fp.project.root, proposal, 'b'.repeat(64), NOW);
    expect(second).not.toBe(first);
    expect(readSignoff(fp.project.root, first).state).not.toBe('pending');
    expect(readSignoff(fp.project.root, second).state).toBe('pending');
    expect(readSignoff(fp.project.root, 'D-999').state).toBe('missing');
    expect(touchedRuleFiles(proposal).length).toBeGreaterThan(0);
  });
});

describe('AC-5 docs step edges', () => {
  it('AC-5: refuses a run that is not waiting at the docs step', async () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    await expect(docsStep(project.root, run.run_id, NOW)).rejects.toThrow(
      /not waiting at the docs step/,
    );
    await expect(docsStep(project.root, mintRunId(NOW, 'zz'), NOW)).rejects.toThrow(
      /not waiting at the docs step/,
    );
  });

  it('AC-5: finishes with no stack docs when the run has no inventory', async () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    updateRun(project.root, run.run_id, 1, { step: 'docs' }, NOW);
    const result = await docsStep(project.root, run.run_id, NOW);
    expect(result.updated).toEqual([]);
    expect(result.report.stack_docs_updated).toBe(0);
    expect(readRun(project.root, run.run_id)).toMatchObject({ record: { status: 'done' } });
  });

  it('AC-5: research notes keep the first fact per package and skip sources without one', () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    atomicWriteJson(absRunFile(project.root, run.run_id, 'sources'), [
      { id: 'S-1', fact: 'first', package: 'zod' },
      { id: 'S-2', fact: 'second', package: 'zod' },
      { id: 'S-3', fact: 'no package' },
      { id: 'S-4', package: 'hono' },
    ]);
    expect(Object.fromEntries(researchNotes(project.root, run.run_id))).toEqual({
      zod: 'first',
    });
  });
});

describe('AC-5 decision ideas', () => {
  it('AC-5: rejects a value that is not an object', () => {
    expect(validateFromDecisions(null, new Set())).toEqual([
      'from-decisions.json is not an object',
    ]);
    expect(validateFromDecisions('x', new Set())).toEqual(['from-decisions.json is not an object']);
  });

  it('AC-5: names every broken idea and not-a-rule entry', () => {
    const problems = validateFromDecisions(
      {
        ideas: [
          { idea_id: '', text: ' ', scope: 'everywhere', source_decisions: [] },
          { text: 'ok', scope: 'module:api', source_decisions: ['D-1'] },
          { idea_id: 'DI-3', text: 'ok', scope: 'path:src/**', source_decisions: ['D-9'] },
        ],
        not_rules: [
          { id: 'D-1', reason: 'dup' },
          { id: 'D-8', reason: 'unknown' },
          { id: 'D-2', reason: '' },
          { reason: 'no id' },
        ],
      },
      new Set(['D-1', 'D-2']),
    );
    expect(problems).toEqual([
      'ideas[0] has no idea_id',
      'ideas[0] has no text',
      'ideas[0] scope must be project, module:<name> or path:<glob>',
      'ideas[0] quotes no source decision',
      'ideas[1] has no idea_id',
      'ideas[2] quotes D-9, which is not listed',
      'not_rules[0] D-1 is also quoted by an idea',
      'not_rules[1] names a decision that is not listed',
      'not_rules[2] has no reason',
      'not_rules[3] names a decision that is not listed',
    ]);
  });

  it('AC-5: says both lists are missing when neither is a list', () => {
    expect(validateFromDecisions({ ideas: 'x' }, new Set())).toEqual([
      'ideas must be a list',
      'not_rules must be a list',
    ]);
  });

  it('AC-5: reads a missing file as empty, drops non-list fields and refuses broken json', () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    expect(readFromDecisions(project.root, run.run_id)).toEqual({ ideas: [], not_rules: [] });
    atomicWriteJson(absRunFile(project.root, run.run_id, 'fromDecisions'), { ideas: 'x' });
    expect(readFromDecisions(project.root, run.run_id)).toEqual({ ideas: [], not_rules: [] });
    writeFileSync(absRunFile(project.root, run.run_id, 'fromDecisions'), '{', 'utf8');
    expect(() => readFromDecisions(project.root, run.run_id)).toThrow(/is unreadable/);
  });

  it('AC-5: prefers explicit title, chosen, rationale and change fields on a packet', () => {
    const packet = {
      ...resolvedPacket({ decision_id: 'D-5' }),
      title: 'Validation place',
      chosen: 'service',
      rationale: 'teams own services',
      change: 'feature-x',
    };
    expect(toUnjudged(packet)).toEqual({
      id: 'D-5',
      category: 'architecture-path',
      title: 'Validation place',
      chosen: 'service',
      chosen_label: 'Validate inside each service',
      rationale: 'teams own services',
      change: 'feature-x',
    });
  });

  it('AC-5: falls back to the recommendation reason and nulls when nothing is recorded', () => {
    const packet = resolvedPacket({
      decision_id: 'D-6',
      human_response: undefined,
      recommendation_reason: 'fewer schemas',
      task_session_id: ' ',
    });
    expect(toUnjudged(packet)).toMatchObject({
      chosen: null,
      chosen_label: null,
      rationale: 'fewer schemas',
      change: null,
    });
  });

  it('AC-5: lists delegated decisions and leaves out pending, tagged and sign-off ones', () => {
    const project = temp();
    project.writeResolved(resolvedPacket({ decision_id: 'D-2', status: 'delegated' }));
    project.writeResolved(resolvedPacket({ decision_id: 'D-1' }));
    project.writeResolved(
      resolvedPacket({ decision_id: 'D-3', category: 'rules.proposal' } as never),
    );
    expect(listUnjudgedDecisions(project.root).map((entry) => entry.id)).toEqual(['D-1', 'D-2']);
  });
});
