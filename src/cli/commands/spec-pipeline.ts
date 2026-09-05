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

import { autoAnswerQuestions } from '@/spec-pipeline/auto-answer.js';
import { expertsActive, readPipelineConfig } from '@/spec-pipeline/config.js';
import { decideFinish, buildProvenance } from '@/spec-pipeline/finish.js';
import { assembleExpertRun } from '@/spec-pipeline/experts/assemble.js';
import { validateExpertNeed } from '@/spec-pipeline/experts/need.js';
import {
  validateExpertNotes,
  writeExpertNeed,
  writeExpertNotes,
} from '@/spec-pipeline/experts/notes.js';
import { groundAreaAsync } from '@/spec-pipeline/grounding.js';
import { labelPrompt } from '@/spec-pipeline/labeling.js';
import {
  assertCanRunStep,
  nextStep,
  readQuestionsArtifact,
  recordStep,
  redoStep,
  validateStepArtifact,
  writeStepArtifact,
} from '@/spec-pipeline/orchestrator.js';
import { specCodeCheckLive } from '@/spec-pipeline/spec-code-check.js';
import type {
  GroundingArtifact,
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
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((step: string, file: string, options: CommonOptions) => {
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
      const gate = assertCanRunStep(options.projectRoot, resolved.dirName, pipelineStep);
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
        const candidates = (parsed.questions ?? []) as PipelineQuestion[];
        const { answered, remaining } = autoAnswerQuestions(options.projectRoot, candidates);
        const enriched: QuestionsArtifact = {
          questions: remaining,
          auto_answered: answered,
          asked: remaining.length,
          answered: typeof parsed.answered === 'number' ? parsed.answered : 0,
          deferred: typeof parsed.deferred === 'number' ? parsed.deferred : 0,
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
      const valid: PipelineStep[] = ['ground', 'label', 'questions', 'task', 'craft', 'finish'];
      if (!valid.includes(step as PipelineStep)) {
        console.error(`unknown step "${step}" — one of: ${valid.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const invalidated = redoStep(options.projectRoot, resolved.dirName, step as PipelineStep);
      console.log(JSON.stringify({ redo: step, invalidated }));
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

  experts
    .command('record')
    .description('Store the model-decided expert-need artifact (validated against the roster)')
    .argument('<file>', 'Path to the need artifact the expert-need-detector produced')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((file: string, options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      if (refuseWhenOff(options)) return;
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
      console.log(
        JSON.stringify({ recorded: 'expert-need', experts: check.artifact.experts.length }),
      );
    });

  experts
    .command('notes')
    .description("Store the experts' notes + token actuals (validated against the roster)")
    .argument('<file>', 'Path to the notes artifact the experts produced')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((file: string, options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      if (refuseWhenOff(options)) return;
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        console.error(`could not read notes artifact "${file}"`);
        process.exitCode = 1;
        return;
      }
      const check = validateExpertNotes(content);
      if (!check.ok || !check.artifact) {
        console.error(`expert-notes artifact is invalid: ${check.error}`);
        process.exitCode = 1;
        return;
      }
      writeExpertNotes(options.projectRoot, resolved.dirName, check.artifact);
      console.log(JSON.stringify({ recorded: 'expert-notes', notes: check.artifact.notes.length }));
    });

  return experts;
}
