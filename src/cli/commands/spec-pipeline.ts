import { readFileSync } from 'node:fs';

import { Command } from 'commander';
import { execa } from 'execa';

import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { GithubIssuesTicketProvider, type GhInvoke } from '@/providers/index.js';

import { classifyRef } from './intake.js';

import { autoAnswerQuestions } from '@/spec-pipeline/auto-answer.js';
import { expertsActive, readPipelineConfig } from '@/spec-pipeline/config.js';
import { decideFinish, buildProvenance } from '@/spec-pipeline/finish.js';
import { assembleExpertRun } from '@/spec-pipeline/experts/assemble.js';
import {
  buildExpertBriefs,
  renderExpertBrief,
  rosterEntryFor,
} from '@/spec-pipeline/experts/brief.js';
import {
  hasPendingExpertConflict,
  mintExpertConflictDecisions,
} from '@/spec-pipeline/experts/conflicts.js';
import {
  fixProofMethodLine,
  raiseFixProofMethodDecision,
} from '@/fix-protocol/fix-proof-method-decision.js';
import { mergeExpertNotes } from '@/spec-pipeline/experts/merge.js';
import {
  pathTriggeredSeats,
  seatExpertsForLane,
  validateExpertNeed,
} from '@/spec-pipeline/experts/need.js';
import { skillOrchestratorEnabled } from '@/authoring/config.js';
import { findSkillPaths, readSkillPathContext } from '@/authoring/paths.js';
import { readFeaturePlan } from '@/feature-evidence/artifacts.js';
import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { planFiles, sensitivePaths } from '@/feature-evidence/lane-resize.js';
import { resolveProjectVoiceForRun } from '@/spec-pipeline/experts/voice.js';
import { validateExpertNotes } from '@/spec-pipeline/experts/notes.js';
import { collectExpertQuestions, mergeQuestionBatch } from '@/spec-pipeline/experts/questions.js';
import {
  aggregateSpecPipelineMetrics,
  buildRunMetrics,
  listRunDirs,
} from '@/spec-pipeline/metrics.js';
import {
  applyCompatibleRulings,
  applyRenames,
  validateExpertSynthesis,
} from '@/spec-pipeline/experts/synthesis.js';
import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import type { FindingVoiceSources } from '@/spec-pipeline/experts/notes.js';
import {
  GROUNDING_FALLBACK_REASONS,
  groundAreaAsync,
  requestDigest,
} from '@/spec-pipeline/grounding.js';
import {
  CHIEF_ROLE,
  recordDoneRow,
  recordSeatedRows,
  recordWritingRow,
} from '@/spec-pipeline/high-table.js';
import { labelPrompt } from '@/spec-pipeline/labeling.js';
import { buildQuestionRound } from '@/spec-pipeline/round.js';
import {
  assertCanRunStep,
  nextStep,
  readQuestionsArtifact,
  recordStep,
  redoStep,
  validateStepArtifact,
  writeStepArtifact,
} from '@/spec-pipeline/orchestrator.js';
import type { PlainLanguageSources } from '@/spec-pipeline/plain-language.js';
import {
  readExpertNeed,
  readExpertNotes,
  readExperts,
  readExpertSynthesis,
  readGrounding,
  readLabel,
  readRequest,
  readStagedJson,
  rememberInput,
  writeExpertFindings,
  writeExpertNotes,
  writeExpertRoster,
  writeExpertSynthesis,
  writeLabel,
  writeRequest,
  type StoreWriteOptions,
} from '@/spec-pipeline/run-store.js';
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
  PipelineQuestion,
  PipelineStep,
  QuestionsArtifact,
} from '@/spec-pipeline/types.js';

interface CommonOptions {
  projectRoot: string;
  session?: string;
}

interface ResolvedRun {
  dirName: string;
  store: StoreWriteOptions;
}

function resolveDir(options: CommonOptions): ResolvedRun | null {
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
  return { dirName, store: { sessionId } };
}

function sameModules(left: readonly string[] | undefined, right: readonly string[]): boolean {
  const a = [...(left ?? [])].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function cachedGrounding(
  projectRoot: string,
  dirName: string,
  digest: string,
  modules: readonly string[],
): GroundingArtifact | null {
  const cached = readStagedJson<GroundingArtifact>(projectRoot, dirName, 'grounding');
  if (!cached || typeof cached !== 'object' || !Array.isArray(cached.references)) return null;
  if (cached.request_digest !== digest || !sameModules(cached.modules, modules)) return null;
  return cached;
}

function isReusable(cached: GroundingArtifact | null): boolean {
  return (
    cached !== null &&
    (cached.mode === 'retrieval' ||
      (cached.mode === 'lexical-fallback' && cached.fallback_retried === true))
  );
}

async function groundRequest(
  projectRoot: string,
  dirName: string,
  request: string,
  modules: readonly string[],
): Promise<{ grounding: GroundingArtifact; reused: boolean }> {
  const digest = requestDigest(request);
  const cached = cachedGrounding(projectRoot, dirName, digest, modules);
  if (cached !== null && isReusable(cached)) return { grounding: cached, reused: true };
  const fresh = await groundAreaAsync(projectRoot, {
    ...(modules.length > 0 ? { modules: [...modules] } : {}),
    query: request,
    budgetMs: readPipelineConfig(projectRoot).grounding_budget_ms,
  });
  const retried = cached?.mode === 'lexical-fallback' && fresh.mode === 'lexical-fallback';
  return {
    grounding: {
      ...fresh,
      request_digest: digest,
      modules: [...modules],
      ...(retried ? { fallback_retried: true } : {}),
    },
    reused: false,
  };
}

function exitIfRetrievalAbandoned(grounding: GroundingArtifact): void {
  if (grounding.fallback_reason !== GROUNDING_FALLBACK_REASONS.budget) return;
  process.stdout.write('', () => process.exit(Number(process.exitCode ?? 0)));
}

function groundingOutcome(grounding: GroundingArtifact, reused: boolean): Record<string, string> {
  if (reused) return { grounding: 'reused' };
  return {
    grounding: grounding.mode ?? 'retrieval',
    ...(grounding.fallback_reason ? { grounding_reason: grounding.fallback_reason } : {}),
  };
}

function plainLanguageSources(projectRoot: string, dirName: string): PlainLanguageSources {
  const grounding = readStagedJson<GroundingArtifact>(projectRoot, dirName, 'grounding');
  return {
    terms: grounding?.terms ?? [],
    prompt: readRequest(projectRoot, dirName),
    vocabulary: (grounding?.vocabulary ?? []).map((entry) => entry.term),
  };
}

function findingVoiceSources(projectRoot: string, dirName: string): FindingVoiceSources {
  const grounding = readStagedJson<GroundingArtifact>(projectRoot, dirName, 'grounding');
  return {
    vocabulary: grounding?.vocabulary ?? [],
    requestText: readRequest(projectRoot, dirName),
    projectRoot,
    indexPresent: readCodeKnowledgeIndex(projectRoot) !== null,
  };
}

function resolveProjectVoice(projectRoot: string, dirName: string): string {
  return resolveProjectVoiceForRun(projectRoot, dirName);
}

function reportedTokens(content: string): unknown {
  return (JSON.parse(content) as { tokens?: unknown }).tokens;
}

async function resolveRequestText(options: {
  projectRoot: string;
  dirName: string;
  requestFile?: string;
  ticket?: string;
}): Promise<string | null> {
  if (options.requestFile) {
    try {
      const text = readFileSync(options.requestFile, 'utf8');
      rememberInput(options.projectRoot, options.dirName, options.requestFile);
      return text;
    } catch {
      console.error(`could not read request file "${options.requestFile}"`);
      process.exitCode = 1;
      return null;
    }
  }
  if (options.ticket) {
    const kind = classifyRef(options.ticket);
    if (kind !== 'github-issues') {
      console.error(
        kind === 'jira'
          ? `Jira tickets are fetched through the Atlassian MCP in your session — paste the request with --request-file instead`
          : `"${options.ticket}" is not a GitHub issue ref — use --request-file, or a GitHub #<number>`,
      );
      process.exitCode = 1;
      return null;
    }
    const ghInvoke: GhInvoke = async (args) => {
      const result = await execa('gh', args, { cwd: options.projectRoot, reject: false });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'gh failed');
      return result.stdout;
    };
    try {
      const ticket = await new GithubIssuesTicketProvider(ghInvoke).fetchTicket(options.ticket);
      const criteria = ticket.acceptance_criteria.map((c) => `- ${c}`).join('\n');
      return `${ticket.title}\n\n${ticket.description}${criteria ? `\n\n${criteria}` : ''}`;
    } catch (error) {
      console.error(
        `could not fetch ${options.ticket}: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
      return null;
    }
  }
  console.error('start needs --request-file <path> or --ticket <ref>');
  process.exitCode = 1;
  return null;
}

const projectRootOpt = ['--project-root <path>', 'Project root', process.cwd()] as const;
const sessionOpt = [
  '--session <id>',
  'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)',
] as const;

function firstPlannedSkillPath(
  projectRoot: string,
  plannedFiles: readonly string[],
): string | null {
  if (!skillOrchestratorEnabled(projectRoot)) return null;
  const context = readSkillPathContext(projectRoot);
  return findSkillPaths(plannedFiles, context.adapters, context)[0] ?? null;
}

export function createSpecPipelineCommand(): Command {
  const command = new Command('pipeline').description(
    'Grounded prompt->spec pipeline: ground, label, questions, task, craft, finish',
  );

  command
    .command('start')
    .description('S0 + S1 in one go: ground and label the request (from a file or a ticket)')
    .option('--request-file <path>', 'Path to the request text to spec')
    .option('--ticket <ref>', 'A ticket ref to fetch instead (GitHub #<number> via gh)')
    .option('--modules <list>', 'Comma-separated module slugs to scope grounding to')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action(
      async (
        options: CommonOptions & { requestFile?: string; ticket?: string; modules?: string },
      ) => {
        const resolved = resolveDir(options);
        if (!resolved) return;

        const request = await resolveRequestText({ ...options, dirName: resolved.dirName });
        if (request === null) return;

        const modules = options.modules
          ? options.modules
              .split(',')
              .map((m) => m.trim())
              .filter((m) => m.length > 0)
          : undefined;

        const { grounding, reused } = await groundRequest(
          options.projectRoot,
          resolved.dirName,
          request,
          modules ?? [],
        );
        if (!reused) {
          writeStepArtifact(
            options.projectRoot,
            resolved.dirName,
            'ground',
            JSON.stringify(grounding, null, 2),
          );
        }
        recordStep(options.projectRoot, resolved.dirName, 'ground', 'complete', resolved.store);

        writeRequest(options.projectRoot, resolved.dirName, request, resolved.store);

        const label = labelPrompt(request, grounding);
        writeLabel(options.projectRoot, resolved.dirName, label, resolved.store);
        recordStep(options.projectRoot, resolved.dirName, 'label', 'complete', resolved.store);

        const config = readPipelineConfig(options.projectRoot);
        if (reused) console.log('grounding reused');
        console.log(
          JSON.stringify({
            next_step: nextStep(options.projectRoot, resolved.dirName),
            label: label.label,
            sparse: grounding.sparse,
            experts: expertsActive(config) ? 'on' : 'off',
            ...groundingOutcome(grounding, reused),
          }),
        );
        exitIfRetrievalAbandoned(grounding);
      },
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
    .command('round')
    .description(
      "List this change's pending questions to ask the owner in one round, with the opening line",
    )
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      console.log(JSON.stringify(buildQuestionRound(options.projectRoot, resolved.dirName)));
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
      const grounding = await groundAreaAsync(options.projectRoot, {
        ...(modules ? { modules } : {}),
        budgetMs: readPipelineConfig(options.projectRoot).grounding_budget_ms,
      });
      writeStepArtifact(
        options.projectRoot,
        resolved.dirName,
        'ground',
        JSON.stringify(grounding, null, 2),
      );
      recordStep(options.projectRoot, resolved.dirName, 'ground', 'complete', resolved.store);
      console.log(
        JSON.stringify({
          step: 'ground',
          references: grounding.references.length,
          terms: grounding.terms.length,
          sparse: grounding.sparse,
          path: grounding.path,
          ...groundingOutcome(grounding, false),
        }),
      );
      exitIfRetrievalAbandoned(grounding);
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
      const grounding = readStagedJson<GroundingArtifact>(
        options.projectRoot,
        resolved.dirName,
        'grounding',
      )!;
      writeRequest(options.projectRoot, resolved.dirName, prompt, resolved.store);
      const label = labelPrompt(prompt, grounding);
      writeLabel(options.projectRoot, resolved.dirName, label, resolved.store);
      recordStep(options.projectRoot, resolved.dirName, 'label', 'complete', resolved.store);
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
        hasPendingExpertConflict:
          pipelineStep === 'questions' &&
          hasPendingExpertConflict(options.projectRoot, resolved.dirName),
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
      rememberInput(options.projectRoot, resolved.dirName, file);
      const check = validateStepArtifact(pipelineStep, content);
      if (!check.ok) {
        console.error(`artifact for "${step}" is invalid: ${check.error}`);
        process.exitCode = 1;
        return;
      }
      if (pipelineStep === 'questions') {
        const parsed = JSON.parse(content) as Partial<QuestionsArtifact> & { tokens?: unknown };
        const enrichment = (parsed.questions ?? []) as PipelineQuestion[];
        const config = readPipelineConfig(options.projectRoot);
        let batch = enrichment;
        let deferredFromExperts: PipelineQuestion[] = [];
        if (expertsActive(config)) {
          const expertChief = collectExpertQuestions(
            readExpertNeed(options.projectRoot, resolved.dirName),
            readExpertNotes(options.projectRoot, resolved.dirName),
            readExpertSynthesis(options.projectRoot, resolved.dirName),
          );
          const merged = mergeQuestionBatch(
            enrichment,
            expertChief,
            readLabel(options.projectRoot, resolved.dirName)!.question_budget,
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
          JSON.stringify(enriched),
          resolved.store,
        );
        recordStep(options.projectRoot, resolved.dirName, pipelineStep, 'complete', {
          ...resolved.store,
          tokens: parsed.tokens,
        });
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
      if (pipelineStep === 'craft') {
        const config = readPipelineConfig(options.projectRoot);
        if (config.enabled) {
          if (!options.trace) {
            console.error(
              'craft needs --trace <trace.json> while the spec pipeline is on (FR-8.3)',
            );
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
          rememberInput(options.projectRoot, resolved.dirName, options.trace);
          const agentTrace = parseTraceArtifact(traceRaw);
          if (!agentTrace) {
            console.error(
              'trace.json is malformed — each entry needs an id (FR/NFR/AC/INV) and a source',
            );
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
          const stable = carryForwardIds(
            agentTrace.entries.map((entry) => ({ kind: entry.kind, source: entry.source })),
            readTrace(options.projectRoot, resolved.dirName),
          );
          writeTrace(options.projectRoot, resolved.dirName, stable);
        }
        writeStepArtifact(options.projectRoot, resolved.dirName, pipelineStep, content);
        recordStep(options.projectRoot, resolved.dirName, pipelineStep, 'complete', resolved.store);
        console.log(JSON.stringify({ step, recorded: true, traced: config.enabled }));
        return;
      }
      writeStepArtifact(options.projectRoot, resolved.dirName, pipelineStep, content);
      recordStep(options.projectRoot, resolved.dirName, pipelineStep, 'complete', {
        ...resolved.store,
        tokens: reportedTokens(content),
      });
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
      const questions = readQuestionsArtifact(options.projectRoot, resolved.dirName);
      const answerRefs = questions?.auto_answered.map((entry) => entry.source) ?? [];
      const expertRun = expertsActive(config)
        ? assembleExpertRun(options.projectRoot, resolved.dirName, config.token_ceiling)
        : null;
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
      recordStep(options.projectRoot, resolved.dirName, 'finish', 'complete', resolved.store);
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
    .description('Clear a step and everything downstream so the run re-derives them')
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
      const invalidated = redoStep(
        options.projectRoot,
        resolved.dirName,
        step as PipelineStep,
        resolved.store,
      );
      console.log(JSON.stringify({ redo: step, invalidated }));
    });

  command
    .command('metrics')
    .description('Report what the pipeline runs cost and changed')
    .option('--all', 'Aggregate across every feature bundle, not just the active feature')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((options: CommonOptions & { all?: boolean }) => {
      const dirNames = options.all ? listRunDirs(options.projectRoot) : [];
      if (!options.all) {
        const resolved = resolveDir(options);
        if (!resolved) return;
        dirNames.push(resolved.dirName);
      }
      const report = aggregateSpecPipelineMetrics(options.projectRoot, dirNames);
      console.log(JSON.stringify(report, null, 2));
      const roles = Object.keys(report.changed_spec_rate).sort();
      if (roles.length > 0) {
        console.log(
          '\nrole                    tier      fired  changed  empty rate  voice warnings  tokens',
        );
        for (const role of roles) {
          const key = role as keyof typeof report.changed_spec_rate;
          const rate = report.changed_spec_rate[key]!;
          const tokens = report.tokens_by_role[key] ?? 0;
          const tier = report.tier_by_role[key] ?? 'on-call';
          const empty = report.empty_by_role[key];
          const emptyRate =
            empty && empty.fired > 0 ? `${Math.round((empty.empty / empty.fired) * 100)}%` : '—';
          const warnings = report.voice_warnings_by_role[key] ?? 0;
          console.log(
            `${role.padEnd(22)}  ${tier.padEnd(8)}  ${String(rate.fired).padStart(5)}  ${String(rate.changed).padStart(7)}  ${emptyRate.padStart(10)}  ${String(warnings).padStart(14)}  ${String(tokens).padStart(6)}`,
          );
        }
        console.log(
          '\nA standing expert with a changed_spec rate under 30% over 20 runs is a demotion candidate; change spec_pipeline_standing_experts to demote. Nothing is demoted automatically.',
        );
      }
    });

  return command;
}

function createExpertsCommand(): Command {
  const experts = new Command('experts').description(
    'Expert roster: record the model-decided expert need and their notes',
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

  const recordHighTable = (what: string, write: () => void): void => {
    try {
      write();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`could not record the High Table ${what} row: ${message}`);
    }
  };

  const readHandedFile = (
    options: CommonOptions,
    dirName: string,
    file: string,
    what: string,
  ): string | null => {
    try {
      const content = readFileSync(file, 'utf8');
      rememberInput(options.projectRoot, dirName, file);
      return content;
    } catch {
      console.error(`could not read ${what} artifact "${file}"`);
      process.exitCode = 1;
      return null;
    }
  };

  experts
    .command('record')
    .description('Store the model-decided expert need as the experts.json roster')
    .argument('<file>', 'Path to the need artifact the expert-need-detector produced')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((file: string, options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      if (gateExperts(options, resolved.dirName)) return;
      const content = readHandedFile(options, resolved.dirName, file, 'need');
      if (content === null) return;
      const check = validateExpertNeed(content);
      if (!check.ok || !check.artifact) {
        console.error(`expert-need artifact is invalid: ${check.error}`);
        process.exitCode = 1;
        return;
      }
      const config = readPipelineConfig(options.projectRoot);
      const lane = readChangeConstants(options.projectRoot, resolved.dirName).lane ?? 'full';
      const standingSits = config.experts_lanes.includes(lane);
      const plannedFiles = planFiles(readFeaturePlan(options.projectRoot, resolved.dirName)?.steps);
      const needs = seatExpertsForLane({
        detectorNeeds: check.artifact.experts,
        standing: config.standing_experts,
        standingSits,
        pathSeats: pathTriggeredSeats({
          standingSits,
          sensitivePath: standingSits
            ? null
            : (sensitivePaths(options.projectRoot, plannedFiles)[0] ?? null),
          skillPath: firstPlannedSkillPath(options.projectRoot, plannedFiles),
        }),
      });
      const projectVoice = resolveProjectVoice(options.projectRoot, resolved.dirName);
      const { briefs } = buildExpertBriefs({
        needs,
        request: readRequest(options.projectRoot, resolved.dirName),
        grounding: readGrounding(options.projectRoot, resolved.dirName)!,
        label: readLabel(options.projectRoot, resolved.dirName)!,
        ceiling: config.token_ceiling,
        projectVoice,
      });
      const roster = briefs.map((brief, index) => rosterEntryFor(needs[index]!, brief));
      writeExpertRoster(options.projectRoot, resolved.dirName, roster, resolved.store);
      recordHighTable('seated', () =>
        recordSeatedRows(
          options.projectRoot,
          resolved.dirName,
          roster.map((entry, index) => ({
            role: entry.role,
            reason: entry.reason,
            origin: entry.origin ?? null,
            budget_tokens: entry.budget_tokens,
            clamped: briefs[index]!.clamped,
          })),
          resolved.store,
        ),
      );
      if (roster.length === 0) {
        recordStep(options.projectRoot, resolved.dirName, 'experts', 'skipped', resolved.store);
        if (!standingSits) {
          console.log(
            `**▸ paqad** · skipped the High Table: no on-call expert is needed on the ${lane} lane`,
          );
        }
      }
      const standingCount = needs.filter((need) => need.origin === 'standing').length;
      console.log(
        JSON.stringify({
          recorded: 'expert-need',
          experts: roster.length,
          standing: standingCount,
          on_call: roster.length - standingCount,
          briefs: roster.map((entry) => entry.role),
        }),
      );
    });

  experts
    .command('brief')
    .description("Print one expert's brief (rebuilt from the run; never stored as a file)")
    .argument('<role>', 'The expert role on the recorded roster')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((role: string, options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      if (refuseWhenOff(options)) return;
      const entry = readExperts(options.projectRoot, resolved.dirName)?.roster.find(
        (candidate) => candidate.role === role,
      );
      if (!entry) {
        console.error(`"${role}" is not on the recorded roster — run \`experts record\` first`);
        process.exitCode = 1;
        return;
      }
      const grounding = readGrounding(options.projectRoot, resolved.dirName);
      const label = readLabel(options.projectRoot, resolved.dirName);
      if (!grounding || !label) {
        console.error('the run has no grounding or label recorded — run the pipeline start first');
        process.exitCode = 1;
        return;
      }
      const brief = renderExpertBrief({
        need: { role: entry.role, reason: entry.reason },
        request: readRequest(options.projectRoot, resolved.dirName),
        grounding,
        label,
        granted: entry.budget_tokens,
        projectVoice: resolveProjectVoice(options.projectRoot, resolved.dirName),
      });
      if (brief.hash !== entry.brief_hash) {
        console.error(
          `the brief for "${role}" no longer matches the recorded one (the request, grounding or label changed) — run \`experts record\` again`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(brief.content);
      recordHighTable('writing', () =>
        recordWritingRow(options.projectRoot, resolved.dirName, entry.role, resolved.store),
      );
    });

  experts
    .command('context')
    .description('Print what the need detector and the chief architect read, as JSON')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      if (refuseWhenOff(options)) return;
      const notes = readExpertNotes(options.projectRoot, resolved.dirName);
      const seated = (readExperts(options.projectRoot, resolved.dirName)?.roster.length ?? 0) > 0;
      console.log(
        JSON.stringify(
          {
            request: readRequest(options.projectRoot, resolved.dirName),
            grounding: readGrounding(options.projectRoot, resolved.dirName),
            label: readLabel(options.projectRoot, resolved.dirName),
            roster: readExperts(options.projectRoot, resolved.dirName)?.roster ?? [],
            notes: notes?.notes ?? null,
            voice_warnings:
              readExperts(options.projectRoot, resolved.dirName)?.voice_warnings ?? [],
            merge: notes
              ? mergeExpertNotes(
                  notes.notes,
                  readExperts(options.projectRoot, resolved.dirName)?.voice_warnings,
                )
              : null,
          },
          null,
          2,
        ),
      );
      if (seated && notes !== null) {
        recordHighTable('writing', () =>
          recordWritingRow(options.projectRoot, resolved.dirName, CHIEF_ROLE, resolved.store),
        );
      }
    });

  experts
    .command('notes')
    .description("Store the experts' findings + token actuals into experts.json")
    .argument('<file>', 'Path to the notes artifact the experts produced')
    .option(...projectRootOpt)
    .option(...sessionOpt)
    .action((file: string, options: CommonOptions) => {
      const resolved = resolveDir(options);
      if (!resolved) return;
      if (gateExperts(options, resolved.dirName)) return;
      const content = readHandedFile(options, resolved.dirName, file, 'notes');
      if (content === null) return;
      const check = validateExpertNotes(
        content,
        plainLanguageSources(options.projectRoot, resolved.dirName),
        findingVoiceSources(options.projectRoot, resolved.dirName),
      );
      if (!check.ok || !check.artifact) {
        console.error(`expert-notes artifact is invalid: ${check.error}`);
        process.exitCode = 1;
        return;
      }
      writeExpertNotes(options.projectRoot, resolved.dirName, check.artifact, resolved.store);
      for (const note of check.artifact.notes) {
        recordHighTable('done', () =>
          recordDoneRow(
            options.projectRoot,
            resolved.dirName,
            {
              role: note.role,
              findings: note.findings.length,
              tokens_estimate: check.artifact!.tokens[note.role] ?? null,
            },
            resolved.store,
          ),
        );
      }
      const merged = mergeExpertNotes(check.artifact.notes, check.artifact.voice_warnings);
      console.log(
        JSON.stringify({
          recorded: 'expert-notes',
          notes: check.artifact.notes.length,
          findings: merged.findings.length,
          conflicts: merged.conflicts.length,
          voice_warnings: check.artifact.voice_warnings?.length ?? 0,
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
      const notes = readExpertNotes(options.projectRoot, resolved.dirName);
      if (!notes) {
        console.error('no expert notes — run `paqad-ai spec pipeline experts notes` first');
        process.exitCode = 1;
        return;
      }
      const experts = readExperts(options.projectRoot, resolved.dirName);
      const merged = mergeExpertNotes(notes.notes, experts?.voice_warnings);
      const content = readHandedFile(options, resolved.dirName, file, 'synthesis');
      if (content === null) return;
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
      const { minted, autoResolved } = mintExpertConflictDecisions(
        options.projectRoot,
        merged,
        check.artifact.conflicts,
        resolved.dirName,
      );
      const compatible = applyCompatibleRulings(
        experts?.findings ?? [],
        check.artifact.conflicts,
        check.artifact.accepted,
      );
      const synthesis = {
        ...check.artifact,
        accepted: compatible.accepted,
        ...(autoResolved.length > 0 ? { auto_resolved: autoResolved } : {}),
      };
      let renamed = 0;
      let findings = compatible.findings;
      if (synthesis.renames && synthesis.renames.length > 0 && experts?.findings) {
        const updated = applyRenames(findings, synthesis.renames);
        renamed = updated.filter(
          (finding, index) => finding.target !== findings[index]!.target,
        ).length;
        findings = updated as typeof findings;
      }
      if (experts?.findings && (renamed > 0 || compatible.merged > 0)) {
        writeExpertFindings(options.projectRoot, resolved.dirName, findings, resolved.store);
      }
      writeExpertSynthesis(options.projectRoot, resolved.dirName, synthesis, resolved.store);
      recordHighTable('done', () =>
        recordDoneRow(
          options.projectRoot,
          resolved.dirName,
          { role: CHIEF_ROLE, findings: null, tokens_estimate: synthesis.tokens },
          resolved.store,
        ),
      );
      recordStep(options.projectRoot, resolved.dirName, 'experts', 'complete', resolved.store);
      const proofMethod = raiseFixProofMethodDecision(options.projectRoot, resolved.dirName);
      if (proofMethod?.raised) {
        console.warn(fixProofMethodLine(proofMethod.id, { deferred: true }));
      }
      console.log(
        JSON.stringify({
          recorded: 'expert-synthesis',
          verdict: synthesis.verdict,
          accepted: synthesis.accepted.length,
          declined: synthesis.declined.length,
          conflicts_pending: minted.length,
          compatible: compatible.merged,
          auto_resolved: autoResolved.length,
          gaps: synthesis.gaps.length,
          renamed,
          ...(proofMethod ? { fix_proof_method: proofMethod.id } : {}),
        }),
      );
    });

  return experts;
}
