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
