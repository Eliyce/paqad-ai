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
  deadCodeFiles: string[] | null;
  deps?: QualityCollectorDeps;
  now?: () => string;
  decisionStore?: DecisionStore;
  taskSessionId?: string;
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

  if (baseline === null) {
    const result = evaluateRatchet({ baseline: null, current, lane: options.lane });
    if (options.writeBaseline !== false) {
      await writeQualityBaseline(options.projectRoot, createBaseline(current, now));
    }
    return result;
  }

  let result = evaluateRatchet({ baseline, current, lane: options.lane });

  if (result.blocking_regressions.length > 0 && options.decisionStore) {
    const store = options.decisionStore;
    const lookupTask = options.taskSessionId ?? 'quality-ratchet-lookup';
    const candidateKinds = result.blocking_regressions.map((r) => r.kind);

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

    if (options.taskSessionId) {
      raisePendingExceptions(store, result.blocking_regressions, options.taskSessionId, now);
    }
  }

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
    } catch {}
  }
}
