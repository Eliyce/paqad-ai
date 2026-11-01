import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readAuthoringConfig } from '@/authoring/config.js';
import { option, readAuthoringDecision } from '@/authoring/decisions.js';
import { AUTHORING_LEDGER_DIR } from '@/authoring/evidence.js';
import { latencyMeasure } from '@/authoring/eval/passk.js';
import { readTextIfPresent, writeFileAtomic } from '@/authoring/fs-io.js';
import { createPendingDecision } from '@/decisions/authoring.js';

export const HIGH_TABLE_BENCHMARK = `${AUTHORING_LEDGER_DIR}/high-table-benchmark.json`;
export const BENCHMARK_MIN_CHANGES = 3;
export const BENCHMARK_TRIALS = 3;
export const BENCHMARK_FORMS = ['A', 'B'] as const;
export type BenchmarkForm = (typeof BENCHMARK_FORMS)[number];
export const KEEP_SEATS_OPTION = 'keep-parallel-seats';
export const SWITCH_SKILLS_OPTION = 'switch-to-skills';

export const FORM_DESCRIPTIONS: Record<BenchmarkForm, string> = {
  A: 'parallel paqad-expert seats plus the chief architect',
  B: 'each expert lens loaded as a skill, in turn, into one chief architect context',
};

export class BenchmarkRefusal extends Error {}

export interface BenchmarkTrial {
  change: string;
  form: BenchmarkForm;
  trial: number;
}

export interface BenchmarkRun extends BenchmarkTrial {
  findings: string[];
  accepted: string[];
  questions: number;
  tokens: number;
  wall_ms: number;
  queue_ms?: number;
  cost_usd?: number;
}

export interface FormSummary {
  form: BenchmarkForm;
  description: string;
  accepted_matched: number;
  only_this_form: number;
  questions: number;
  tokens_median: number;
  wall_ms_median: number;
  latency: { value: number; measure: 'p95' | 'median'; samples: number };
  queue_ms_median: number;
}

export interface HighTableBenchmark {
  changes: string[];
  trials: number;
  forms: FormSummary[];
  spend_usd: number;
  worst_case_usd: number;
  decision: string | null;
  recorded_at: string;
}

export function parseChanges(value: string): string[] {
  const changes = [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    ),
  ];
  if (changes.length < BENCHMARK_MIN_CHANGES) {
    throw new BenchmarkRefusal(
      `experts benchmark needs at least ${BENCHMARK_MIN_CHANGES} changes; got ${changes.length}.`,
    );
  }
  return changes.sort();
}

export function plannedTrials(changes: readonly string[]): BenchmarkTrial[] {
  return changes.flatMap((change) =>
    BENCHMARK_FORMS.flatMap((form) =>
      Array.from({ length: BENCHMARK_TRIALS }, (_, index) => ({
        change,
        form,
        trial: index + 1,
      })),
    ),
  );
}

export function worstCaseSpend(projectRoot: string, changes: readonly string[]): number {
  const cap = readAuthoringConfig(projectRoot).authoring_run_max_cost_usd;
  return Math.round(plannedTrials(changes).length * cap * 1e6) / 1e6;
}

export function benchmarkPlanLines(projectRoot: string, changes: readonly string[]): string[] {
  const trials = plannedTrials(changes);
  const cap = readAuthoringConfig(projectRoot).authoring_run_max_cost_usd;
  return [
    `High Table benchmark: ${changes.length} changes x ${BENCHMARK_TRIALS} trials x 2 forms = ${trials.length} trials, worst-case spend $${worstCaseSpend(projectRoot, changes)} ($${cap} cap per trial).`,
    `Form A: ${FORM_DESCRIPTIONS.A}. Form B: ${FORM_DESCRIPTIONS.B}.`,
    'paqad never calls a model here. Replay the spec review of each change in a fresh context per trial, ' +
      'under the per-trial spend cap, and write a results file as {runs: [{change, form, trial, findings[], accepted[], questions, tokens, wall_ms, queue_ms?, cost_usd?}]}.',
    `Then run paqad-ai spec pipeline experts benchmark --changes ${changes.join(',')} --results <file>.`,
  ];
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : null;
}

export function parseBenchmarkRuns(text: string): BenchmarkRun[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BenchmarkRefusal('the results file is not valid JSON.');
  }
  const runs = (parsed as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(runs)) throw new BenchmarkRefusal('the results file needs a runs[] array.');
  return runs.map((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const findings = strings(row.findings);
    const accepted = strings(row.accepted);
    const questions = number(row.questions);
    const tokens = number(row.tokens);
    const wall = number(row.wall_ms);
    if (
      typeof row.change !== 'string' ||
      !BENCHMARK_FORMS.includes(row.form as BenchmarkForm) ||
      !Number.isInteger(row.trial) ||
      findings === null ||
      accepted === null ||
      questions === null ||
      tokens === null ||
      wall === null
    ) {
      throw new BenchmarkRefusal(
        `runs[${index}] needs change, form (A or B), trial, findings[], accepted[], questions, tokens and wall_ms.`,
      );
    }
    return {
      change: row.change,
      form: row.form as BenchmarkForm,
      trial: row.trial as number,
      findings,
      accepted,
      questions,
      tokens,
      wall_ms: wall,
      ...(number(row.queue_ms) === null ? {} : { queue_ms: number(row.queue_ms)! }),
      ...(number(row.cost_usd) === null ? {} : { cost_usd: number(row.cost_usd)! }),
    };
  });
}

export function missingTrials(
  changes: readonly string[],
  runs: readonly BenchmarkRun[],
): BenchmarkTrial[] {
  const key = (trial: BenchmarkTrial) => `${trial.change}:${trial.form}:${trial.trial}`;
  const have = new Set(runs.map(key));
  return plannedTrials(changes).filter((trial) => !have.has(key(trial)));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function found(runs: readonly BenchmarkRun[], form: BenchmarkForm, pick: 'findings' | 'accepted') {
  const set = new Set<string>();
  for (const run of runs.filter((entry) => entry.form === form)) {
    for (const item of run[pick]) set.add(`${run.change}:${item}`);
  }
  return set;
}

export function summariseForms(runs: readonly BenchmarkRun[]): FormSummary[] {
  return BENCHMARK_FORMS.map((form) => {
    const mine = runs.filter((entry) => entry.form === form);
    const other = form === 'A' ? 'B' : 'A';
    const theirs = found(runs, other, 'findings');
    return {
      form,
      description: FORM_DESCRIPTIONS[form],
      accepted_matched: found(runs, form, 'accepted').size,
      only_this_form: [...found(runs, form, 'findings')].filter((item) => !theirs.has(item)).length,
      questions: mine.reduce((sum, entry) => sum + entry.questions, 0),
      tokens_median: median(mine.map((entry) => entry.tokens)),
      wall_ms_median: median(mine.map((entry) => entry.wall_ms)),
      latency: latencyMeasure(mine.map((entry) => entry.wall_ms)),
      queue_ms_median: median(mine.map((entry) => entry.queue_ms ?? 0)),
    };
  });
}

function preview(summary: FormSummary): string {
  return (
    `Form ${summary.form}: ${summary.accepted_matched} accepted findings matched, ${summary.only_this_form} found only here, ` +
    `${summary.questions} questions, median ${summary.tokens_median} tokens, median wall ${summary.wall_ms_median} ms, ` +
    `${summary.latency.measure} ${summary.latency.value} ms.`
  );
}

function readPrevious(projectRoot: string): HighTableBenchmark | null {
  const text = readTextIfPresent(join(projectRoot, HIGH_TABLE_BENCHMARK));
  if (text === null) return null;
  try {
    return JSON.parse(text) as HighTableBenchmark;
  } catch {
    return null;
  }
}

export function recordHighTableBenchmark(input: {
  projectRoot: string;
  changes: readonly string[];
  resultsText: string;
  change?: string | null;
  now?: () => Date;
}): { lines: string[]; decision: string | null; ok: boolean } {
  const runs = parseBenchmarkRuns(input.resultsText).filter((run) =>
    input.changes.includes(run.change),
  );
  const missing = missingTrials(input.changes, runs);
  if (missing.length > 0) {
    return {
      ok: false,
      decision: null,
      lines: [
        `${missing.length} of ${plannedTrials(input.changes).length} trials are missing (${missing
          .slice(0, 5)
          .map((trial) => `${trial.change} form ${trial.form} trial ${trial.trial}`)
          .join(
            ', ',
          )}${missing.length > 5 ? ', ...' : ''}), so nothing is recorded and no packet is raised.`,
        `Resume: run only the missing trials, add them to the same results file (${runs.length} kept), and record again.`,
      ],
    };
  }
  const forms = summariseForms(runs);
  const [a, b] = forms as [FormSummary, FormSummary];
  const previous = readPrevious(input.projectRoot);
  const sameSet =
    previous !== null && JSON.stringify(previous.changes) === JSON.stringify(input.changes);
  const pending =
    sameSet && previous.decision !== null
      ? readAuthoringDecision(input.projectRoot, previous.decision)
      : null;
  const decision =
    pending !== null && pending.status === 'pending'
      ? pending.id
      : createPendingDecision(input.projectRoot, {
          category: 'workflow-or-tool',
          title: 'Which form should the High Table use?',
          context: `Measured on ${input.changes.join(', ')} with ${BENCHMARK_TRIALS} trials per form. Switching forms is a follow-up change; nothing changes until then.`,
          options: [
            option(KEEP_SEATS_OPTION, 'Keep parallel seats', preview(a), 'You give up: form B.'),
            option(
              SWITCH_SKILLS_OPTION,
              'Switch to skills in the chief',
              preview(b),
              'You give up: form A.',
            ),
          ],
          recommendation:
            b.accepted_matched >= a.accepted_matched && b.tokens_median < a.tokens_median
              ? SWITCH_SKILLS_OPTION
              : KEEP_SEATS_OPTION,
          change: input.change ?? null,
        }).id;
  const record: HighTableBenchmark = {
    changes: [...input.changes],
    trials: BENCHMARK_TRIALS,
    forms,
    spend_usd: Math.round(runs.reduce((sum, run) => sum + (run.cost_usd ?? 0), 0) * 1e6) / 1e6,
    worst_case_usd: worstCaseSpend(input.projectRoot, input.changes),
    decision,
    recorded_at: (input.now ?? (() => new Date()))().toISOString(),
  };
  const path = join(input.projectRoot, HIGH_TABLE_BENCHMARK);
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
  return {
    ok: true,
    decision,
    lines: [
      preview(a),
      preview(b),
      `Wrote ${HIGH_TABLE_BENCHMARK}; decision ${decision} asks which form to keep${pending?.status === 'pending' ? ' (the pending packet for this change set is reused)' : ''}.`,
    ],
  };
}
