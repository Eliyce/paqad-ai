#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUTPUT = '.paqad/authoring/stage-recipes/benchmark.json';

export const STAGE_BASELINE_TURNS = {
  planning: 64,
  specification: 35,
  development: 109,
  review: 44,
  checks: 10,
  documentation_sync: 17,
};

export const STAGE_TURN_BUDGET = {
  planning: 100,
  specification: 60,
  development: 170,
  review: 70,
  checks: 20,
  documentation_sync: 30,
};

const ARTIFACT = {
  planning: 'plan.json',
  specification: 'specification.json',
  review: 'review.json',
  checks: 'checks.json',
};

export function measureTranscript(text) {
  const seen = new Map();
  const stamps = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const at = Date.parse(record.timestamp ?? '');
    if (!Number.isNaN(at)) stamps.push(at);
    const message = record.message;
    if (message?.role !== 'assistant' || !message.usage) continue;
    seen.set(message.id ?? `line-${seen.size}`, message.usage);
  }
  let tokens = 0;
  for (const usage of seen.values()) {
    tokens +=
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
  }
  return {
    turns: seen.size,
    tokens_used: tokens,
    duration_ms: stamps.length > 1 ? Math.max(...stamps) - Math.min(...stamps) : 0,
  };
}

function ledgerRows(bundle) {
  try {
    return readFileSync(join(bundle, 'stage-evidence.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function measureRun(run) {
  const usage = measureTranscript(readFileSync(run.transcript, 'utf8'));
  const artifact = ARTIFACT[run.stage];
  const rows = ledgerRows(run.bundle);
  const ended = rows.some((row) => row.kind === 'stage_end' && row.stage === run.stage);
  return {
    stage: run.stage,
    arm: run.arm,
    ...usage,
    artifact_pass: artifact ? existsSync(join(run.bundle, artifact)) : ended,
    skill_used: rows.some((row) => row.kind === 'skill-used' && row.stage === run.stage),
    within_budget: usage.turns <= (STAGE_TURN_BUDGET[run.stage] ?? Number.POSITIVE_INFINITY),
    baseline_turns: STAGE_BASELINE_TURNS[run.stage] ?? null,
  };
}

export function buildBenchmark(runs) {
  const measured = runs.map(measureRun);
  return {
    sample: true,
    note: 'Twelve real runs, one past task per stage in two arms. A sample, not a statistic.',
    runs: measured,
    over_budget: measured
      .filter((run) => !run.within_budget)
      .map((run) => `${run.stage} (${run.arm}): ${run.turns} turns`),
  };
}

function main(argv) {
  const index = argv.indexOf('--runs');
  if (argv.includes('--help') || index === -1) {
    process.stdout.write(
      'usage: stage-benchmark.mjs --runs <runs.json> [--out <file>]\n' +
        'runs.json lists { stage, arm, transcript, bundle } for each run.\n',
    );
    process.exitCode = argv.includes('--help') ? 0 : 2;
    return;
  }
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : OUTPUT;
  const benchmark = buildBenchmark(JSON.parse(readFileSync(argv[index + 1], 'utf8')));
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(benchmark, null, 2)}\n`);
  for (const run of benchmark.runs) {
    process.stdout.write(
      `${run.stage} ${run.arm}: ${run.turns} turns (budget ${STAGE_TURN_BUDGET[run.stage]}, baseline ${run.baseline_turns})\n`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
