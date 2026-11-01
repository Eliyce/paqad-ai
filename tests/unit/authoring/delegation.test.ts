import { afterEach, describe, expect, it } from 'vitest';

import { draftAgentHash } from '@/authoring/stages/agent-test.js';
import { runDelegationPlan, runDelegationRecord } from '@/authoring/stages/delegation.js';
import {
  AGENT_STAGES,
  AuthoringRefusal,
  gateSatisfied,
  stageState,
} from '@/authoring/workspace.js';

import {
  AGENT_INTAKE,
  agentForEval,
  cleanAgentProjects,
  put,
  readLoose,
} from '../../shared/agent-pipeline.js';

afterEach(cleanAgentProjects);

function atS6(intake: Record<string, unknown> = AGENT_INTAKE) {
  const workspace = agentForEval(intake);
  workspace.writeJson('benchmark.json', { gate: 'passed', stage: 'S5' });
  return workspace;
}

function requests(positive = 9, negative = 9) {
  return JSON.stringify([
    ...Array.from({ length: positive }, (_, index) => ({
      id: `p${index}`,
      request: `review migration ${index}`,
      should_delegate: true,
    })),
    ...Array.from({ length: negative }, (_, index) => ({
      id: `n${index}`,
      request: `rename variable ${index}`,
      should_delegate: false,
    })),
  ]);
}

function allRight(
  ids: string[],
  description = 'Use this agent when a migration is added.',
  source = 'host',
) {
  return {
    iteration: 1,
    description,
    source,
    results: ids.flatMap((id) => [1, 2, 3].map((run) => ({ id, run, fired: id.startsWith('p') }))),
  };
}

const IDS = [
  ...Array.from({ length: 9 }, (_, i) => `p${i}`),
  ...Array.from({ length: 9 }, (_, i) => `n${i}`),
];
const FRESH = Array.from({ length: 5 }, (_, index) => ({
  request: `fresh ${index}`,
  should_delegate: index % 2 === 0,
  runs: index % 2 === 0 ? [true, true, false] : [false, false, true],
}));

describe('agent delegation (S6)', () => {
  it('AC-59: splits 8 to 10 requests and near-misses 60/40 with seed 42 the same way every run', () => {
    const one = atS6();
    runDelegationPlan(one, requests());
    const two = atS6();
    runDelegationPlan(two, requests());
    const first = one.readJson<{ queries: Array<{ id: string; set: string }> }>(
      'delegation-eval.json',
    )!;
    const second = two.readJson<{ queries: Array<{ id: string; set: string }> }>(
      'delegation-eval.json',
    )!;
    expect(first.queries).toEqual(second.queries);
    expect(first.queries.filter((query) => query.set === 'train')).toHaveLength(10);
  });

  it('refuses fewer than 8 or more than 10 in a group', () => {
    expect(() => runDelegationPlan(atS6(), requests(7, 9))).toThrow(/found 7 and 9/);
    expect(() => runDelegationPlan(atS6(), requests(9, 11))).toThrow(AuthoringRefusal);
  });

  it('AC-10: writes every iteration score with the chosen one marked, at or above 0.9', () => {
    const workspace = atS6();
    runDelegationPlan(workspace, requests());
    const half = {
      ...allRight(IDS),
      iteration: 1,
      results: allRight(IDS).results.map((row) => ({ ...row, fired: false })),
    };
    const result = runDelegationRecord(
      workspace,
      JSON.stringify({
        iterations: [half, { ...allRight(IDS), iteration: 2 }],
        fresh: FRESH,
        cost_usd: 0.4,
      }),
    );
    expect(result.ok).toBe(true);
    const file = readLoose(workspace, 'delegation-results.json');
    expect(file.chosen_iteration).toBe(2);
    expect(file.chosen_score).toBe(1);
    expect(file.iterations.map((entry) => [entry.iteration, entry.chosen, entry.source])).toEqual([
      [1, false, 'host'],
      [2, true, 'host'],
    ]);
    expect(result.lines[1]).toContain('<- chosen');
    expect(stageState(workspace, AGENT_STAGES[6]!).state).toBe('passed');
  });

  it('AC-10: a passing S6 writes the chosen description into the draft and hashes the result', () => {
    const workspace = atS6();
    runDelegationPlan(workspace, requests());
    runDelegationRecord(
      workspace,
      JSON.stringify({ iterations: [allRight(IDS)], fresh: FRESH, cost_usd: 0.1 }),
    );
    expect(workspace.read('draft/migration-reviewer.md')).toContain(
      'description: Use this agent when a migration is added.',
    );
    expect(readLoose(workspace, 'delegation-results.json').inputs_hash).toBe(
      draftAgentHash(workspace),
    );
  });

  it('AC-59: a request delegating in 2 of 3 runs passes while 1 of 3 fails', () => {
    const workspace = atS6();
    runDelegationPlan(workspace, requests());
    const results = allRight(IDS).results.map((row) =>
      row.id === 'p0' && row.run === 3 ? { ...row, fired: false } : row,
    );
    const twoOfThree = runDelegationRecord(
      workspace,
      JSON.stringify({ iterations: [{ ...allRight(IDS), results }], fresh: FRESH }),
    );
    expect(twoOfThree.ok).toBe(true);
    const fresh = [
      ...FRESH.slice(1),
      { request: 'once', should_delegate: true, runs: [true, false, false] },
    ];
    const oneOfThree = runDelegationRecord(
      workspace,
      JSON.stringify({ iterations: [allRight(IDS)], fresh }),
    );
    expect(oneOfThree.lines.at(-1)).toMatch(/fresh requests delegated wrongly: once/);
  });

  it('FR-72: only host-run fresh checks count toward the gate', () => {
    const workspace = atS6();
    runDelegationPlan(workspace, requests());
    const result = runDelegationRecord(
      workspace,
      JSON.stringify({
        iterations: [allRight(IDS, undefined, 'batch')],
        fresh: FRESH.map((entry) => ({ ...entry, source: 'batch' })),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatch(/fresh requests run on the host; found 0/);
    expect(readLoose(workspace, 'delegation-results.json').iterations[0]!.source).toBe('batch');
  });

  it('discards a description over agent_description_max_tokens', () => {
    const workspace = atS6();
    runDelegationPlan(workspace, requests());
    const result = runDelegationRecord(
      workspace,
      JSON.stringify({ iterations: [allRight(IDS, 'x'.repeat(1400))], fresh: FRESH }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatch(/discarded, the description is 350 tokens, over 300/);
  });

  it('a dispatched agent skips S6 and the S7 gate accepts it', () => {
    const workspace = atS6({ ...AGENT_INTAKE, invocation: 'dispatched' });
    const result = runDelegationPlan(workspace, null);
    expect(result.lines[0]).toMatch(/S6 is skipped/);
    expect(workspace.readJson('delegation-results.json')).toMatchObject({
      gate: 'skipped',
      skipped: 'dispatched',
    });
    expect(gateSatisfied(stageState(workspace, AGENT_STAGES[6]!).state)).toBe(true);
  });
});

describe('agent delegation (S6) refusals and options', () => {
  it('plan needs a requests file, and a batch-mode setting names the batch state', () => {
    expect(() => runDelegationPlan(atS6(), null)).toThrow(/delegation plan needs <requests.json>/u);
    const offered = atS6();
    expect(runDelegationPlan(offered, requests(), { batchOffered: true }).lines[1]).toContain(
      'Batch: offered.',
    );
    const off = atS6();
    put(off.projectRoot, '.paqad/.config', 'authoring_batch_mode=off\n');
    expect(runDelegationPlan(off, requests(), { batchOffered: true }).lines[1]).toContain(
      'Batch: off.',
    );
  });

  it('plan reads a request list that is not a JSON array as raw text and refuses it', () => {
    expect(() => runDelegationPlan(atS6(), '{"requests": []}')).toThrow();
    expect(() => runDelegationPlan(atS6(), 'not json')).toThrow();
  });

  it('record needs the plan, a results file and well-formed iterations', () => {
    expect(() => runDelegationRecord(atS6(), '{}')).toThrow(/delegation-eval.json is missing/u);
    const workspace = atS6();
    runDelegationPlan(workspace, requests());
    expect(() => runDelegationRecord(workspace, null)).toThrow(
      /delegation record needs <results.json>/u,
    );
    expect(() => runDelegationRecord(workspace, 'nope')).toThrow(/not valid JSON/u);
    expect(() => runDelegationRecord(workspace, '{"iterations": []}')).toThrow(
      /missing iterations\[\]/u,
    );
    expect(() =>
      runDelegationRecord(workspace, JSON.stringify({ iterations: [{ description: 'x' }] })),
    ).toThrow(/iterations\[0\] is missing description or results\[\]/u);
    const six = Array.from({ length: 6 }, (_, index) => ({
      ...allRight(IDS),
      iteration: index + 1,
    }));
    expect(() => runDelegationRecord(workspace, JSON.stringify({ iterations: six }))).toThrow(
      /at most \d+ description iterations; found 6/u,
    );
    const short = { ...allRight(IDS), results: allRight(IDS).results.slice(3) };
    expect(() => runDelegationRecord(workspace, JSON.stringify({ iterations: [short] }))).toThrow(
      /Iteration 1 is missing results for p0/u,
    );
  });

  it('AC-10: numbers unnumbered iterations, reads batch runs and fails below the threshold', () => {
    const workspace = atS6();
    runDelegationPlan(workspace, requests());
    const wrong = {
      description: 'Use this agent sometimes.',
      source: 'batch',
      results: allRight(IDS).results.map((row) => ({ ...row, fired: false })),
    };
    const result = runDelegationRecord(
      workspace,
      JSON.stringify({
        iterations: [wrong],
        fresh: [{ runs: 'x' }, { request: 'r', source: 'ci' }],
      }),
    );
    expect(result.ok).toBe(false);
    const file = readLoose(workspace, 'delegation-results.json');
    expect(file.iterations.map((entry) => [entry.iteration, entry.source])).toEqual([[1, 'batch']]);
    expect(result.lines.join('\n')).toMatch(/best validation score is/u);
  });
});
