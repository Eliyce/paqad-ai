// `paqad-ai spec pipeline` — the grounded prompt->spec pipeline entry point (issue #512, FR-1).
//
// One command drives the deterministic step machine. The SCRIPT owns sequencing: `ground`
// and `label` run in Node with zero model tokens; the model steps (`questions`, `task`,
// `craft`) are agent-run and their artifacts are handed back through `record`, which validates
// them and advances only when the shape is right; `finish` decides freeze vs non-blocking
// review, A5-gated. Every action refuses when its predecessor is incomplete (step locks) and
// resumes from the first incomplete step. This command reimplements none of the logic — it
// wires src/spec-pipeline/*.
//
// The Phase 2 expert roster (issue #521) rides alongside as the `experts` subcommand group,
// gated on `spec_pipeline_experts_enabled`: the model-decided need artifact and the experts'
// notes are handed back the same way the model steps are, validated against the roster before
// anything is stored, and folded into the finish provenance ONLY when experts actually ran.

import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { readContractDecisions } from '@/decisions/authoring.js';
import { autoAnswerQuestions } from '@/spec-pipeline/auto-answer.js';
import { expertsActive, readPipelineConfig } from '@/spec-pipeline/config.js';
import { decideFinish, buildProvenance } from '@/spec-pipeline/finish.js';
import { assembleExpertRun } from '@/spec-pipeline/experts/assemble.js';
import { buildExpertBriefs, writeExpertBriefs } from '@/spec-pipeline/experts/brief.js';
import { mintExpertConflictDecisions } from '@/spec-pipeline/experts/conflicts.js';
import { mergeExpertNotes } from '@/spec-pipeline/experts/merge.js';
import { validateExpertNeed } from '@/spec-pipeline/experts/need.js';
import {
  readExpertNeed,
  readExpertNotes,
  validateExpertNotes,
  writeExpertNeed,
  writeExpertNotes,
  type ExpertNotesArtifact,
} from '@/spec-pipeline/experts/notes.js';
import { collectExpertQuestions, mergeQuestionBatch } from '@/spec-pipeline/experts/questions.js';
import {
  aggregateSpecPipelineMetrics,
  buildRunMetrics,
  listRunDirs,
} from '@/spec-pipeline/metrics.js';
import {
  readExpertMerge,
  readExpertSynthesis,
  validateExpertSynthesis,
  writeExpertMerge,
  writeExpertSynthesis,
} from '@/spec-pipeline/experts/synthesis.js';
import type { ExpertNeedArtifact } from '@/spec-pipeline/experts/types.js';
import { groundAreaAsync } from '@/spec-pipeline/grounding.js';
import { labelPrompt } from '@/spec-pipeline/labeling.js';
import {
  assertCanRunStep,
  nextStep,
  pipelineScratchDir,
  readQuestionsArtifact,
  recordStep,
  redoStep,
  validateStepArtifact,
  writeStepArtifact,
} from '@/spec-pipeline/orchestrator.js';
import type { PlainLanguageSources } from '@/spec-pipeline/plain-language.js';
import { specCodeCheckLive } from '@/spec-pipeline/spec-code-check.js';
import {
  carryForwardIds,
  parseTraceArtifact,
  readTrace,
  validateCraftTrace,
  writeTrace,
} from '@/spec-pipeline/trace.js';
import type {
  GroundingArtifact,
  LabelArtifact,
  PipelineQuestion,
  PipelineStep,
  QuestionsArtifact,
} from '@/spec-pipeline/types.js';

interface CommonOptions {
  projectRoot: string;
  session?: string;
}

/** Resolve the active feature dir, or print an error and set exit code. */
function resolveDir(options: CommonOptions): { dirName: string } | null {
  const sessionId = resolveSessionId(
    options.projectRoot,
    options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
  );
  const dirName = currentFeature(options.projectRoot, sessionId);
  if (!dirName) {
    console.error('no active feature — run `paqad-ai stage start planning` first');
    process.exitCode = 1;
    return null;
  }
  return { dirName };
}

/** Read a JSON scratch artifact for a run, or null when it is missing or malformed. */
function readScratchJson<T>(projectRoot: string, dirName: string, file: string): T | null {
  try {
    return JSON.parse(
      readFileSync(`${projectRoot}/${pipelineScratchDir(dirName)}/${file}`, 'utf8'),
    ) as T;
  } catch {
    return null;
  }
}

/** Read the run's request text (written by `spec pipeline start`), or '' when absent. */
function readRequest(projectRoot: string, dirName: string): string {
  try {
    return readFileSync(`${projectRoot}/${pipelineScratchDir(dirName)}/request.md`, 'utf8');
  } catch {
    return '';
  }
}

/** Build the plain-language sources (grounding terms + request) for a run's question checks. */
function plainLanguageSources(projectRoot: string, dirName: string): PlainLanguageSources {
  const grounding = readScratchJson<GroundingArtifact>(projectRoot, dirName, 'grounding.json');
  return { terms: grounding?.terms ?? [], prompt: readRequest(projectRoot, dirName) };
}

/** Whether any `spec.expert_conflict` packet is still pending a human decision (FR-6.4). */
function hasPendingExpertConflict(projectRoot: string): boolean {
  return readContractDecisions(projectRoot).some(
    ({ packet, status }) => status === 'pending' && packet.category === 'spec.expert_conflict',
  );
}

const projectRootOpt = ['--project-root <path>', 'Project root', process.cwd()] as const;
const sessionOpt = [
  '--session <id>',
  'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)',
] as const;

export function createSpecPipelineCommand(): Command {
  const command = new Command('pipeline').description(
    'Grounded prompt->spec pipeline: ground, label, questions, task, craft, finish (issue #512)',
  );

  command
    .command('status')
    .description('Show the next step and the enforcement config in effect')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      const config = readPipelineConfig(options.projectRoot);
      const next = nextStep(options.projectRoot, resolved.dirName);
      console.log(
        JSON.stringify({ enabled: config.enabled, next_step: next, enforcement: config }),
      );
    });

  command
    .command('ground')
    .description('S0 — assemble grounding from the docs (zero model tokens)')
    .option('--modules <list>', 'Comma-separated module slugs to scope grounding to')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action(async (options: CommonOptions & { modules?: string }) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      const modules = options.modules
        ? options.modules
            .split(',')
            .map((m) => m.trim())
            .filter((m) => m.length > 0)
        : undefined;
      // RAG-aware (#520): draws terms/references from semantic retrieval when rag_enabled is
      // on, else falls back to the docs glob. Records which path was taken.
      const grounding = await groundAreaAsync(options.projectRoot, modules ? { modules } : {});
      writeStepArtifact(
        options.projectRoot,
        resolved.dirName,
        'ground',
        JSON.stringify(grounding, null, 2),
      );
      recordStep(options.projectRoot, resolved.dirName, 'ground', 'complete');
      console.log(
        JSON.stringify({
          step: 'ground',
          references: grounding.references.length,
          terms: grounding.terms.length,
          sparse: grounding.sparse,
          path: grounding.path,
        }),
      );
    });

  command
    .command('label')
    .description('S1 — rate clarity against the grounding (zero model tokens)')
    .argument('<prompt>', 'The request prompt to label')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((prompt: string, options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      const gate = assertCanRunStep(options.projectRoot, resolved.dirName, 'label');
      if (!gate.allowed) {
        console.error(gate.message);
        process.exitCode = 1;
        return;
      }
      const groundingRaw = readFileSync(
        `${options.projectRoot}/.paqad/_specs/${resolved.dirName}/pipeline/grounding.json`,
        'utf8',
      );
      const grounding = JSON.parse(groundingRaw) as GroundingArtifact;
      const label = labelPrompt(prompt, grounding);
      writeStepArtifact(
        options.projectRoot,
        resolved.dirName,
        'label',
        JSON.stringify(label, null, 2),
      );
      recordStep(options.projectRoot, resolved.dirName, 'label', 'complete');
      console.log(
        JSON.stringify({
          step: 'label',
          label: label.label,
          question_budget: label.question_budget,
        }),
      );
    });

  command
    .command('record')
    .description('Hand an agent-produced step artifact back to the pipeline (validated + advanced)')
    .argument('<step>', 'One of: questions, task, craft')
    .argument('<file>', 'Path to the artifact the agent produced')
    .option('--trace <path>', 'For craft: the trace.json tying every spec line to a source')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((step: string, file: string, options: CommonOptions & { trace?: string }) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      if (step !== 'questions' && step !== 'task' && step !== 'craft') {
        console.error(
          `record accepts only the agent steps: questions, task, craft (got "${step}")`,
        );
        process.exitCode = 1;
        return;
      }
      const pipelineStep = step as PipelineStep;
      const gate = assertCanRunStep(options.projectRoot, resolved.dirName, pipelineStep, {
        // The question batch is locked while an expert conflict is unresolved (FR-6.4).
        hasPendingExpertConflict:
          pipelineStep === 'questions' && hasPendingExpertConflict(options.projectRoot),
      });
      if (!gate.allowed) {
        console.error(gate.message);
        process.exitCode = 1;
        return;
      }
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        console.error(`could not read artifact "${file}"`);
        process.exitCode = 1;
        return;
      }
      const check = validateStepArtifact(pipelineStep, content);
      if (!check.ok) {
        console.error(`artifact for "${step}" is invalid: ${check.error}`);
        process.exitCode = 1;
        return;
      }
      // S2 auto-answer (issue #517): run the agent's candidate questions through the ledger,
      // then persist only the surviving batch plus the auto-answered list, so a ledger-answerable
      // question never reaches the user (AC-1/AC-3). Every other step is written as-is.
      if (pipelineStep === 'questions') {
        const parsed = JSON.parse(content) as Partial<QuestionsArtifact>;
        const enrichment = (parsed.questions ?? []) as PipelineQuestion[];
        // Merge the expert and chief questions into the one batch (issue #547, FR-7) ONLY when the
        // roster is on; with it off this path is byte-identical to the v1 behaviour (INV-2).
        const config = readPipelineConfig(options.projectRoot);
        let batch = enrichment;
        let deferredFromExperts: PipelineQuestion[] = [];
        if (expertsActive(config)) {
          const label = readScratchJson<LabelArtifact>(
            options.projectRoot,
            resolved.dirName,
            'label.json',
          );
          const expertChief = collectExpertQuestions(
            readExpertNeed(options.projectRoot, resolved.dirName) as ExpertNeedArtifact | null,
            readExpertNotes(options.projectRoot, resolved.dirName) as ExpertNotesArtifact | null,
            readExpertSynthesis(options.projectRoot, resolved.dirName),
          );
          const merged = mergeQuestionBatch(
            enrichment,
            expertChief,
            label?.question_budget ?? enrichment.length,
          );
          batch = merged.questions;
          deferredFromExperts = merged.deferred_from_experts;
        }
        const { answered, remaining } = autoAnswerQuestions(options.projectRoot, batch);
        const enriched: QuestionsArtifact = {
          questions: remaining,
          auto_answered: answered,
          asked: remaining.length,
          answered: typeof parsed.answered === 'number' ? parsed.answered : 0,
          deferred: typeof parsed.deferred === 'number' ? parsed.deferred : 0,
          ...(deferredFromExperts.length > 0 ? { deferred_from_experts: deferredFromExperts } : {}),
        };
        writeStepArtifact(
          options.projectRoot,
          resolved.dirName,
          pipelineStep,
          JSON.stringify(enriched, null, 2),
        );
        recordStep(options.projectRoot, resolved.dirName, pipelineStep, 'complete');
        console.log(
          JSON.stringify({
            step,
            recorded: true,
            asked: enriched.asked,
            auto_answered: answered.length,
          }),
        );
        return;
      }
      // Craft trace gate (issue #547, FR-8): when the pipeline is on, `--trace` is required and
      // every spec line must trace to a source, with every accepted expert finding reflected.
      if (pipelineStep === 'craft') {
        const config = readPipelineConfig(options.projectRoot);
        if (config.enabled) {
          if (!options.trace) {
            console.error('craft needs --trace <trace.json> while the spec pipeline is on (FR-8.3)');
            process.exitCode = 1;
            return;
          }
          let traceRaw: unknown;
          try {
            traceRaw = JSON.parse(readFileSync(options.trace, 'utf8'));
          } catch {
            console.error(`could not read or parse trace "${options.trace}"`);
            process.exitCode = 1;
            return;
          }
          const agentTrace = parseTraceArtifact(traceRaw);
          if (!agentTrace) {
            console.error('trace.json is malformed — each entry needs an id (FR/NFR/AC/INV) and a source');
            process.exitCode = 1;
            return;
          }
          const accepted = expertsActive(config)
            ? (readExpertSynthesis(options.projectRoot, resolved.dirName)?.accepted ?? [])
            : [];
          const gate = validateCraftTrace(content, agentTrace, accepted);
          if (!gate.ok) {
            console.error(gate.errors.join('; '));
            process.exitCode = 1;
            return;
          }
          // Stable ids carry forward by source lineage so A5 tracks a requirement across re-craft.
          const stable = carryForwardIds(
            agentTrace.entries.map((entry) => ({ kind: entry.kind, source: entry.source })),
            readTrace(options.projectRoot, resolved.dirName),
          );
          writeTrace(options.projectRoot, resolved.dirName, stable);
        }
        writeStepArtifact(options.projectRoot, resolved.dirName, pipelineStep, content);
        recordStep(options.projectRoot, resolved.dirName, pipelineStep, 'complete');
        console.log(JSON.stringify({ step, recorded: true, traced: config.enabled }));
        return;
      }
      writeStepArtifact(options.projectRoot, resolved.dirName, pipelineStep, content);
      recordStep(options.projectRoot, resolved.dirName, pipelineStep, 'complete');
      console.log(JSON.stringify({ step, recorded: true }));
    });

  command.addCommand(createExpertsCommand());

  command
    .command('finish')
    .description('S5 — decide freeze vs non-blocking review (A5-gated) and record provenance')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      const gate = assertCanRunStep(options.projectRoot, resolved.dirName, 'finish');
      if (!gate.allowed) {
        console.error(gate.message);
        process.exitCode = 1;
        return;
      }
      const config = readPipelineConfig(options.projectRoot);
      const a5Live = specCodeCheckLive(options.projectRoot);
      const decision = decideFinish(config, a5Live);
      // Provenance carries the answer references and FR-7.6 counts from the questions step
      // (issue #517). The refs are the ledger sources of the auto-answered questions — honest
      // human-input-by-reference, never a fabricated sign-off.
      const questions = readQuestionsArtifact(options.projectRoot, resolved.dirName);
      const answerRefs = questions?.auto_answered.map((entry) => entry.source) ?? [];
      // Phase 2 (issue #521): fold the expert accounting in ONLY when the roster is active AND a
      // need artifact was recorded. Off ⇒ null ⇒ provenance has no experts block (INV-1 / AC-7).
      const expertRun = expertsActive(config)
        ? assembleExpertRun(options.projectRoot, resolved.dirName, config.token_ceiling)
        : null;
      // Full run metrics (issue #547, FR-11.1): measured from the run's own artifacts.
      const metrics = buildRunMetrics(
        options.projectRoot,
        resolved.dirName,
        config,
        a5Live,
        a5Live ? 'live' : 'absent',
      );
      const provenance = buildProvenance(
        config,
        a5Live,
        answerRefs,
        {
          asked: questions?.asked ?? 0,
          answered: questions?.answered ?? 0,
          auto_answered: questions?.auto_answered.length ?? 0,
          deferred: questions?.deferred ?? 0,
        },
        expertRun
          ? { accounting: expertRun.accounting, conflicts: expertRun.conflicts }
          : undefined,
        metrics,
      );
      writeStepArtifact(
        options.projectRoot,
        resolved.dirName,
        'finish',
        JSON.stringify({ outcome: decision.outcome, reason: decision.reason, provenance }, null, 2),
      );
      recordStep(options.projectRoot, resolved.dirName, 'finish', 'complete');
      console.log(
        JSON.stringify({
          step: 'finish',
          outcome: decision.outcome,
          a5_live: a5Live,
          ...(expertRun ? { experts: expertRun.accounting.experts.length } : {}),
        }),
      );
    });

  command
    .command('redo')
    .description('Archive a step and everything downstream so the run re-derives them')
    .argument('<step>', 'The step to redo')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((step: string, options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      const valid: PipelineStep[] = [
        'ground',
        'label',
        'experts',
        'questions',
        'task',
        'craft',
        'finish',
      ];
      if (!valid.includes(step as PipelineStep)) {
        console.error(`unknown step "${step}" — one of: ${valid.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const invalidated = redoStep(options.projectRoot, resolved.dirName, step as PipelineStep);
      console.log(JSON.stringify({ redo: step, invalidated }));
    });

  command
    .command('metrics')
    .description('Report what the pipeline runs cost and changed (issue #547, FR-11.4)')
    .option('--all', 'Aggregate across every run under .paqad/_specs/, not just the active feature')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((options: CommonOptions & { all?: boolean }) => {
      // Zero model tokens: this reads finish.json and corrections.jsonl across runs.
      const dirNames = options.all ? listRunDirs(options.projectRoot) : [];
      if (!options.all) {
        const resolved = resolveDir(options);
        if (!resolved) return;
        dirNames.push(resolved.dirName);
      }
      const report = aggregateSpecPipelineMetrics(options.projectRoot, dirNames);
      console.log(JSON.stringify(report, null, 2));
      // A short table: which experts earn their keep.
      const roles = Object.keys(report.changed_spec_rate).sort();
      if (roles.length > 0) {
        console.log('\nrole                    fired  changed  tokens');
        for (const role of roles) {
          const rate = report.changed_spec_rate[role as keyof typeof report.changed_spec_rate]!;
          const tokens = report.tokens_by_role[role as keyof typeof report.tokens_by_role] ?? 0;
          console.log(
            `${role.padEnd(22)}  ${String(rate.fired).padStart(5)}  ${String(rate.changed).padStart(7)}  ${String(tokens).padStart(6)}`,
          );
        }
      }
    });

  return command;
}

/**
 * The `experts` subcommand group (issue #521): `record` stores the model-decided need artifact,
 * `notes` stores the experts' returned notes + token actuals. Both are hard-gated on
 * `spec_pipeline_experts_enabled` (the flag off ⇒ the verb refuses, zero Phase 2 state) and
 * validate their input against the roster before anything is written, so the model can never
 * store a role outside the roster.
 */
function createExpertsCommand(): Command {
  const experts = new Command('experts').description(
    'Phase 2 expert roster (issue #521): record the model-decided expert need and their notes',
  );

  const refuseWhenOff = (options: CommonOptions): boolean => {
    if (!expertsActive(readPipelineConfig(options.projectRoot))) {
      console.error(
        'the expert roster is off — enable spec_pipeline_enabled and spec_pipeline_experts_enabled first',
      );
      process.exitCode = 1;
      return true;
    }
    return false;
  };

  /** Refuse when the roster is off OR an earlier step is incomplete (FR-2.3). */
  const gateExperts = (options: CommonOptions, dirName: string): boolean => {
    if (refuseWhenOff(options)) return true;
    const gate = assertCanRunStep(options.projectRoot, dirName, 'experts');
    if (!gate.allowed) {
      console.error(gate.message);
      process.exitCode = 1;
      return true;
    }
    return false;
  };

  experts
    .command('record')
    .description('Store the model-decided expert-need artifact and write one brief per expert')
    .argument('<file>', 'Path to the need artifact the expert-need-detector produced')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((file: string, options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      if (gateExperts(options, resolved.dirName)) return;
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        console.error(`could not read need artifact "${file}"`);
        process.exitCode = 1;
        return;
      }
      const check = validateExpertNeed(content);
      if (!check.ok || !check.artifact) {
        console.error(`expert-need artifact is invalid: ${check.error}`);
        process.exitCode = 1;
        return;
      }
      writeExpertNeed(options.projectRoot, resolved.dirName, check.artifact);
      // One bounded brief per needed expert (FR-3): request + grounding pointers + label + budget.
      const grounding = readScratchJson<GroundingArtifact>(
        options.projectRoot,
        resolved.dirName,
        'grounding.json',
      );
      const label = readScratchJson<LabelArtifact>(
        options.projectRoot,
        resolved.dirName,
        'label.json',
      );
      const config = readPipelineConfig(options.projectRoot);
      let briefPaths: string[] = [];
      if (grounding && label) {
        const { briefs } = buildExpertBriefs({
          needs: check.artifact.experts,
          request: readRequest(options.projectRoot, resolved.dirName),
          grounding,
          label,
          ceiling: config.token_ceiling,
        });
        briefPaths = writeExpertBriefs(options.projectRoot, resolved.dirName, briefs);
      }
      console.log(
        JSON.stringify({
          recorded: 'expert-need',
          experts: check.artifact.experts.length,
          briefs: briefPaths,
        }),
      );
    });

  experts
    .command('notes')
    .description("Store the experts' notes + token actuals and merge them for the chief")
    .argument('<file>', 'Path to the notes artifact the experts produced')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((file: string, options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      if (gateExperts(options, resolved.dirName)) return;
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        console.error(`could not read notes artifact "${file}"`);
        process.exitCode = 1;
        return;
      }
      const check = validateExpertNotes(
        content,
        plainLanguageSources(options.projectRoot, resolved.dirName),
      );
      if (!check.ok || !check.artifact) {
        console.error(`expert-notes artifact is invalid: ${check.error}`);
        process.exitCode = 1;
        return;
      }
      writeExpertNotes(options.projectRoot, resolved.dirName, check.artifact);
      // Merge deterministically and persist the merge the chief reads (FR-5.1).
      const merged = mergeExpertNotes(check.artifact.notes);
      writeExpertMerge(options.projectRoot, resolved.dirName, merged);
      console.log(
        JSON.stringify({
          recorded: 'expert-notes',
          notes: check.artifact.notes.length,
          findings: merged.findings.length,
          conflicts: merged.conflicts.length,
        }),
      );
    });

  experts
    .command('synthesis')
    .description('Store the chief architect synthesis; each conflict becomes a decision packet')
    .argument('<file>', 'Path to the synthesis artifact the expert-synthesis skill produced')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((file: string, options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      if (gateExperts(options, resolved.dirName)) return;
      const merged = readExpertMerge(options.projectRoot, resolved.dirName);
      if (!merged) {
        console.error('no merged notes — run `paqad-ai spec pipeline experts notes` first');
        process.exitCode = 1;
        return;
      }
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        console.error(`could not read synthesis artifact "${file}"`);
        process.exitCode = 1;
        return;
      }
      const check = validateExpertSynthesis(
        content,
        merged,
        plainLanguageSources(options.projectRoot, resolved.dirName),
      );
      if (!check.ok || !check.artifact) {
        console.error(`expert-synthesis artifact is invalid: ${check.error}`);
        process.exitCode = 1;
        return;
      }
      // Each conflict becomes one decision packet, reusing a resolved fork when one exists (FR-6).
      const { minted, autoResolved } = mintExpertConflictDecisions(
        options.projectRoot,
        merged,
        check.artifact.conflicts,
      );
      const synthesis =
        autoResolved.length > 0
          ? { ...check.artifact, auto_resolved: autoResolved }
          : check.artifact;
      writeExpertSynthesis(options.projectRoot, resolved.dirName, synthesis);
      recordStep(options.projectRoot, resolved.dirName, 'experts', 'complete');
      console.log(
        JSON.stringify({
          recorded: 'expert-synthesis',
          verdict: synthesis.verdict,
          accepted: synthesis.accepted.length,
          declined: synthesis.declined.length,
          conflicts_pending: minted.length,
          auto_resolved: autoResolved.length,
          gaps: synthesis.gaps.length,
        }),
      );
    });

  return experts;
}
