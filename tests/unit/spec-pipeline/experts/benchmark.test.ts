import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readAuthoringDecision } from '@/authoring/decisions.js';
import { readContractDecisions } from '@/decisions/authoring.js';
import {
  BenchmarkRefusal,
  benchmarkPlanLines,
  HIGH_TABLE_BENCHMARK,
  missingTrials,
  parseChanges,
  plannedTrials,
  recordHighTableBenchmark,
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
