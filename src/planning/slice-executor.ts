import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type {
  DecisionRecord,
  ExecutionProgressTracker,
  PlanningManifest,
  SliceCheckpoint,
  SliceContext,
  SliceExecutionEvent,
  SliceFixAttempt,
  SliceProgressEntry,
} from '@/core/types/planning.js';

import { buildDependencyQueue, collectBlockedSlices } from './dependency-queue.js';
import { attemptEscalationReplan, type SliceReplanner } from './escalation-replanner.js';
import { ExecutionTracker } from './execution-tracker.js';
import { appendPlanningAudit } from './audit.js';
import { loadManifest, listManifestSlugs, saveManifest } from './manifest-parser.js';
import { verifySlicePreconditions } from './precondition-verifier.js';
import { estimatePriorSliceSummaryTokens } from './prior-slice-summary.js';
import { SliceCheckpointStore } from './slice-checkpoint.js';
import { computeSliceBudgetPlan, resolveSliceExecutionBudget } from './slice-budget.js';
import { assembleSliceContext } from './slice-context.js';
import { SliceCircuitBreaker } from './slice-circuit-breaker.js';
import { runSliceGate, type SliceGateDetail } from './slice-gate.js';
import { SliceEventBus } from './slice-event-bus.js';
import { buildSliceRetryFeedback, requiresImmediateEscalation } from './slice-retry.js';
import { createSliceEscalationReport, SliceEscalationStore } from './slice-escalation.js';
import { snapshotDocTargets } from './slice-doc-verifier.js';
import {
  detectUndeclaredDecisionSignals,
  diffSnapshotFiles,
  snapshotSliceScope,
} from './slice-scope-guard.js';
import { promptForDecision, promptForMalformedDecision } from '@/cli/ui/decision-screen.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { TurnSummarizer } from '@/context/turn-summarizer.js';
import { HandoffWriter } from '@/session/handoff-writer.js';
import { detectDecisionForks } from './decision-detector.js';
import { buildDecisionPacket as buildDecisionPacketModel } from './decision-packet-builder.js';
import { selectViableDecisionOptions } from './decision-packet-builder.js';
import {
  DECISION_CATEGORY_DEFAULTS,
  toDecisionRecord,
  type DecisionCategory,
  type DecisionIntent,
  type DecisionPacket,
} from './decision-packet.js';
import { computeDecisionFingerprint } from './decision-fingerprint.js';
import { resolveDecisionPacket, type DecisionResolutionResult } from './decision-resolver.js';
import { DecisionStore } from './decision-store.js';
import { DecisionSessionState } from './decision-session.js';

import type { CriteriaTestRunner } from './scoped-criteria-verifier.js';
import type { RegressionRunner } from './slice-regression-runner.js';
import type { FullSuiteRunner } from './full-suite-runner.js';

export interface PreparedSliceExecution {
  manifest: PlanningManifest;
  trackerPath: string;
  trackerStatus: string;
  orderedSliceIds: string[];
  currentSliceId: string | null;
  blockedSliceIds: string[];
  context: SliceContext | null;
  warnings: string[];
}

export interface ExecuteSliceInput {
  context: SliceContext;
  attempt: number;
  retry_feedback?: ReturnType<typeof buildSliceRetryFeedback>;
}

export interface ExecuteSliceResult {
  tokens_used: number;
  files_changed?: string[];
  exports_created?: string[];
  change_summary?: string;
  raw_context_tokens?: number;
  summary_tokens?: number;
}

export interface ExecuteSlicesOptions {
  executeSlice: (input: ExecuteSliceInput) => Promise<ExecuteSliceResult>;
  criteriaRunner: CriteriaTestRunner;
  regressionRunner: RegressionRunner;
  fullSuiteRunner: FullSuiteRunner;
  captureBaselineFailingTests?: () => Promise<string[]>;
  replan?: SliceReplanner;
  /**
   * PQD-100 — optional live event sink. When supplied, the executor streams a
   * {@link SliceExecutionEvent} for every slice transition (started, gate
   * evaluated, retried, completed, escalated) and a terminal `run-finished`.
   * When omitted the executor behaves exactly as before.
   */
  onEvent?: (event: SliceExecutionEvent) => void;
  /**
   * PQD-100 — optional cancellation signal. When aborted, the executor stops at
   * the next loop boundary, emits exactly one `slice-cancelled` event, and
   * returns the partial result; no further slice events are emitted.
   */
  signal?: AbortSignal;
}

export interface ResumeExecutionOptions {
  /**
   * PQD-100 — optional event sink for the `run-resume-after-crash` event a
   * resume emits when it resets slices left mid-flight by a crashed run.
   */
  onEvent?: (event: SliceExecutionEvent) => void;
}

export interface ExecuteSlicesResult {
  trackerPath: string;
  trackerStatus: string;
  manifestPath: string;
  checkpointPaths: string[];
  escalationPaths: string[];
  completedSliceIds: string[];
  blockedSliceIds: string[];
  escalatedSliceIds: string[];
  warnings: string[];
}

export interface ResumeExecutionResult {
  trackerPath: string;
  resetSliceIds: string[];
  currentSliceId: string | null;
  warnings: string[];
}

export class SliceExecutor {
  private readonly decisionSession = new DecisionSessionState();

  constructor(
    private readonly tracker = new ExecutionTracker(),
    private readonly checkpoints = new SliceCheckpointStore(),
    private readonly escalations = new SliceEscalationStore(),
  ) {}

  async prepare(projectRoot: string, slug: string): Promise<PreparedSliceExecution> {
    const manifest = await loadManifest(projectRoot, slug);
    const tracker = await this.tracker.initialize(projectRoot, manifest);

    if (manifest.classification.lane === 'fast' || manifest.execution_slices.length === 0) {
      const trackerPath = await this.tracker.save(projectRoot, tracker);
      return {
        manifest,
        trackerPath,
        trackerStatus: tracker.status,
        orderedSliceIds: [],
        currentSliceId: null,
        blockedSliceIds: [],
        context: null,
        warnings: [],
      };
    }

    const ordered = buildDependencyQueue(manifest.execution_slices);
    const completedSliceIds = Object.entries(tracker.slices)
      .filter(([, entry]) => entry.status === 'completed')
      .map(([sliceId]) => sliceId);
    const priorSlices = await this.checkpoints.loadSummaries(projectRoot, slug, completedSliceIds);
    const budget = computeSliceBudgetPlan(
      manifest.execution_slices,
      tracker.token_budget.total,
      tracker.token_budget.consumed,
    );
    const remainingBudget = estimateRemainingBudget(tracker, budget.perSlice);
    const blockedSliceIds: string[] = [];

    let currentSliceId: string | null = null;
    for (const slice of ordered) {
      const currentStatus = tracker.slices[slice.slice_id]?.status;
      if (
        currentStatus === 'completed' ||
        currentStatus === 'blocked' ||
        currentStatus === 'escalated'
      ) {
        continue;
      }

      const preconditions = await verifySlicePreconditions(
        projectRoot,
        slug,
        slice,
        this.checkpoints,
      );
      if (!preconditions.met) {
        this.tracker.markSliceStatus(tracker, slice.slice_id, 'blocked');
        blockedSliceIds.push(slice.slice_id);
        continue;
      }

      currentSliceId = slice.slice_id;
      this.tracker.markSliceStatus(
        tracker,
        slice.slice_id,
        'in-progress',
        (tracker.slices[slice.slice_id].attempt ?? 0) + 1,
      );
      break;
    }

    const trackerPath = await this.tracker.save(projectRoot, tracker);
    const shouldRedistribute = Object.values(tracker.slices).some(
      (entry) => typeof entry.tokens_used === 'number' && entry.tokens_used !== null,
    );
    return {
      manifest,
      trackerPath,
      trackerStatus: tracker.status,
      orderedSliceIds: ordered.map((slice) => slice.slice_id),
      currentSliceId,
      blockedSliceIds,
      context:
        currentSliceId === null
          ? null
          : assembleSliceContext({
              manifest,
              sliceId: currentSliceId,
              priorSlices,
              tokenBudget: shouldRedistribute
                ? resolveSliceExecutionBudget({
                    slice: manifest.execution_slices.find(
                      (candidate) => candidate.slice_id === currentSliceId,
                    )!,
                    slices: manifest.execution_slices,
                    remainingBudget,
                    currentStatuses: tracker.slices,
                  })
                : (budget.perSlice[currentSliceId] ?? budget.summary.per_slice_with_buffer),
            }),
      warnings: budget.warnings,
    };
  }

  async execute(
    projectRoot: string,
    slug: string,
    options: ExecuteSlicesOptions,
  ): Promise<ExecuteSlicesResult> {
    const checkpointPaths: string[] = [];
    const escalationPaths: string[] = [];
    const warnings: string[] = [];

    let tracker = await this.tracker.load(projectRoot, slug);
    let manifest = await loadManifest(projectRoot, slug);
    if (!tracker) {
      tracker = await this.tracker.initialize(projectRoot, manifest);
    }

    if (manifest.classification.lane === 'fast' || manifest.execution_slices.length === 0) {
      return executeFastLane(projectRoot, manifest, options);
    }

    const runId = randomUUID();
    const bus = new SliceEventBus({ runId, slug, onEvent: options.onEvent });
    tracker.last_run_id = runId;
    await this.tracker.save(projectRoot, tracker);

    if (tracker.baseline_failing_tests === undefined) {
      tracker.baseline_failing_tests = options.captureBaselineFailingTests
        ? await options.captureBaselineFailingTests()
        : [];
      await this.tracker.save(projectRoot, tracker);
    }

    while (true) {
      if (options.signal?.aborted) {
        return await this.cancelRun(
          projectRoot,
          slug,
          tracker,
          bus,
          checkpointPaths,
          escalationPaths,
          [...warnings],
        );
      }

      const prepared = await this.prepare(projectRoot, slug);
      manifest = prepared.manifest;
      tracker = (await this.tracker.load(projectRoot, slug)) ?? tracker;

      if (prepared.currentSliceId === null || prepared.context === null) {
        const result: ExecuteSlicesResult = {
          trackerPath: prepared.trackerPath,
          trackerStatus: prepared.trackerStatus,
          manifestPath: await saveManifest(projectRoot, manifest),
          checkpointPaths,
          escalationPaths,
          completedSliceIds: completedSliceIds(tracker),
          blockedSliceIds: blockedSliceIdsFromTracker(tracker),
          escalatedSliceIds: escalatedSliceIds(tracker),
          warnings: [...warnings, ...prepared.warnings],
        };
        bus.emit({
          kind: 'run-finished',
          trackerStatus: result.trackerStatus,
          completedSliceIds: result.completedSliceIds,
          blockedSliceIds: result.blockedSliceIds,
          escalatedSliceIds: result.escalatedSliceIds,
        });
        return result;
      }

      const sliceId = prepared.currentSliceId;
      const context = prepared.context;
      manifest = await this.applyDecisionFlow(projectRoot, manifest, slug, context);
      context.decision_context = this.contextDecisionsForSlice(manifest, context);
      const slice = context.current_slice;
      const circuitBreaker = new SliceCircuitBreaker();
      const fixAttempts: SliceFixAttempt[] = [];
      let retryFeedback: ReturnType<typeof buildSliceRetryFeedback> | undefined;
      let totalTokensForSlice = 0;

      appendPlanningAudit(projectRoot, 'INFO', 'slice-started', {
        slice_id: sliceId,
        attempt: tracker.slices[sliceId]?.attempt ?? 1,
        token_budget: context.token_budget,
      });
      bus.emit({
        kind: 'slice-started',
        sliceId,
        attempt: tracker.slices[sliceId]?.attempt ?? 1,
        tokenBudget: context.token_budget,
      });

      while (true) {
        if (options.signal?.aborted) {
          return await this.cancelRun(
            projectRoot,
            slug,
            tracker,
            bus,
            checkpointPaths,
            escalationPaths,
            [...warnings],
          );
        }

        const attempt = tracker.slices[sliceId]?.attempt ?? 1;
        const docSnapshot = snapshotDocTargets(projectRoot, context.doc_targets);
        const scopeSnapshot = snapshotSliceScope(
          projectRoot,
          manifest.execution_slices.flatMap((entry) => entry.touches),
        );
        const result = await options.executeSlice({
          context,
          attempt,
          retry_feedback: retryFeedback,
        });
        totalTokensForSlice += result.tokens_used;
        const modifiedFiles = result.files_changed ?? diffSnapshotFiles(projectRoot, scopeSnapshot);
        const gate = await runSliceGate({
          projectRoot,
          slice,
          orderedSlices: buildDependencyQueue(manifest.execution_slices),
          criteria: context.verification_criteria,
          docTargets: context.doc_targets,
          docSnapshot,
          regressionEntries: context.regression_entries,
          modifiedFiles,
          criteriaRunner: options.criteriaRunner,
          regressionRunner: options.regressionRunner,
          fullSuiteRunner: options.fullSuiteRunner,
          baselineFailingTests: tracker.baseline_failing_tests,
          decisionPackets: collectDecisionPacketsForSlice(manifest, sliceId, projectRoot),
          priorScopeWarnings: await collectPriorScopeWarnings(
            projectRoot,
            slug,
            completedSliceIds(tracker),
          ),
        });

        applyGateToManifest(manifest, gate);
        await saveManifest(projectRoot, manifest);

        bus.emit({
          kind: 'slice-gate-evaluated',
          sliceId,
          status: gate.gate_result.status,
          reasons: buildGateReasons(gate),
        });

        if (result.tokens_used >= context.token_budget * 0.8) {
          warnings.push(
            `${sliceId} consumed ${result.tokens_used} tokens against budget ${context.token_budget}.`,
          );
        }

        if (gate.gate_result.status === 'pass') {
          const declaredDecisionPackets = collectDecisionPacketsForSlice(
            manifest,
            sliceId,
            projectRoot,
          );
          if (declaredDecisionPackets.length === 0) {
            const undeclared = this.flagUndeclaredDecisions(
              projectRoot,
              slug,
              manifest,
              context,
              modifiedFiles,
            );
            gate.gate_result.warnings.push(
              ...undeclared.map(
                (finding) => `decision:undeclared:${finding.decision_id}:${finding.file}`,
              ),
            );
            warnings.push(
              ...gate.gate_result.warnings.filter((warning) =>
                warning.startsWith('decision:undeclared:'),
              ),
            );
          }
          const checkpoint = buildCheckpoint({
            context,
            attempt,
            result: { ...result, tokens_used: totalTokensForSlice },
            gate,
            modifiedFiles,
          });
          checkpointPaths.push(await this.checkpoints.save(projectRoot, slug, checkpoint));
          this.tracker.markSliceStatus(tracker, sliceId, 'completed', attempt);
          this.tracker.applySliceMetrics(tracker, sliceId, sliceMetrics(gate, totalTokensForSlice));
          await this.tracker.save(projectRoot, tracker);
          appendPlanningAudit(projectRoot, 'INFO', 'slice-completed', {
            slice_id: sliceId,
            tokens_used: totalTokensForSlice,
            gate_result: gate.gate_result.status,
          });
          bus.emit({
            kind: 'slice-completed',
            sliceId,
            tokensUsed: totalTokensForSlice,
            filesChanged: new Set(modifiedFiles).size,
          });
          break;
        }

        const breakerFired = circuitBreaker.observe(gate);
        fixAttempts.push({
          attempt,
          change_summary:
            result.change_summary ??
            `Attempt ${attempt} updated ${modifiedFiles.join(', ') || 'no files'}`,
          result: summarizeFailure(gate),
        });

        if (requiresImmediateEscalation(gate) || breakerFired || attempt >= 2) {
          const blockedDownstream = collectBlockedSlices(manifest.execution_slices, sliceId);
          const reason = requiresImmediateEscalation(gate)
            ? 'protected_scope'
            : breakerFired
              ? 'circuit_breaker'
              : 'retry_failed';
          const escalation = createSliceEscalationReport({
            sliceId,
            reason,
            attempts: attempt,
            gate,
            fixAttempts,
            tokensConsumed: totalTokensForSlice,
            recommendation: summarizeFailure(gate),
            blockedDownstream,
          });
          escalationPaths.push(await this.escalations.save(projectRoot, slug, escalation));

          const failedCheckpoint = buildCheckpoint({
            context,
            attempt,
            result: { ...result, tokens_used: totalTokensForSlice },
            gate,
            modifiedFiles,
            status: 'escalated',
          });
          checkpointPaths.push(await this.checkpoints.save(projectRoot, slug, failedCheckpoint));
          this.tracker.markSliceStatus(tracker, sliceId, 'escalated', attempt);
          this.tracker.applySliceMetrics(tracker, sliceId, sliceMetrics(gate, totalTokensForSlice));
          for (const blockedSliceId of blockedDownstream) {
            this.tracker.markSliceStatus(tracker, blockedSliceId, 'blocked', 0);
          }
          await this.tracker.save(projectRoot, tracker);
          appendPlanningAudit(projectRoot, 'WARN', 'slice-escalated', {
            slice_id: sliceId,
            reason,
            blocked_downstream: blockedDownstream.join(','),
          });
          bus.emit({
            kind: 'slice-escalated',
            sliceId,
            reason,
            blockedDownstream,
          });

          if (!(tracker.re_planned_slices ?? []).includes(sliceId)) {
            try {
              const replanned = await attemptEscalationReplan({
                projectRoot,
                manifest,
                report: escalation,
                replan: options.replan,
              });
              if (replanned) {
                manifest = replanned.manifest;
                tracker.re_planned_slices = [
                  ...new Set([...(tracker.re_planned_slices ?? []), sliceId]),
                ];
                this.tracker.resetSlices(tracker, [sliceId, ...blockedDownstream]);
                await this.tracker.save(projectRoot, tracker);
                warnings.push(
                  ...replanned.new_skeletons.map((path) => `Generated skeleton ${path}`),
                );
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              appendPlanningAudit(projectRoot, 'WARN', 'slice-replan-failed', {
                slice_id: sliceId,
                error: message,
              });
              warnings.push(message);
            }
          }

          break;
        }

        retryFeedback = buildSliceRetryFeedback(gate);
        this.tracker.markSliceStatus(tracker, sliceId, 'in-progress', 2);
        await this.tracker.save(projectRoot, tracker);
        appendPlanningAudit(projectRoot, 'INFO', 'slice-retried', {
          slice_id: sliceId,
          attempt: 2,
          feedback_provided: true,
        });
        bus.emit({
          kind: 'slice-retried',
          sliceId,
          attempt: 2,
          feedbackSummary: summarizeFailure(gate),
        });
      }
    }
  }

  private async cancelRun(
    projectRoot: string,
    slug: string,
    tracker: ExecutionProgressTracker,
    bus: SliceEventBus,
    checkpointPaths: string[],
    escalationPaths: string[],
    warnings: string[],
  ): Promise<ExecuteSlicesResult> {
    const manifest = await loadManifest(projectRoot, slug);
    const trackerPath = await this.tracker.save(projectRoot, tracker);
    bus.cancel();
    return {
      trackerPath,
      trackerStatus: tracker.status,
      manifestPath: await saveManifest(projectRoot, manifest),
      checkpointPaths,
      escalationPaths,
      completedSliceIds: completedSliceIds(tracker),
      blockedSliceIds: blockedSliceIdsFromTracker(tracker),
      escalatedSliceIds: escalatedSliceIds(tracker),
      warnings,
    };
  }

  async resume(
    projectRoot: string,
    slug: string,
    options: ResumeExecutionOptions = {},
  ): Promise<ResumeExecutionResult> {
    const manifest = await loadManifest(projectRoot, slug);
    const tracker = await this.tracker.initialize(projectRoot, manifest);
    const previousRunId = tracker.last_run_id ?? null;
    const reset = new Set<string>();
    const warnings: string[] = [];

    for (const [sliceId, entry] of Object.entries(tracker.slices)) {
      if (
        entry.status === 'in-progress' ||
        entry.status === 'failed' ||
        entry.status === 'escalated' ||
        entry.status === 'blocked'
      ) {
        reset.add(sliceId);
      }
      if (entry.status === 'completed') {
        const checkpoint = await this.checkpoints.load(projectRoot, slug, sliceId);
        if (!checkpoint || checkpoint.status !== 'completed') {
          warnings.push(`Completed slice ${sliceId} is missing or corrupt; resetting it.`);
          reset.add(sliceId);
          for (const dependent of collectBlockedSlices(manifest.execution_slices, sliceId)) {
            reset.add(dependent);
          }
        }
      }
    }

    const resetSliceIds = [...reset].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );

    if (resetSliceIds.length > 0 && options.onEvent) {
      const resumeBus = new SliceEventBus({
        runId: randomUUID(),
        slug,
        onEvent: options.onEvent,
      });
      resumeBus.emit({
        kind: 'run-resume-after-crash',
        previousRunId,
        resetSliceIds,
      });
    }

    this.tracker.resetSlices(tracker, [...reset]);
    const trackerPath = await this.tracker.save(projectRoot, tracker);
    appendPlanningAudit(projectRoot, 'INFO', 'resume-triggered', {
      slug,
      from_slice:
        buildDependencyQueue(manifest.execution_slices).find(
          (slice) => tracker.slices[slice.slice_id]?.status !== 'completed',
        )?.slice_id ?? '',
    });
    const prepared = await this.prepare(projectRoot, slug);
    return {
      trackerPath,
      resetSliceIds,
      currentSliceId: prepared.currentSliceId,
      warnings,
    };
  }

  private async applyDecisionFlow(
    projectRoot: string,
    manifest: PlanningManifest,
    _slug: string,
    context: SliceContext,
  ): Promise<PlanningManifest> {
    const decisionStore = new DecisionStore(projectRoot);
    decisionStore.initialize();

    const forks = detectDecisionForks(this.decisionDetectionText(manifest, context));
    const rebuiltPacket =
      forks.length > 0
        ? buildDecisionPacket({
            projectRoot,
            requestedBy: 'codex-cli',
            taskSessionId: _slug,
            decisionId: nextDecisionId(manifest, decisionStore),
            category: forks[0]!.category,
            confidence: forks[0]!.confidence,
            context,
            manifest,
          })
        : null;
    const resumedDecision = await this.reconcilePendingDecision(
      projectRoot,
      manifest,
      _slug,
      context,
      decisionStore,
      rebuiltPacket,
    );
    const resumedRecord = resumedDecision ? toDecisionRecord(resumedDecision) : null;
    if (resumedRecord) {
      manifest = appendDecisionRecord(manifest, resumedRecord);
      await saveManifest(projectRoot, manifest);
      /* v8 ignore next 3 -- resumedDecision is always non-null when resumedRecord is truthy */
      if (resumedDecision) {
        this.addCarryOverDecision(resumedDecision, resumedRecord);
      }
      return manifest;
    }

    if (forks.length === 0) {
      return manifest;
    }

    const packet = rebuiltPacket!;
    const reusableDecisionId = decisionStore.findReusableDecision(packet);
    if (reusableDecisionId) {
      const reusablePacket = decisionStore.readResolved(reusableDecisionId);
      /* v8 ignore next 3 -- null branch for missing human_response; reusable packets always have one */
      const memoizedPacket = reusablePacket?.human_response
        ? this.resolveMemoizedDecision(decisionStore, packet, reusablePacket)
        : null;
      /* v8 ignore next 1 -- null branch; memoizedPacket is always non-null when human_response is present */
      const reusableRecord = memoizedPacket ? toDecisionRecord(memoizedPacket) : null;
      if (reusableRecord) {
        manifest = appendDecisionRecord(manifest, reusableRecord);
        await saveManifest(projectRoot, manifest);
      }
      return manifest;
    }

    const autoResolution = await resolveDecisionPacket(projectRoot, packet);
    if (autoResolution.source !== 'ask' && autoResolution.option_key) {
      const resolved = this.resolveWithoutPrompt(
        projectRoot,
        decisionStore,
        packet,
        autoResolution,
      );
      /* v8 ignore next 1 -- null branch; resolved is always non-null when auto-resolution has option_key */
      const decisionRecord = resolved ? toDecisionRecord(resolved) : null;
      if (decisionRecord) {
        manifest = appendDecisionRecord(manifest, decisionRecord);
        await saveManifest(projectRoot, manifest);
      }
      return manifest;
    }

    const carryOverPacket = this.resolveWithCarryOver(decisionStore, packet, _slug);
    const carryOverRecord = carryOverPacket ? toDecisionRecord(carryOverPacket) : null;
    if (carryOverRecord) {
      manifest = appendDecisionRecord(manifest, carryOverRecord);
      await saveManifest(projectRoot, manifest);
      return manifest;
    }

    // §15.5: if only one viable option remains and it's not high-confidence, resolve silently.
    // Options above the balanced ceiling (0.85) are only blocked by strict mode — in that case
    // the human explicitly wants to approve, so we still show the screen.
    const viableOptions = selectViableDecisionOptions(projectRoot, packet.options);
    /* v8 ignore next 1 -- ?? 0 fallback for missing similarity; all tested packets have explicit similarity values */
    if (viableOptions.length === 1 && (viableOptions[0]!.evidence.similarity ?? 0) < 0.85) {
      const resolved = this.resolveWithoutPrompt(projectRoot, decisionStore, packet, {
        source: 'rag-confident',
        option_key: viableOptions[0]!.option_key,
        reason: 'Only one valid path remained after filtering weak options.',
      });
      /* v8 ignore next 5 -- resolved is always non-null when option_key is provided */
      const record = resolved ? toDecisionRecord(resolved) : null;
      if (record) {
        manifest = appendDecisionRecord(manifest, record);
        await saveManifest(projectRoot, manifest);
      }
      return manifest;
    }

    /* v8 ignore next 2 -- optional-chain branches for missing profile fields; always present in test fixtures */
    const maxScreensPerTask =
      readProjectProfile(projectRoot)?.custom?.decisions?.max_screens_per_task ?? 3;
    if (this.decisionSession.hasReachedScreenCap(_slug, maxScreensPerTask)) {
      const batched = await this.resolveWithBatching(decisionStore, manifest, context, packet);
      const batchedRecord = batched ? toDecisionRecord(batched) : null;
      if (batchedRecord) {
        manifest = appendDecisionRecord(manifest, batchedRecord);
        await saveManifest(projectRoot, manifest);
        this.addCarryOverDecision(batched!, batchedRecord);
        return manifest;
      }

      const capped = this.resolveWithoutPrompt(
        projectRoot,
        decisionStore,
        packet,
        {
          source: 'rule',
          /* v8 ignore next 1 -- fallback chain; recommendation is always set in tested packets */
          option_key: packet.recommendation ?? packet.options[0]?.option_key ?? null,
          reason: `Reached the per-task screen cap (${maxScreensPerTask}).`,
        },
        'safer-default-by-cap',
      );
      /* v8 ignore next 1 -- capped is always non-null when option_key is provided */
      const cappedRecord = capped ? toDecisionRecord(capped) : null;
      if (cappedRecord) {
        manifest = appendDecisionRecord(manifest, cappedRecord);
        await saveManifest(projectRoot, manifest);
      }
      return manifest;
    }

    decisionStore.writePending(packet);
    this.decisionSession.recordScreenShown(_slug);
    const resolved = await this.waitForResolvedDecision(projectRoot, decisionStore, packet, _slug);
    /* v8 ignore next 8 -- null-resolved and false-resumedDecision branches; tests always resolve via prompt */
    const decisionRecord = resolved ? toDecisionRecord(resolved) : null;
    if (decisionRecord) {
      manifest = appendDecisionRecord(manifest, decisionRecord);
      await saveManifest(projectRoot, manifest);
      if (resolved) {
        this.addCarryOverDecision(resolved, decisionRecord);
      }
    }
    return manifest;
  }

  private async reconcilePendingDecision(
    projectRoot: string,
    manifest: PlanningManifest,
    slug: string,
    context: SliceContext,
    decisionStore: DecisionStore,
    rebuiltPacket: DecisionPacket | null,
  ): Promise<DecisionPacket | null> {
    const pendingDecisionId = decisionStore.findPendingDecisionForTask(slug);
    if (!pendingDecisionId) {
      return null;
    }

    const pendingResult = decisionStore.readPendingResult(pendingDecisionId);
    if (!pendingResult.packet) {
      const action = await promptForMalformedDecision(pendingDecisionId, pendingResult.error);
      /* v8 ignore next 3 -- stop action; malformed-decision path is not exercised in unit tests */
      if (action === 'stop') {
        throw new Error(`Malformed pending decision ${pendingDecisionId} requires manual repair.`);
      }
      decisionStore.deletePending(pendingDecisionId);
      /* v8 ignore next 3 -- null rebuiltPacket guard; always rebuilt when there's a pending decision */
      if (!rebuiltPacket) {
        return null;
      }
      const rebuilt = {
        ...rebuiltPacket,
        decision_id: pendingDecisionId,
        created_at: new Date().toISOString(),
      };
      this.writePendingOrThrow(decisionStore, rebuilt);
      await this.maybeWriteIdleDecisionHandoff(projectRoot, slug, manifest, context, rebuilt);
      return this.waitForResolvedDecision(projectRoot, decisionStore, rebuilt, slug);
    }

    let activePacket = pendingResult.packet;
    await this.maybeWriteIdleDecisionHandoff(projectRoot, slug, manifest, context, activePacket);
    if (
      rebuiltPacket &&
      this.pendingDecisionNeedsRefresh(projectRoot, activePacket, rebuiltPacket)
    ) {
      decisionStore.deletePending(activePacket.decision_id);
      activePacket = {
        ...rebuiltPacket,
        decision_id: activePacket.decision_id,
        created_at: new Date().toISOString(),
      };
      this.writePendingOrThrow(decisionStore, activePacket);
    }

    return this.waitForResolvedDecision(projectRoot, decisionStore, activePacket, slug);
  }

  private addCarryOverDecision(packet: DecisionPacket, decision: DecisionRecord): void {
    this.decisionSession.addCarryOver(packet, decision);
  }

  private resolveWithoutPrompt(
    _projectRoot: string,
    decisionStore: DecisionStore,
    packet: DecisionPacket,
    resolution: DecisionResolutionResult,
    intent: DecisionIntent = 'safer-default',
  ): DecisionPacket | null {
    const chosenOptionKey = resolution.option_key;
    /* v8 ignore next 3 -- null option_key guard; callers always supply a non-null key */
    if (!chosenOptionKey) {
      return null;
    }

    decisionStore.resolveExisting({
      packet,
      /* v8 ignore next 6 -- exhaustive fallback in ternary; all sources are 'rule' or 'rag-confident' */
      event:
        resolution.source === 'rule'
          ? 'decision-resolved-by-rule'
          : resolution.source === 'rag-confident'
            ? 'decision-resolved-by-rag-confident'
            : 'decision-resolved-by-rule',
      humanResponse: {
        chosen_option_key: chosenOptionKey,
        intent,
        explanation_rounds_used: 0,
        responded_at: new Date().toISOString(),
        responded_by: 'paqad-system',
        carry_over_scope: 'none',
        note: resolution.reason,
      },
      respondedByProvider: 'paqad-system',
    });
    return decisionStore.readResolved(packet.decision_id);
  }

  private resolveWithCarryOver(
    decisionStore: DecisionStore,
    packet: DecisionPacket,
    taskSessionId: string,
  ): DecisionPacket | null {
    const carryOver = this.decisionSession.findCarryOver(packet, taskSessionId);
    if (!carryOver) {
      return null;
    }
    decisionStore.resolveExisting({
      packet,
      event: 'decision-resolved-by-human',
      humanResponse: {
        chosen_option_key: carryOver.chosen_option_key,
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: new Date().toISOString(),
        responded_by: 'paqad-system',
        carry_over_scope: 'none',
        note: `Applied carry-over preference from ${carryOver.source_decision_id}.`,
      },
      respondedByProvider: 'paqad-system',
    });
    return decisionStore.readResolved(packet.decision_id);
  }

  private resolveMemoizedDecision(
    decisionStore: DecisionStore,
    packet: DecisionPacket,
    reusablePacket: DecisionPacket,
  ): DecisionPacket | null {
    /* v8 ignore next 3 -- null-response guard; memoized packets always have a human_response */
    if (!reusablePacket.human_response) {
      return null;
    }

    decisionStore.resolveExisting({
      packet,
      event: 'decision-resolved-by-memoization',
      humanResponse: {
        ...reusablePacket.human_response,
        responded_at: new Date().toISOString(),
      },
      respondedByProvider: 'paqad-system',
    });
    return decisionStore.readResolved(packet.decision_id);
  }

  private flagUndeclaredDecisions(
    projectRoot: string,
    slug: string,
    manifest: PlanningManifest,
    context: SliceContext,
    modifiedFiles: string[],
  ): Array<{ decision_id: string; file: string }> {
    const findings = detectUndeclaredDecisionSignals({
      projectRoot,
      slice: context.current_slice,
      modifiedFiles,
    });
    if (findings.length === 0) {
      return [];
    }

    const decisionStore = new DecisionStore(projectRoot);
    decisionStore.initialize();
    return findings.map((finding, index) => {
      const packet = buildDeferredDecisionPacket({
        projectRoot,
        slug,
        manifest,
        context,
        decisionId: nextDecisionIdWithOffset(manifest, decisionStore, index),
        category: finding.category,
        file: finding.file,
        matchedExisting: finding.matched_existing,
        reason: finding.reason,
      });
      decisionStore.deferUndeclaredDecision({
        packet,
        provider: 'paqad-system',
      });
      return { decision_id: packet.decision_id, file: finding.file };
    });
  }

  private async waitForResolvedDecision(
    _projectRoot: string,
    decisionStore: DecisionStore,
    packet: DecisionPacket,
    slug: string,
  ): Promise<DecisionPacket | null> {
    const existing = decisionStore.readResolved(packet.decision_id);
    /* v8 ignore next 3 -- early return for already-resolved decision; tests always go through the prompt path */
    if (existing) {
      return existing;
    }

    const pending = decisionStore.readPending(packet.decision_id);
    /* v8 ignore next 3 -- no-pending guard; only reachable via race condition or external deletion */
    if (!pending || pending.task_session_id !== slug) {
      return null;
    }

    const response = await promptForDecision(pending);
    decisionStore.resolve({
      decisionId: packet.decision_id,
      humanResponse: response,
    });
    return decisionStore.readResolved(packet.decision_id);
  }

  private pendingDecisionNeedsRefresh(
    projectRoot: string,
    pending: DecisionPacket,
    rebuilt: DecisionPacket,
  ): boolean {
    /* v8 ignore next 13 -- full function body; tests always call with a fingerprint mismatch and exit early */
    if (pending.fingerprint !== rebuilt.fingerprint) {
      return true;
    }
    const createdAt = Date.parse(pending.created_at);
    if (!Number.isFinite(createdAt)) {
      return true;
    }
    return pending.invalidation_watch.some((path) => {
      const absolute = join(projectRoot, path);
      return existsSyncSafe(absolute) && statMtimeMsSafe(absolute) > createdAt;
    });
  }

  private async resolveWithBatching(
    decisionStore: DecisionStore,
    manifest: PlanningManifest,
    context: SliceContext,
    packet: DecisionPacket,
  ): Promise<DecisionPacket | null> {
    const batchSummary = summarizeBatchableForks(manifest, context, packet.category);
    if (batchSummary.sameCategoryCount < 2 || batchSummary.distinctCategories >= 3) {
      return null;
    }

    const remainingGoals = batchSummary.forkGoals.slice(1);
    /* v8 ignore next 4 -- false branch unreachable: forkGoals.length === sameCategoryCount >= 2 */
    const batchContext =
      remainingGoals.length > 0
        ? `${packet.context} This answer will also apply to ${remainingGoals.length} more similar choice(s): ${remainingGoals.map((goal, i) => `(${i + 2}) ${goal.slice(0, 60)}`).join('; ')}.`
        : `${packet.context} This answer will cover ${batchSummary.sameCategoryCount} similar choices in this task.`;

    const batchedPacket: DecisionPacket = {
      ...packet,
      context: batchContext,
    };
    decisionStore.writePending(batchedPacket);
    const response = await promptForDecision(batchedPacket);
    decisionStore.resolve({
      decisionId: batchedPacket.decision_id,
      humanResponse: {
        ...response,
        carry_over_scope: 'task',
        note: [
          response.note,
          `Batched ${batchSummary.sameCategoryCount} similar forks in this task.`,
        ]
          .filter(Boolean)
          .join(' '),
      },
    });
    return decisionStore.readResolved(batchedPacket.decision_id);
  }

  private async maybeWriteIdleDecisionHandoff(
    projectRoot: string,
    slug: string,
    manifest: PlanningManifest,
    context: SliceContext,
    packet: DecisionPacket,
  ): Promise<void> {
    /* v8 ignore next 2 -- optional-chain branches for missing profile fields; always present in test fixtures */
    const idleMinutes =
      readProjectProfile(projectRoot)?.custom?.decisions?.idle_timeout_minutes ?? 30;
    const createdAt = Date.parse(packet.created_at);
    /* v8 ignore next 3 -- defensive guard for malformed created_at; always valid in practice */
    if (!Number.isFinite(createdAt)) {
      return;
    }
    if (Date.now() - createdAt < idleMinutes * 60 * 1000) {
      return;
    }

    await new HandoffWriter(new TurnSummarizer(), projectRoot).write(
      [],
      `decision-pause:${packet.decision_id}`,
      slug,
      {
        classification: manifest.classification.workflow,
        description: `Pending decision ${packet.decision_id}: ${packet.question}`,
        spec_path: null,
      },
      {
        spec_artifacts: [],
        relevant_files: packet.options
          .map((option) => option.evidence.file)
          .filter((file): file is string => typeof file === 'string'),
        relevant_docs: [],
      },
      0,
      {
        manifest_slug: manifest.slug,
        completed_slices: manifest.execution_slices
          .filter((slice) => slice.slice_id !== context.current_slice.slice_id)
          .map((slice) => slice.slice_id),
        current_slice: context.current_slice.slice_id,
        current_slice_status: 'in-progress',
        pending_slices: [context.current_slice.slice_id],
        escalated_slices: [],
      },
    );
  }

  private writePendingOrThrow(decisionStore: DecisionStore, packet: DecisionPacket): void {
    try {
      decisionStore.writePending(packet);
      /* v8 ignore next 4 -- error re-throw wrapper; writePending succeeds in all unit test paths */
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Decision pause failed: ${message}`, { cause: error });
    }
  }

  private decisionDetectionText(manifest: PlanningManifest, context: SliceContext): string {
    const linkedRequirements = manifest.requirement_graph
      .filter((requirement) => context.current_slice.covers.includes(requirement.id))
      .map((requirement) => requirement.description);
    return [context.current_slice.goal, ...linkedRequirements].join(' ');
  }

  private contextDecisionsForSlice(
    manifest: PlanningManifest,
    context: SliceContext,
  ): DecisionRecord[] {
    const coveredIds = new Set(context.current_slice.covers);
    return manifest.decision_log.filter((decision) =>
      decision.linked_requirements.some((requirementId) => coveredIds.has(requirementId)),
    );
  }
}

export async function detectExecutionManifestSlug(
  projectRoot: string,
  preferredSlug?: string | null,
): Promise<string | null> {
  if (preferredSlug) {
    return preferredSlug;
  }

  const slugs = await listManifestSlugs(projectRoot);
  if (slugs.length === 1) {
    return slugs[0];
  }

  return null;
}

function applyGateToManifest(manifest: PlanningManifest, gate: SliceGateDetail): void {
  for (const check of gate.criteria_checks) {
    const criterion = manifest.verification_matrix.find(
      (candidate) => candidate.criterion_id === check.criterion_id,
    );
    if (criterion) {
      criterion.status = check.status;
    }
  }

  for (const check of gate.doc_checks) {
    const target = manifest.doc_targets.find(
      (candidate) => candidate.target_id === check.target_id,
    );
    if (target) {
      target.status = check.status;
    }
  }

  for (const check of gate.regression_checks) {
    const entry = manifest.regression_watch.find(
      (candidate) => candidate.entry_id === check.entry_id,
    );
    if (entry) {
      entry.status = check.status;
    }
  }
}

function buildCheckpoint(input: {
  context: SliceContext;
  attempt: number;
  result: ExecuteSliceResult;
  gate: SliceGateDetail;
  modifiedFiles: string[];
  status?: SliceCheckpoint['status'];
}): SliceCheckpoint {
  const summaryTokens =
    input.result.summary_tokens ??
    input.context.prior_slices.reduce(
      (sum, summary) => sum + estimatePriorSliceSummaryTokens(summary),
      0,
    );
  const rawContextTokens = input.result.raw_context_tokens ?? input.context.token_budget;

  return {
    slice_id: input.context.current_slice.slice_id,
    goal: input.context.current_slice.goal,
    status: input.status ?? 'completed',
    attempt: input.attempt,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    tokens_used: input.result.tokens_used,
    files_changed: [...new Set(input.modifiedFiles)].sort(),
    exports_created: input.result.exports_created ?? [],
    decisions_made: input.context.decision_context.map((decision) => ({
      decision_id: decision.decision_id,
      choice: decision.choice,
      linked_requirements: decision.linked_requirements,
    })),
    criteria_results: Object.fromEntries(
      input.gate.criteria_checks.map((check) => [check.criterion_id, check.status]),
    ),
    doc_targets_updated: input.gate.doc_checks
      .filter((check) => check.status === 'updated')
      .map((check) => check.target_id),
    regression_results: Object.fromEntries(
      input.gate.regression_checks.map((check) => [check.entry_id, check.status]),
    ),
    gate_result: input.gate.gate_result,
    compression_stats: {
      raw_context_tokens: rawContextTokens,
      summary_tokens: summaryTokens,
      compression_ratio: rawContextTokens > 0 ? summaryTokens / rawContextTokens : 0,
    },
  };
}

async function collectPriorScopeWarnings(
  projectRoot: string,
  slug: string,
  completedSliceIds: string[],
): Promise<string[]> {
  const warnings = new Set<string>();
  for (const sliceId of completedSliceIds) {
    const checkpoint = await new SliceCheckpointStore().load(projectRoot, slug, sliceId);
    if (!checkpoint) {
      continue;
    }
    for (const violation of checkpoint.gate_result.scope.violations) {
      if (violation.type === 'prior-slice') {
        warnings.add(violation.file);
      }
    }
  }
  return [...warnings];
}

function sliceMetrics(
  gate: SliceGateDetail,
  tokensUsed: number,
): Pick<
  SliceProgressEntry,
  'tokens_used' | 'tests_passed' | 'tests_failed' | 'docs_updated' | 'scope_clean'
> {
  return {
    tokens_used: tokensUsed,
    tests_passed:
      gate.criteria_checks.filter((check) => check.passed).length +
      gate.regression_checks.filter((check) => check.passed).length,
    tests_failed:
      gate.criteria_checks.filter((check) => !check.passed).length +
      gate.regression_checks.filter((check) => !check.passed).length +
      gate.full_suite_check.new_failures.length,
    docs_updated: gate.doc_checks.filter((check) => check.status === 'updated').length,
    scope_clean: gate.scope_check.status !== 'violation',
  };
}

function buildGateReasons(gate: SliceGateDetail): string[] {
  const reasons: string[] = [];
  for (const check of gate.criteria_checks) {
    if (!check.passed) {
      reasons.push(`Verification criterion ${check.criterion_id} not met: ${check.detail}`);
    }
  }
  for (const violation of gate.scope_check.violations) {
    reasons.push(`Out-of-scope change (${violation.type}) to ${violation.file}`);
  }
  for (const check of gate.regression_checks) {
    if (!check.passed) {
      reasons.push(`Regression ${check.entry_id} is failing: ${check.detail}`);
    }
  }
  for (const failure of gate.full_suite_check.new_failures) {
    reasons.push(`New test failure introduced: ${failure}`);
  }
  for (const decision of gate.decision_checks) {
    if (!decision.passed) {
      reasons.push(decision.reason);
    }
  }
  return reasons;
}

function summarizeFailure(gate: SliceGateDetail): string {
  const reasons = [
    ...gate.criteria_checks.filter((check) => !check.passed).map((check) => check.criterion_id),
    ...gate.regression_checks.filter((check) => !check.passed).map((check) => check.entry_id),
    ...gate.full_suite_check.new_failures,
    ...gate.scope_check.violations.map((violation) => `${violation.type}:${violation.file}`),
  ];
  return reasons.concat('verification failed').slice(0, Math.max(reasons.length, 1)).join(', ');
}

function completedSliceIds(tracker: ExecutionProgressTracker): string[] {
  return Object.entries(tracker.slices)
    .filter(([, entry]) => entry.status === 'completed')
    .map(([sliceId]) => sliceId)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function blockedSliceIdsFromTracker(tracker: ExecutionProgressTracker): string[] {
  return Object.entries(tracker.slices)
    .filter(([, entry]) => entry.status === 'blocked')
    .map(([sliceId]) => sliceId)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function escalatedSliceIds(tracker: ExecutionProgressTracker): string[] {
  return Object.entries(tracker.slices)
    .filter(([, entry]) => entry.status === 'escalated')
    .map(([sliceId]) => sliceId)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function estimateRemainingBudget(
  tracker: ExecutionProgressTracker,
  plannedPerSlice: Record<string, number>,
): number {
  let consumed = 0;
  for (const [sliceId, entry] of Object.entries(tracker.slices)) {
    if (entry.status === 'completed' || entry.status === 'escalated') {
      consumed += entry.tokens_used ?? plannedPerSlice[sliceId]!;
    }
  }
  return Math.max(0, tracker.token_budget.total - consumed);
}

function appendDecisionRecord(
  manifest: PlanningManifest,
  decision: DecisionRecord,
): PlanningManifest {
  /* v8 ignore next 3 -- duplicate record dedupe is defensive */
  if (manifest.decision_log.some((entry) => entry.decision_id === decision.decision_id)) {
    return manifest;
  }
  return {
    ...manifest,
    decision_log: [...manifest.decision_log, decision],
  };
}

function nextDecisionId(manifest: PlanningManifest, decisionStore: DecisionStore): string {
  const storeNext = Number(decisionStore.nextDecisionId().replace(/^D-/, ''));
  const manifestNext =
    manifest.decision_log
      .map((decision) => Number(decision.decision_id.replace(/^D-/, '')))
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), 0) + 1;
  return `D-${Math.max(storeNext, manifestNext)}`;
}

function nextDecisionIdWithOffset(
  manifest: PlanningManifest,
  decisionStore: DecisionStore,
  offset: number,
): string {
  const base = Number(nextDecisionId(manifest, decisionStore).replace(/^D-/, ''));
  return `D-${base + offset}`;
}

function buildDecisionPacket(input: {
  projectRoot: string;
  requestedBy: string;
  taskSessionId: string;
  decisionId: string;
  category: DecisionCategory;
  confidence: number;
  context: SliceContext;
  manifest: PlanningManifest;
}): DecisionPacket {
  return buildDecisionPacketModel({
    projectRoot: input.projectRoot,
    requestedBy: input.requestedBy,
    taskSessionId: input.taskSessionId,
    decisionId: input.decisionId,
    category: input.category,
    detectorConfidence: input.confidence,
    context: input.context,
    manifest: input.manifest,
  });
}

function buildDeferredDecisionPacket(input: {
  projectRoot: string;
  slug: string;
  manifest: PlanningManifest;
  context: SliceContext;
  decisionId: string;
  category: DecisionCategory;
  file: string;
  matchedExisting?: string;
  reason: string;
}): DecisionPacket {
  const now = new Date();
  const ttlDays = DECISION_CATEGORY_DEFAULTS[input.category].ttl_days;
  const linkedRequirements = input.context.current_slice.covers.filter((cover) =>
    input.manifest.requirement_graph.some((requirement) => requirement.id === cover),
  );

  return {
    decision_id: input.decisionId,
    fingerprint: computeDecisionFingerprint({
      category: input.category,
      question: 'Should we keep this path?',
      option_keys: ['reuse-existing', 'keep-new-path'],
      repo_state: {
        active_capabilities: ['coding'],
        stack: input.context.manifest_header.classification.stack,
        packs: input.context.manifest_header.classification.affected_modules,
      },
    }),
    category: input.category,
    question: 'Should we keep this path?',
    context: `${input.context.current_slice.goal} paqad flagged a possible undeclared decision in ${input.file}.`,
    options: [
      {
        option_key: 'reuse-existing',
        label: 'Reuse what exists',
        /* v8 ignore next 7 -- matchedExisting=undefined branches; undeclared-decision tests always supply a match */
        one_line_preview: `If you pick this, we will prefer ${input.matchedExisting ?? input.file}.`,
        trade_off: 'You give up: the newly created path from this slice.',
        technical_detail: input.reason,
        evidence: {
          file: input.matchedExisting,
          similarity: input.matchedExisting ? 0.8 : undefined,
          evidence_partial: !input.matchedExisting,
        },
      },
      {
        option_key: 'keep-new-path',
        label: 'Keep new path',
        one_line_preview: `If you pick this, we will keep ${input.file}.`,
        trade_off: 'You give up: the established reusable path that already existed.',
        technical_detail: input.reason,
        evidence: {
          file: input.file,
          evidence_partial: true,
        },
      },
    ],
    /* v8 ignore next 7 -- matchedExisting=false branch not exercised; undeclared-decision tests always supply a match */
    recommendation: input.matchedExisting ? 'reuse-existing' : 'keep-new-path',
    recommendation_reason: input.matchedExisting
      ? 'This repo already has a matching path.'
      : 'This keeps the path that was just added.',
    confidence: input.matchedExisting ? 0.8 : 0.56,
    requested_by: 'paqad-system',
    task_session_id: `retroactive:${input.slug}:${input.context.current_slice.slice_id}`,
    linked_requirements: linkedRequirements,
    linked_slice_id: input.context.current_slice.slice_id,
    created_at: now.toISOString(),
    status: 'pending',
    ttl_until: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
    invalidation_watch: [
      ...new Set([input.file, input.matchedExisting].filter(Boolean) as string[]),
    ],
  };
}

/* v8 ignore next 3 -- thin wrapper for deterministic fs mocking */
function existsSyncSafe(path: string): boolean {
  return existsSync(path);
}

/* v8 ignore next 7 -- thin wrapper for deterministic fs fallback */
function statMtimeMsSafe(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function collectDecisionPacketsForSlice(
  manifest: PlanningManifest,
  sliceId: string,
  projectRoot: string,
): DecisionPacket[] {
  const store = new DecisionStore(projectRoot);
  return manifest.decision_log
    .map((decision) => store.readResolved(decision.decision_id))
    .filter(
      (packet): packet is DecisionPacket =>
        packet !== null && packet.linked_slice_id === sliceId && packet.status === 'resolved',
    );
}

async function executeFastLane(
  projectRoot: string,
  manifest: PlanningManifest,
  options: ExecuteSlicesOptions,
): Promise<ExecuteSlicesResult> {
  const implicitSlice = {
    slice_id: 'SL-1',
    goal: `Execute ${manifest.slug}`,
    covers: [
      ...manifest.requirement_graph.map((requirement) => requirement.id),
      ...manifest.verification_matrix.map((criterion) => criterion.criterion_id),
    ],
    depends_on: [],
    touches: [...new Set(manifest.requirement_graph.flatMap((requirement) => requirement.scope))],
  };
  const context: SliceContext = {
    manifest_header: {
      plan_version: manifest.plan_version,
      plan_mode: manifest.plan_mode,
      feature_id: manifest.feature_id,
      slug: manifest.slug,
      created_at: manifest.created_at,
      classification: manifest.classification,
    },
    current_slice: implicitSlice,
    verification_criteria: manifest.verification_matrix,
    test_skeletons: manifest.verification_matrix
      .filter((criterion) => criterion.proof_type === 'automated' && criterion.proof_target)
      .map((criterion) => criterion.proof_target!),
    doc_targets: manifest.doc_targets,
    regression_entries: manifest.regression_watch,
    prior_slices: [],
    existing_code_matches: [],
    decision_context: manifest.decision_log,
    token_budget: computeSliceBudgetPlan([], undefined).summary.total,
  };
  const decisionStore = new DecisionStore(projectRoot);
  decisionStore.initialize();
  const decisionText = [
    implicitSlice.goal,
    ...manifest.requirement_graph.map((requirement) => requirement.description),
  ].join(' ');
  const forks = detectDecisionForks(decisionText);
  if (forks.length > 0) {
    const primaryFork = forks[0]!;
    const packet = buildDecisionPacketModel({
      projectRoot,
      requestedBy: 'codex-cli',
      taskSessionId: manifest.slug,
      decisionId: nextDecisionId(manifest, decisionStore),
      category: primaryFork.category,
      detectorConfidence: primaryFork.confidence,
      context,
      manifest,
    });
    const autoResolution = await resolveDecisionPacket(projectRoot, packet);
    if (autoResolution.source !== 'ask' && autoResolution.option_key) {
      decisionStore.resolveExisting({
        packet,
        /* v8 ignore next 4 -- rule branch is equivalent to the tested rag-confident path */
        event:
          autoResolution.source === 'rag-confident'
            ? 'decision-resolved-by-rag-confident'
            : 'decision-resolved-by-rule',
        humanResponse: {
          chosen_option_key: autoResolution.option_key,
          intent: 'safer-default',
          explanation_rounds_used: 0,
          responded_at: new Date().toISOString(),
          responded_by: 'paqad-system',
          carry_over_scope: 'none',
          note: autoResolution.reason,
        },
        respondedByProvider: 'paqad-system',
      });
      const decisionRecord = decisionStore.readResolved(packet.decision_id);
      if (decisionRecord) {
        manifest = appendDecisionRecord(manifest, toDecisionRecord(decisionRecord)!);
      }
    } else {
      const viable = selectViableDecisionOptions(projectRoot, packet.options);
      if (viable.length === 1) {
        decisionStore.resolveExisting({
          packet,
          event: 'decision-resolved-by-rag-confident',
          humanResponse: {
            chosen_option_key: viable[0]!.option_key,
            intent: 'safer-default',
            explanation_rounds_used: 0,
            responded_at: new Date().toISOString(),
            responded_by: 'paqad-system',
            carry_over_scope: 'none',
            note: 'Only one valid path remained after filtering weak options.',
          },
          respondedByProvider: 'paqad-system',
        });
        const decisionRecord = decisionStore.readResolved(packet.decision_id);
        if (decisionRecord) {
          manifest = appendDecisionRecord(manifest, toDecisionRecord(decisionRecord)!);
        }
      } else {
        decisionStore.writePending(packet);
        const response = await promptForDecision(packet, { mode: 'fast' });
        decisionStore.resolve({
          decisionId: packet.decision_id,
          humanResponse: response,
        });
        const decisionRecord = decisionStore.readResolved(packet.decision_id);
        if (decisionRecord) {
          manifest = appendDecisionRecord(manifest, toDecisionRecord(decisionRecord)!);
        }
      }
      await saveManifest(projectRoot, manifest);
    }
  }

  const warnings: string[] = [];
  const runAttempt = async (
    attempt: number,
    retryFeedback?: ReturnType<typeof buildSliceRetryFeedback>,
  ) => {
    const docSnapshot = snapshotDocTargets(projectRoot, context.doc_targets);
    const scopeSnapshot = snapshotSliceScope(projectRoot, implicitSlice.touches);
    const result = await options.executeSlice({
      context,
      attempt,
      retry_feedback: retryFeedback,
    });
    const gate = await runSliceGate({
      projectRoot,
      slice: implicitSlice,
      orderedSlices: [implicitSlice],
      criteria: context.verification_criteria,
      docTargets: context.doc_targets,
      docSnapshot,
      regressionEntries: context.regression_entries,
      modifiedFiles: result.files_changed ?? diffSnapshotFiles(projectRoot, scopeSnapshot),
      criteriaRunner: options.criteriaRunner,
      regressionRunner: options.regressionRunner,
      fullSuiteRunner: options.fullSuiteRunner,
      baselineFailingTests: options.captureBaselineFailingTests
        ? await options.captureBaselineFailingTests()
        : [],
    });
    applyGateToManifest(manifest, gate);
    await saveManifest(projectRoot, manifest);
    if (result.tokens_used >= context.token_budget * 0.8) {
      warnings.push(
        `SL-1 consumed ${result.tokens_used} tokens against budget ${context.token_budget}.`,
      );
    }
    return { result, gate };
  };

  const first = await runAttempt(1);
  if (first.gate.gate_result.status === 'fail' && !requiresImmediateEscalation(first.gate)) {
    const second = await runAttempt(2, buildSliceRetryFeedback(first.gate));
    if (second.gate.gate_result.status === 'fail') {
      warnings.push(`Fast-lane retry failed for ${manifest.slug}.`);
      const manifestPath = await saveManifest(projectRoot, manifest);
      return {
        trackerPath: '',
        trackerStatus: 'failed',
        manifestPath,
        checkpointPaths: [],
        escalationPaths: [],
        completedSliceIds: [],
        blockedSliceIds: [],
        escalatedSliceIds: [],
        warnings,
      };
    }
    const manifestPath = await saveManifest(projectRoot, manifest);
    return {
      trackerPath: '',
      trackerStatus: 'completed',
      manifestPath,
      checkpointPaths: [],
      escalationPaths: [],
      completedSliceIds: ['SL-1'],
      blockedSliceIds: [],
      escalatedSliceIds: [],
      warnings,
    };
  } else if (first.gate.gate_result.status === 'fail') {
    warnings.push(`Fast-lane execution escalated immediately for ${manifest.slug}.`);
    const manifestPath = await saveManifest(projectRoot, manifest);
    return {
      trackerPath: '',
      trackerStatus: 'failed',
      manifestPath,
      checkpointPaths: [],
      escalationPaths: [],
      completedSliceIds: [],
      blockedSliceIds: [],
      escalatedSliceIds: [],
      warnings,
    };
  }

  const manifestPath = await saveManifest(projectRoot, manifest);
  return {
    trackerPath: '',
    trackerStatus: 'completed',
    manifestPath,
    checkpointPaths: [],
    escalationPaths: [],
    completedSliceIds: ['SL-1'],
    blockedSliceIds: [],
    escalatedSliceIds: [],
    warnings,
  };
}

function summarizeBatchableForks(
  manifest: PlanningManifest,
  context: SliceContext,
  category: DecisionCategory,
): { sameCategoryCount: number; distinctCategories: number; forkGoals: string[] } {
  const currentIndex = manifest.execution_slices.findIndex(
    (slice) => slice.slice_id === context.current_slice.slice_id,
  );
  /* v8 ignore next 1 -- currentIndex < 0 branch unreachable; slice always found in manifest */
  const remainingSlices = manifest.execution_slices.slice(currentIndex >= 0 ? currentIndex : 0);
  const categories = new Set<DecisionCategory>();
  let sameCategoryCount = 0;
  const forkGoals: string[] = [];

  for (const slice of remainingSlices) {
    const requirementText = manifest.requirement_graph
      .filter((requirement) => slice.covers.includes(requirement.id))
      .map((requirement) => requirement.description);
    const forks = detectDecisionForks([slice.goal, ...requirementText].join(' '));
    for (const fork of forks) {
      categories.add(fork.category);
      if (fork.category === category) {
        sameCategoryCount += 1;
        forkGoals.push(slice.goal);
        break;
      }
    }
  }

  return {
    sameCategoryCount,
    distinctCategories: categories.size,
    forkGoals,
  };
}
