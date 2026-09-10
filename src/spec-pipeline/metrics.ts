// Spec-pipeline run metrics + corrections (issue #547, FR-11).
//
// Every run says what it cost and what it changed. `buildRunMetrics` measures the run from its own
// artifacts (grounding, label, questions, spec, experts, trace) — paqad measures no tokens from
// Node, so the token fields carry only the actuals the artifacts reported. `recordSpecCorrection`
// captures a human's later edit to a frozen spec, by section, so the pipeline learns when its spec
// needed fixing. `aggregateSpecPipelineMetrics` reads it all back for the `metrics` verb. All
// deterministic; zero model tokens.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AgentRole } from '@/core/types/agent.js';
import { buildFeatureSpec } from '@/spec/feature-spec-builder.js';
import { evaluateSpecFreeze } from '@/spec/spec-freeze.js';

import type { PipelineConfig } from './config.js';
import type { QuestionCounts, SpecPipelineMetrics } from './finish.js';
import { validateExpertNeed } from './experts/need.js';
import { readExpertNeed, readExpertNotes } from './experts/notes.js';
import { readExpertSynthesis as readSynthesisArtifact } from './experts/synthesis.js';
import { planExpertSlices } from './experts/slice.js';
import { pipelineScratchDir } from './orchestrator.js';
import type { PipelineStep } from './types.js';

function scratchFile(projectRoot: string, dirName: string, file: string): string {
  return join(projectRoot, pipelineScratchDir(dirName), file);
}

function readJson<T>(abs: string): T | null {
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8')) as T;
  } catch {
    return null;
  }
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Measure the run's metrics from its artifacts (FR-11.1). `a5Verdict` is a short string the caller
 * derives from the A5 liveness. Missing artifacts degrade gracefully to their neutral defaults so a
 * partial run still produces an honest, if sparse, metrics record.
 */
export function buildRunMetrics(
  projectRoot: string,
  dirName: string,
  config: PipelineConfig,
  a5Live: boolean,
  a5Verdict: string,
): SpecPipelineMetrics {
  const grounding = readJson<{ sparse?: boolean; path?: string }>(
    scratchFile(projectRoot, dirName, 'grounding.json'),
  );
  const label = readJson<{ label?: string; signals?: unknown[] }>(
    scratchFile(projectRoot, dirName, 'label.json'),
  );
  const questionsArtifact = readJson<{
    asked?: number;
    answered?: number;
    auto_answered?: unknown[];
    deferred?: number;
    tokens?: number;
  }>(scratchFile(projectRoot, dirName, 'questions.json'));
  const task = readJson<{ tokens?: number }>(scratchFile(projectRoot, dirName, 'task.json'));
  const trace = readJson<{ tokens?: number }>(scratchFile(projectRoot, dirName, 'trace.json'));
  const spec = readSpec(projectRoot, dirName);

  const questions: QuestionCounts = {
    asked: questionsArtifact?.asked ?? 0,
    answered: questionsArtifact?.answered ?? 0,
    auto_answered: questionsArtifact?.auto_answered?.length ?? 0,
    deferred: questionsArtifact?.deferred ?? 0,
  };

  const tokensByStep: Partial<Record<PipelineStep | AgentRole, number>> = {};
  const setStep = (step: PipelineStep, value: number | undefined): void => {
    if (value !== undefined) tokensByStep[step] = value;
  };
  setStep('questions', numberField(questionsArtifact?.tokens));
  setStep('task', numberField(task?.tokens));
  setStep('craft', numberField(trace?.tokens));

  const tiersByStep: Partial<Record<PipelineStep, string>> = {};

  const need = readNeed(projectRoot, dirName);
  const expertCount = need?.experts.length ?? 0;
  const ceilingWarnings = need
    ? planExpertSlices(
        need.experts.map((expert) => expert.role),
        config.token_ceiling,
      ).warnings
    : [];
  if (need) {
    const notes = readExpertNotes(projectRoot, dirName) as {
      tokens?: Partial<Record<AgentRole, number>>;
    } | null;
    for (const [role, value] of Object.entries(notes?.tokens ?? {})) {
      const n = numberField(value);
      if (n !== undefined) tokensByStep[role as AgentRole] = n;
    }
    const synthesis = readSynthesisArtifact(projectRoot, dirName);
    if (synthesis) {
      setStep('experts', numberField(synthesis.tokens));
      // The chief and expert skills are reasoning-tier; record that where we know it.
      tiersByStep.experts = 'reasoning';
    }
  }

  const freezeChecksFired = spec ? evaluateSpecFreeze(spec.spec).blockers : [];

  return {
    grounding_sparse: grounding?.sparse ?? false,
    grounding_path: grounding?.path === 'rag' ? 'rag' : 'docs-fallback',
    label:
      label?.label === 'vague' || label?.label === 'okay' || label?.label === 'clear'
        ? label.label
        : 'clear',
    signal_count: label?.signals?.length ?? 0,
    questions,
    expert_count: expertCount,
    spec_words: spec ? spec.words : 0,
    tokens_by_step: tokensByStep,
    tiers_by_step: tiersByStep as SpecPipelineMetrics['tiers_by_step'],
    ceiling_warnings: ceilingWarnings,
    a5_live: a5Live,
    a5_verdict: a5Verdict,
    freeze_checks_fired: freezeChecksFired,
  };
}

function readNeed(projectRoot: string, dirName: string): { experts: { role: AgentRole }[] } | null {
  const raw = readExpertNeed(projectRoot, dirName);
  if (raw === null) return null;
  const validated = validateExpertNeed(raw);
  return validated.ok && validated.artifact ? validated.artifact : null;
}

function readSpec(
  projectRoot: string,
  dirName: string,
): { spec: ReturnType<typeof buildFeatureSpec>; words: number } | null {
  const abs = scratchFile(projectRoot, dirName, 'spec.md');
  if (!existsSync(abs)) return null;
  const markdown = readFileSync(abs, 'utf8');
  const words = markdown.split(/\s+/).filter((token) => token.length > 0).length;
  try {
    return {
      spec: buildFeatureSpec({ spec_id: 'metrics', spec_file: 'spec.md', spec_markdown: markdown }),
      words,
    };
  } catch {
    return null;
  }
}

/** One recorded human correction to a frozen spec (issue #547, FR-11.3). */
export interface SpecCorrection {
  spec_id: string;
  changed_sections: string[];
  at: string;
}

/** Path to the run's corrections log. */
export function correctionsPath(dirName: string): string {
  return join(pipelineScratchDir(dirName), 'corrections.jsonl');
}

/** Append a correction row when a human later edits a frozen spec's source (FR-11.3). */
export function recordSpecCorrection(
  projectRoot: string,
  dirName: string,
  correction: SpecCorrection,
): void {
  const abs = join(projectRoot, correctionsPath(dirName));
  mkdirSync(dirname(abs), { recursive: true });
  // Single read + catch, never stat-then-read: a stat-then-read is a TOCTOU race CodeQL flags
  // (js/file-system-race), the same pattern the bundle-completeness gate avoids.
  let existing = '';
  try {
    existing = readFileSync(abs, 'utf8');
  } catch {
    // No prior corrections file: start fresh.
  }
  writeFileSync(abs, `${existing}${JSON.stringify(correction)}\n`, 'utf8');
}

/** Read the run's corrections (empty when none recorded). */
export function readSpecCorrections(projectRoot: string, dirName: string): SpecCorrection[] {
  const abs = join(projectRoot, correctionsPath(dirName));
  if (!existsSync(abs)) return [];
  const rows: SpecCorrection[] = [];
  for (const line of readFileSync(abs, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      rows.push(JSON.parse(line) as SpecCorrection);
    } catch {
      // skip a malformed row
    }
  }
  return rows;
}

/** The aggregate report the `metrics` verb prints (FR-11.4). */
export interface MetricsAggregate {
  runs: number;
  experts_fired: Partial<Record<AgentRole, number>>;
  changed_spec_rate: Partial<Record<AgentRole, { fired: number; changed: number }>>;
  tokens_by_role: Partial<Record<AgentRole, number>>;
  tokens_by_step: Partial<Record<string, number>>;
  conflicts: number;
  auto_resolved: number;
  corrections_by_section: Record<string, number>;
  label_distribution: Record<string, number>;
  grounding_sparse_runs: number;
}

interface FinishRecord {
  provenance?: {
    experts?: {
      accounting?: { experts?: { role: AgentRole; tokens?: number; changed_spec?: boolean }[] };
      conflicts?: unknown[];
    };
    metrics?: SpecPipelineMetrics;
  };
}

/**
 * Aggregate the metrics across runs (FR-11.4). By default only the active run's directory; with
 * `allRuns` every run under `.paqad/_specs/`. Reads each run's `finish.json` and `corrections.jsonl`
 * — never a model. An empty or partial store yields a zeroed report, never throws.
 */
export function aggregateSpecPipelineMetrics(
  projectRoot: string,
  dirNames: readonly string[],
): MetricsAggregate {
  const aggregate: MetricsAggregate = {
    runs: 0,
    experts_fired: {},
    changed_spec_rate: {},
    tokens_by_role: {},
    tokens_by_step: {},
    conflicts: 0,
    auto_resolved: 0,
    corrections_by_section: {},
    label_distribution: {},
    grounding_sparse_runs: 0,
  };

  for (const dirName of dirNames) {
    const finish = readJson<FinishRecord>(scratchFile(projectRoot, dirName, 'finish.json'));
    if (finish?.provenance) aggregate.runs += 1;
    const experts = finish?.provenance?.experts?.accounting?.experts ?? [];
    for (const expert of experts) {
      aggregate.experts_fired[expert.role] = (aggregate.experts_fired[expert.role] ?? 0) + 1;
      const rate = (aggregate.changed_spec_rate[expert.role] ??= { fired: 0, changed: 0 });
      rate.fired += 1;
      if (expert.changed_spec) rate.changed += 1;
      if (typeof expert.tokens === 'number') {
        aggregate.tokens_by_role[expert.role] =
          (aggregate.tokens_by_role[expert.role] ?? 0) + expert.tokens;
      }
    }
    aggregate.conflicts += finish?.provenance?.experts?.conflicts?.length ?? 0;

    const metrics = finish?.provenance?.metrics;
    if (metrics) {
      aggregate.label_distribution[metrics.label] =
        (aggregate.label_distribution[metrics.label] ?? 0) + 1;
      if (metrics.grounding_sparse) aggregate.grounding_sparse_runs += 1;
      for (const [step, value] of Object.entries(metrics.tokens_by_step)) {
        if (typeof value === 'number') {
          aggregate.tokens_by_step[step] = (aggregate.tokens_by_step[step] ?? 0) + value;
        }
      }
    }

    const synthesis = readSynthesisArtifact(projectRoot, dirName);
    aggregate.auto_resolved += synthesis?.auto_resolved?.length ?? 0;

    for (const correction of readSpecCorrections(projectRoot, dirName)) {
      for (const section of correction.changed_sections) {
        aggregate.corrections_by_section[section] =
          (aggregate.corrections_by_section[section] ?? 0) + 1;
      }
    }
  }

  return aggregate;
}

/** Every run directory under `.paqad/_specs/` that has a pipeline scratch (for `metrics --all`). */
export function listRunDirs(projectRoot: string): string[] {
  const base = join(projectRoot, '.paqad', '_specs');
  if (!existsSync(base)) return [];
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(base, name, 'pipeline')))
      .sort();
  } catch {
    return [];
  }
}
