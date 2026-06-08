// Issue #110 — quality-ratchet orchestration.
//
// Ties the pieces together: read the baseline → collect the four measures →
// compare (the ratchet) → reuse/raise a `quality.ratchet_exception` pause for
// any worsening → tighten and persist the baseline on a clean run. Never throws:
// like the mutation gate, any inability to run is recorded as a skipped/blocked
// result so the gate decides what to do, not the orchestration.
//
// Persistence rule: the baseline is written only when the run does NOT block —
// it tightens to the new minimums (and lifts only the measures whose worsening
// was approved). A blocked (regressed) run never writes, so a refused change can
// never quietly move the recorded level.

import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { Lane } from '@/core/types/routing.js';
import type { QualityRatchetResult, RatchetMeasureVerdict } from '@/core/types/quality-ratchet.js';
import type { DecisionStore } from '@/planning/decision-store.js';

import {
  applyApprovedRegressions,
  createBaseline,
  readQualityBaseline,
  tightenBaseline,
  writeQualityBaseline,
} from './baseline.js';
import { collectQualityMeasures, type QualityCollectorDeps } from './collector.js';
import { evaluateRatchet } from './ratchet.js';
import {
  buildRatchetExceptionPacket,
  resolveReusableExceptionKinds,
  type RatchetExceptionInput,
} from './exception-decision.js';

export interface RunQualityRatchetOptions {
  projectRoot: string;
  changedFiles: string[];
  lane: Lane;
  stackProfile: DetectedStackProfile | null;
  /** Orphan files from #109's reachability solver; null → dead_code blocked. */
  deadCodeFiles: string[] | null;
  deps?: QualityCollectorDeps;
  now?: () => string;
  /** When set, blocking regressions reuse prior approvals and raise a pause. */
  decisionStore?: DecisionStore;
  taskSessionId?: string;
  /** Persist baseline tighten/capture. Tests pass false to avoid disk writes. */
  writeBaseline?: boolean;
}

export async function runQualityRatchetGate(
  options: RunQualityRatchetOptions,
): Promise<QualityRatchetResult> {
  const now = (options.now ?? (() => new Date().toISOString()))();

  const baseline = await readQualityBaseline(options.projectRoot);
  const current = await collectQualityMeasures({
    projectRoot: options.projectRoot,
    changedFiles: options.changedFiles,
    lane: options.lane,
    stackProfile: options.stackProfile,
    deadCodeFiles: options.deadCodeFiles,
    deps: options.deps,
  });

  // First run: capture today's reality and pass.
  if (baseline === null) {
    const result = evaluateRatchet({ baseline: null, current, lane: options.lane });
    if (options.writeBaseline !== false) {
      await writeQualityBaseline(options.projectRoot, createBaseline(current, now));
    }
    return result;
  }

  // Compare. First pass with no approvals to learn which kinds worsened.
  let result = evaluateRatchet({ baseline, current, lane: options.lane });

  if (result.blocking_regressions.length > 0 && options.decisionStore) {
    const store = options.decisionStore;
    const lookupTask = options.taskSessionId ?? 'quality-ratchet-lookup';
    const candidateKinds = result.blocking_regressions.map((r) => r.kind);

    // Reuse any prior approval by kind (emits `decision-reused`; no re-ask).
    const approved = resolveReusableExceptionKinds(store, candidateKinds, (kind) =>
      buildRatchetExceptionPacket(
        exceptionInput('D-0', kind, result.blocking_regressions, lookupTask, now),
      ),
    );

    if (approved.size > 0) {
      result = evaluateRatchet({
        baseline,
        current,
        lane: options.lane,
        approvedExceptionKinds: approved,
      });
    }

    // Raise a pause for each still-blocking kind, so the worsening is deliberate
    // and visible rather than a silent block. Needs a real task id; best-effort
    // (a pending decision may already exist for the task).
    if (options.taskSessionId) {
      raisePendingExceptions(store, result.blocking_regressions, options.taskSessionId, now);
    }
  }

  // Persist only when the run does not block (refused changes never move the line).
  if (options.writeBaseline !== false && result.status !== 'regressed') {
    let next = tightenBaseline(baseline, current, now);
    if (result.excepted_regressions.length > 0) {
      const approvedSamples = result.excepted_regressions.map((r) => ({
        measure: r.measure,
        module: r.module,
        value: r.current_value,
        confidence: r.confidence,
        tool: null,
        blocked_reason: null,
      }));
      next = applyApprovedRegressions(next, approvedSamples, now);
    }
    await writeQualityBaseline(options.projectRoot, next);
  }

  return result;
}

function exceptionInput(
  decisionId: string,
  kind: string,
  regressions: RatchetMeasureVerdict[],
  taskSessionId: string,
  now: string,
): RatchetExceptionInput {
  const sample = regressions.find((r) => r.kind === kind) ?? regressions[0]!;
  return {
    decision_id: decisionId,
    kind,
    measure: sample.measure,
    module: sample.module,
    baseline_value: sample.baseline_value,
    current_value: sample.current_value,
    task_session_id: taskSessionId,
    created_at: now,
  };
}

function raisePendingExceptions(
  store: DecisionStore,
  blocking: RatchetMeasureVerdict[],
  taskSessionId: string,
  now: string,
): void {
  const kinds = new Set(blocking.map((r) => r.kind));
  for (const kind of kinds) {
    try {
      const decisionId = store.nextDecisionId();
      const packet = buildRatchetExceptionPacket(
        exceptionInput(decisionId, kind, blocking, taskSessionId, now),
      );
      store.writePending(packet);
    } catch {
      // A pending decision may already exist for this task, or the kind was
      // already raised — the gate still blocks, so this is best-effort only.
    }
  }
}
