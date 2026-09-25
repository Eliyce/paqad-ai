// Spec-pipeline run metrics + corrections (issue #547, FR-11).
//
// Every run says what it cost and what it changed. `buildRunMetrics` measures the run from its own
// artifacts (grounding, label, questions, spec, experts, trace) — paqad measures no tokens from
// Node, so the token fields carry only the actuals the artifacts reported. `recordSpecCorrection`
// captures a human's later edit to a frozen spec, by section, so the pipeline learns when its spec
// needed fixing. `aggregateSpecPipelineMetrics` reads it all back for the `metrics` verb, from
// the bundles alone (issue #581): `specification.json` `pipeline` (or the staged finish before
// freeze), `clarification.json`, `experts.json` and the `spec-step` rows. All deterministic;
// zero model tokens.

import type { AgentRole } from '@/core/types/agent.js';
import type { SpecProvenance } from '@/core/types/feature-spec.js';
import { listFeatureDirs } from '@/feature-evidence/enumerate.js';
import { buildFeatureSpec } from '@/spec/feature-spec-builder.js';
import { evaluateSpecFreeze } from '@/spec/spec-freeze.js';

import type { PipelineConfig } from './config.js';
import type { QuestionCounts, SpecPipelineMetrics } from './finish.js';
import { assembleExpertRun } from './experts/assemble.js';
import { validateExpertNeed } from './experts/need.js';
import { planExpertSlices } from './experts/slice.js';
import {
  appendSpecCorrectionRow,
  readExpertNeed,
  readExpertNotes,
  readExpertSynthesis as readSynthesisArtifact,
  readFrozenSpecificationBody,
  readGrounding,
  readLabel,
  readQuestions,
  readSpecCorrectionRows,
  readSpecStepRows,
  readStagedJson,
  readStagedText,
} from './run-store.js';
import type { PipelineStep } from './types.js';

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
  const grounding = readStagedJson<{ sparse?: boolean; path?: string }>(
    projectRoot,
    dirName,
    'grounding',
  );
  const label = readLabel(projectRoot, dirName);
  const questionsArtifact = readQuestions(projectRoot, dirName);
  const task = readStagedJson<{ tokens?: number }>(projectRoot, dirName, 'task');
  const trace = readStagedJson<{ tokens?: number }>(projectRoot, dirName, 'trace');
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
  // The question round's tokens ride on its spec-step row (issue #581): the stored batch is the
  // enriched one the script wrote, which never carried the agent's count.
  const questionsRow = readSpecStepRows(projectRoot, dirName)
    .filter((row) => row.step === 'questions' && row.outcome === 'complete')
    .at(-1);
  setStep('questions', numberField(questionsRow?.tokens));
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
    const notes = readExpertNotes(projectRoot, dirName);
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
    label: label?.label ?? 'clear',
    signal_count: label?.signals.length ?? 0,
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
  const markdown = readStagedText(projectRoot, dirName, 'craft');
  if (markdown === null) return null;
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

/**
 * Record a human's later edit to a frozen spec's source (FR-11.3) as one `kind: 'spec-correction'`
 * row on the bundle's stage evidence (issue #581). `at` becomes the row's `recorded_at`.
 */
export function recordSpecCorrection(
  projectRoot: string,
  dirName: string,
  correction: SpecCorrection,
): void {
  appendSpecCorrectionRow(
    projectRoot,
    dirName,
    { spec_id: correction.spec_id, changed_sections: correction.changed_sections },
    { now: () => new Date(correction.at) },
  );
}

/** Read the change's corrections (empty when none recorded). */
export function readSpecCorrections(projectRoot: string, dirName: string): SpecCorrection[] {
  return readSpecCorrectionRows(projectRoot, dirName).map((row) => ({
    spec_id: String(row.spec_id),
    changed_sections: row.changed_sections as string[],
    at: String(row.recorded_at),
  }));
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

/**
 * Whether a bundle holds a spec pipeline run: a staged finish before freeze, or a frozen spec whose
 * `pipeline` section says the pipeline produced it. A record frozen before issue #581 says so in
 * its `provenance` block, which is handed back so its label, grounding and experts still count.
 */
function pipelineRun(
  projectRoot: string,
  dirName: string,
): { legacy: SpecProvenance | null } | null {
  if (readStagedJson<{ provenance?: unknown }>(projectRoot, dirName, 'finish')?.provenance) {
    return { legacy: null };
  }
  const frozen = readFrozenSpecificationBody(projectRoot, dirName);
  if ((frozen?.pipeline as { produced?: unknown } | undefined)?.produced === true) {
    return { legacy: null };
  }
  const legacy = frozen?.provenance as SpecProvenance | undefined;
  return legacy?.pipeline_produced === true ? { legacy } : null;
}

/** The tokens each step reported, from its latest complete `spec-step` row (a redo clears it). */
function stepTokens(projectRoot: string, dirName: string): Map<string, number> {
  const tokens = new Map<string, number>();
  for (const row of readSpecStepRows(projectRoot, dirName)) {
    const n = numberField(row.tokens);
    if (row.outcome === 'redone') tokens.delete(String(row.step));
    else if (row.outcome === 'complete' && n !== undefined) tokens.set(String(row.step), n);
  }
  return tokens;
}

/**
 * Aggregate the metrics across runs (FR-11.4). By default only the active change; with `allRuns`
 * every feature bundle. Each bundle is read on its own: the run itself from its `pipeline`
 * section (or staged finish), the experts from `experts.json`, the label from
 * `clarification.json`, the tokens from its `spec-step` rows, and its `spec-correction` rows —
 * never a model. A bundle with no run, or an empty store, adds nothing and never throws.
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
    for (const correction of readSpecCorrections(projectRoot, dirName)) {
      for (const section of correction.changed_sections) {
        aggregate.corrections_by_section[section] =
          (aggregate.corrections_by_section[section] ?? 0) + 1;
      }
    }

    const run = pipelineRun(projectRoot, dirName);
    if (run === null) continue;
    aggregate.runs += 1;

    // The ceiling only sizes the slice warnings, which the aggregate does not report.
    const experts = assembleExpertRun(projectRoot, dirName, Number.MAX_SAFE_INTEGER);
    const fired = (role: AgentRole): { fired: number; changed: number } => {
      aggregate.experts_fired[role] = (aggregate.experts_fired[role] ?? 0) + 1;
      const rate = (aggregate.changed_spec_rate[role] ??= { fired: 0, changed: 0 });
      rate.fired += 1;
      return rate;
    };
    if (experts) {
      for (const expert of experts.accounting.experts) {
        const rate = fired(expert.role);
        if (expert.changed_spec) rate.changed += 1;
        aggregate.tokens_by_role[expert.role] =
          (aggregate.tokens_by_role[expert.role] ?? 0) + expert.tokens;
      }
      aggregate.conflicts += experts.conflicts.length;
    } else if (run.legacy?.experts) {
      for (const role of run.legacy.experts.roles) fired(role);
      aggregate.conflicts += run.legacy.experts.conflicts;
    }

    const label = readLabel(projectRoot, dirName)?.label ?? run.legacy?.label;
    if (label !== undefined) {
      aggregate.label_distribution[label] = (aggregate.label_distribution[label] ?? 0) + 1;
    }
    const sparse = readGrounding(projectRoot, dirName)?.sparse ?? run.legacy?.grounding?.sparse;
    if (sparse === true) aggregate.grounding_sparse_runs += 1;

    const synthesis = readSynthesisArtifact(projectRoot, dirName);
    const tokens = stepTokens(projectRoot, dirName);
    const synthesisTokens = numberField(synthesis?.tokens);
    if (!tokens.has('experts') && synthesisTokens !== undefined) {
      tokens.set('experts', synthesisTokens);
    }
    for (const [step, value] of tokens) {
      aggregate.tokens_by_step[step] = (aggregate.tokens_by_step[step] ?? 0) + value;
    }
    aggregate.auto_resolved += synthesis?.auto_resolved?.length ?? 0;
  }

  return aggregate;
}

/** Every feature bundle, for `metrics --all`; bundles without a pipeline run add nothing. */
export function listRunDirs(projectRoot: string): string[] {
  return listFeatureDirs(projectRoot);
}
