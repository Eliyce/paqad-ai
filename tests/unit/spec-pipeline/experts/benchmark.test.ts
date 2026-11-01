import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readAuthoringDecision } from '@/authoring/decisions.js';
import { readContractDecisions, resolvePendingDecision } from '@/decisions/authoring.js';
import {
  BenchmarkRefusal,
  benchmarkPlanLines,
  HIGH_TABLE_BENCHMARK,
  KEEP_SEATS_OPTION,
  missingTrials,
  parseBenchmarkRuns,
  parseChanges,
  plannedTrials,
  recordHighTableBenchmark,
  summariseForms,
  SWITCH_SKILLS_OPTION,
  type BenchmarkRun,
} from '@/spec-pipeline/experts/benchmark.js';
import { buildExpertBriefs } from '@/spec-pipeline/experts/brief.js';
import { validateExpertNotes } from '@/spec-pipeline/experts/notes.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-ht-benchmark-'));
  roots.push(root);
  return root;
}

const CHANGES = ['ORD-501', 'ORD-502', 'ORD-503'];

const MAIN_BRIEF_HASH = 'c792638b34f02db41621412177f48fdcb1fbdd18fcad5bff3bb286db80de4bd1';
const MAIN_NOTES = {
  ok: true,
  artifact: {
    notes: [
      {
        role: 'db-expert',
        findings: [
          {
            id: 'EX-db-expert-1',
            target: 'invoices',
            claim: 'every new filter needs an index on invoices.customer_id',
            kind: 'requirement',
            severity: 'must',
          },
        ],
      },
    ],
    tokens: { 'db-expert': 900 },
  },
};

function runs(drop = 0): BenchmarkRun[] {
  return plannedTrials(CHANGES)
    .slice(drop)
    .map((trial) => ({
      ...trial,
      findings: trial.form === 'A' ? ['index', 'auth'] : ['index'],
      accepted: ['index'],
      questions: 1,
      tokens: trial.form === 'A' ? 9000 : 6000,
      wall_ms: trial.form === 'A' ? 30000 : 50000,
      cost_usd: 0.05,
    }));
}

describe('experts benchmark', () => {
  it('needs at least three changes and plans 3 trials of 2 forms each with the worst-case spend', () => {
    expect(() => parseChanges('a,b')).toThrow(BenchmarkRefusal);
    expect(parseChanges('c, a,b,a')).toEqual(['a', 'b', 'c']);
    expect(plannedTrials(CHANGES)).toHaveLength(18);
    const lines = benchmarkPlanLines(project(), CHANGES);
    expect(lines[0]).toMatch(/18 trials, worst-case spend \$\d/u);
    expect(lines.join('\n')).toContain('paqad never calls a model here');
  });

  it('AC-20: records both forms and raises exactly one workflow-or-tool packet, reused for the same change set', () => {
    const root = project();
    const text = JSON.stringify({ runs: runs() });
    const first = recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: text,
    });
    expect(first.ok).toBe(true);
    const file = JSON.parse(readFileSync(join(root, HIGH_TABLE_BENCHMARK), 'utf8'));
    expect(
      file.forms.map((form: { form: string; only_this_form: number }) => [
        form.form,
        form.only_this_form,
      ]),
    ).toEqual([
      ['A', 3],
      ['B', 0],
    ]);
    expect(file.forms[0].latency.measure).toBe('median');
    const packet = readContractDecisions(root).find((row) => row.packet.id === first.decision)!;
    expect(packet.packet.category).toBe('workflow-or-tool');
    expect(packet.packet.options.map((entry) => entry.label)).toEqual([
      'Keep parallel seats',
      'Switch to skills in the chief',
    ]);
    expect(packet.packet.options[0]!.one_line_preview).toContain('median 9000 tokens');
    const again = recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: text,
    });
    expect(again.decision).toBe(first.decision);
    expect(readContractDecisions(root)).toHaveLength(1);
    expect(readAuthoringDecision(root, first.decision!)?.status).toBe('pending');
  });

  it('a run stopped halfway writes nothing final, raises no packet and says how to resume', () => {
    const root = project();
    const result = recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: JSON.stringify({ runs: runs(4) }),
    });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain('4 of 18 trials are missing');
    expect(result.lines[1]).toContain('Resume: run only the missing trials');
    expect(readContractDecisions(root)).toEqual([]);
    expect(missingTrials(CHANGES, runs())).toEqual([]);
    expect(() =>
      recordHighTableBenchmark({
        projectRoot: root,
        changes: CHANGES,
        resultsText: '{"runs":[{}]}',
      }),
    ).toThrow(/runs\[0\] needs change/);
  });

  it('AC-63: with the benchmark packet unresolved, experts brief and experts notes output match main', () => {
    const root = project();
    recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: JSON.stringify({ runs: runs() }),
    });
    expect(
      readContractDecisions(root).filter((decision) => decision.status === 'pending'),
    ).toHaveLength(1);
    const { briefs } = buildExpertBriefs({
      needs: [{ role: 'db-expert', reason: 'touches the invoices migration' }],
      request: 'Let customers download their invoices as CSV',
      grounding: {
        references: [{ kind: 'doc', ref: 'docs/modules/billing/index.md' }],
        terms: ['invoice'],
        sparse: false,
        path: 'docs-fallback',
      },
      label: { label: 'clear', signals: [], question_budget: 3 },
      ceiling: 60000,
    });
    expect(briefs[0]!.hash).toBe(MAIN_BRIEF_HASH);
    expect(
      validateExpertNotes({
        notes: [
          {
            role: 'db-expert',
            findings: [
              {
                target: 'invoices',
                claim: 'every new filter needs an index on invoices.customer_id',
                kind: 'requirement',
                severity: 'must',
              },
            ],
            questions: [],
          },
        ],
        tokens: { 'db-expert': 900 },
      }),
    ).toEqual(MAIN_NOTES);
  });

  it('AC-20: no High Table code path reads the benchmark, so notes validate the same with a pending packet', () => {
    const root = project();
    const notes = {
      notes: [{ role: 'db-expert', findings: [{ target: 'invoices', claim: 'index it' }] }],
    };
    const before = validateExpertNotes(notes);
    recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: JSON.stringify({ runs: runs() }),
    });
    expect(validateExpertNotes(notes)).toEqual(before);
    const readers = execFileSync('git', ['grep', '-l', 'experts/benchmark', '--', 'src'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    expect(readers).toEqual(['src/cli/commands/spec-pipeline.ts']);
  });
});

describe('experts benchmark results parsing and packet reuse', () => {
  it('refuses a results file that is not JSON or has no runs array', () => {
    expect(() => parseBenchmarkRuns('not json')).toThrow(/not valid JSON/u);
    expect(() => parseBenchmarkRuns('null')).toThrow(/needs a runs\[\] array/u);
    expect(() => parseBenchmarkRuns('{"runs":{}}')).toThrow(/needs a runs\[\] array/u);
    expect(() => parseBenchmarkRuns('{"runs":[null]}')).toThrow(/runs\[0\] needs change/u);
  });

  it('refuses a run with a bad form, a fractional trial, a negative count or non-string findings', () => {
    const good = { change: 'a', form: 'A', trial: 1, findings: [], accepted: [] };
    const base = { ...good, questions: 0, tokens: 1, wall_ms: 1 };
    for (const bad of [
      { ...base, form: 'C' },
      { ...base, trial: 1.5 },
      { ...base, tokens: -1 },
      { ...base, wall_ms: Number.NaN },
      { ...base, findings: [1] },
      { ...base, accepted: 'x' },
      { ...base, questions: '1' },
      { ...base, change: 7 },
    ]) {
      expect(() => parseBenchmarkRuns(JSON.stringify({ runs: [bad] }))).toThrow(BenchmarkRefusal);
    }
  });

  it('keeps queue_ms and cost_usd only when they are non-negative numbers', () => {
    const base = {
      change: 'a',
      form: 'B',
      trial: 2,
      findings: ['x'],
      accepted: [],
      questions: 0,
      tokens: 10,
      wall_ms: 20,
    };
    const [kept, dropped] = parseBenchmarkRuns(
      JSON.stringify({
        runs: [
          { ...base, queue_ms: 5, cost_usd: 0.1 },
          { ...base, queue_ms: -5, cost_usd: 'free' },
        ],
      }),
    );
    expect(kept).toMatchObject({ queue_ms: 5, cost_usd: 0.1 });
    expect(dropped).not.toHaveProperty('queue_ms');
    expect(dropped).not.toHaveProperty('cost_usd');
  });

  it('takes the median of an even sample and zero for a form with no runs', () => {
    const run = (form: 'A' | 'B', tokens: number): BenchmarkRun => ({
      change: 'a',
      form,
      trial: 1,
      findings: [],
      accepted: [],
      questions: 0,
      tokens,
      wall_ms: tokens,
      queue_ms: tokens,
    });
    const [a, b] = summariseForms([run('A', 10), run('A', 30)]);
    expect(a!.tokens_median).toBe(20);
    expect(a!.queue_ms_median).toBe(20);
    expect(b!.tokens_median).toBe(0);
    expect(b!.questions).toBe(0);
  });

  it('lists only the first five missing trials and drops runs for changes outside the set', () => {
    const root = project();
    const extra = { ...runs()[0]!, change: 'ORD-999' };
    const result = recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: JSON.stringify({ runs: [...runs(7), extra] }),
    });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain('7 of 18 trials are missing');
    expect(result.lines[0]).toContain(', ...)');
    expect(result.lines[1]).toContain('(11 kept)');
  });

  it('AC-20: recommends switching to skills when form B matches as many accepted findings for fewer tokens', () => {
    const root = project();
    const cheaperB = runs().map((run) => ({
      ...run,
      tokens: run.form === 'B' ? 1000 : 9000,
    }));
    const result = recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: JSON.stringify({ runs: cheaperB }),
      change: 'ORD-600',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    });
    const packet = readContractDecisions(root).find((row) => row.packet.id === result.decision)!;
    expect(packet.packet.recommendation).toBe(SWITCH_SKILLS_OPTION);
    const file = JSON.parse(readFileSync(join(root, HIGH_TABLE_BENCHMARK), 'utf8'));
    expect(file.recorded_at).toBe('2026-01-02T03:04:05.000Z');
    expect(file.spend_usd).toBe(0.9);
    expect(result.lines[2]).not.toContain('is reused');
  });

  it('AC-20: raises a new packet when the earlier one was resolved, the change set differs or the record is unreadable', () => {
    const root = project();
    const text = JSON.stringify({ runs: runs() });
    const first = recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: text,
    });
    resolvePendingDecision(root, first.decision!, KEEP_SEATS_OPTION);
    const second = recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: text,
    });
    expect(second.decision).not.toBe(first.decision);

    const wider = [...CHANGES, 'ORD-504'];
    const widerRuns = plannedTrials(wider).map((trial) => ({ ...runs()[0]!, ...trial }));
    const third = recordHighTableBenchmark({
      projectRoot: root,
      changes: wider,
      resultsText: JSON.stringify({ runs: widerRuns }),
    });
    expect(third.decision).not.toBe(second.decision);

    const path = join(root, HIGH_TABLE_BENCHMARK);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{broken');
    const fourth = recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: text,
    });
    expect(fourth.decision).not.toBe(second.decision);
    expect(fourth.ok).toBe(true);
  });

  it('AC-20: a previous record with no decision raises a fresh packet for the same change set', () => {
    const root = project();
    const path = join(root, HIGH_TABLE_BENCHMARK);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ changes: CHANGES, decision: null }));
    const result = recordHighTableBenchmark({
      projectRoot: root,
      changes: CHANGES,
      resultsText: JSON.stringify({ runs: runs() }),
    });
    expect(result.decision).not.toBeNull();
    expect(readContractDecisions(root)).toHaveLength(1);
  });
});
