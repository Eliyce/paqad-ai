import { isDone } from '@/spec/definition-of-done.js';
import type { DoneInput } from '@/core/types/feature-spec.js';
import type { Lane } from '@/core/types/routing.js';
import {
  DEFAULT_FUTILITY_THRESHOLD,
  DEFAULT_MAX_ROUNDS_BY_LANE,
  type BuildCheckFixOutcome,
  type BuildCheckFixRound,
  type BuildCheckFixStatus,
  type BuildCheckFixStuckReport,
} from '@/core/types/build-check-fix.js';

export interface RoundCheck {
  done_input: DoneInput;
  blocking_gates: string[];
  evidence_excerpt: string | null;
}

export interface RunBuildCheckFixLoopInput {
  lane: Lane;
  max_rounds?: number | null;
  futility_threshold?: number;
  now: () => string;
  runRound: (roundNumber: number) => Promise<RoundCheck>;
  remediate?: (round: BuildCheckFixRound) => Promise<void>;
}

export function resolveMaxRounds(lane: Lane, override?: number | null): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 1) {
    return Math.floor(override);
  }
  return DEFAULT_MAX_ROUNDS_BY_LANE[lane];
}

export async function runBuildCheckFixLoop(
  input: RunBuildCheckFixLoopInput,
): Promise<BuildCheckFixOutcome> {
  const maxRounds = resolveMaxRounds(input.lane, input.max_rounds);
  const futilityThreshold =
    typeof input.futility_threshold === 'number' && input.futility_threshold >= 1
      ? Math.floor(input.futility_threshold)
      : DEFAULT_FUTILITY_THRESHOLD;
  const rounds: BuildCheckFixRound[] = [];

  let lastSignature: string | null = null;
  let consecutiveNoProgress = 0;

  const finalize = (
    status: BuildCheckFixStatus,
    last: BuildCheckFixRound,
  ): BuildCheckFixOutcome => ({
    status,
    lane: input.lane,
    max_rounds: maxRounds,
    rounds_used: rounds.length,
    rounds,
    stuck_report:
      status === 'done' ? null : buildStuckReport(status, rounds.length, maxRounds, last),
  });

  for (let roundNumber = 1; roundNumber <= maxRounds; roundNumber += 1) {
    const startedAt = input.now();
    const check = await input.runRound(roundNumber);
    const doneResult = isDone(check.done_input);
    const completedAt = input.now();

    const signature = doneResult.done
      ? null
      : progressSignature(
          doneResult.failing_criteria,
          doneResult.blocking_findings,
          check.blocking_gates,
        );

    const round: BuildCheckFixRound = {
      round_number: roundNumber,
      started_at: startedAt,
      completed_at: completedAt,
      done: doneResult.done,
      gates_passed: doneResult.gates_passed,
      blocking_gates: [...check.blocking_gates],
      failing_criteria: doneResult.failing_criteria,
      blocking_findings: doneResult.blocking_findings,
      progress_signature: signature,
      evidence_excerpt: check.evidence_excerpt,
    };
    rounds.push(round);

    if (doneResult.done) {
      return finalize('done', round);
    }

    if (signature !== null && signature === lastSignature) {
      consecutiveNoProgress += 1;
    } else {
      consecutiveNoProgress = 1;
      lastSignature = signature;
    }

    if (consecutiveNoProgress >= futilityThreshold) {
      return finalize('stopped-futility', round);
    }

    if (roundNumber >= maxRounds) {
      return finalize('stopped-at-cap', round);
    }

    if (input.remediate) {
      await input.remediate(round);
    }
  }

  const last = rounds[rounds.length - 1];
  return finalize('stopped-at-cap', last ?? emptyRound(input.now()));
}

function progressSignature(
  failingCriteria: string[],
  blockingFindings: string[],
  blockingGates: string[],
): string | null {
  const parts = [
    ...failingCriteria.map((id) => `ac:${id}`),
    ...blockingFindings.map((id) => `finding:${id}`),
    ...blockingGates.map((gate) => `gate:${gate}`),
  ].sort();
  return parts.length > 0 ? parts.join('|') : null;
}

function buildStuckReport(
  reason: 'stopped-at-cap' | 'stopped-futility',
  roundsUsed: number,
  maxRounds: number,
  last: BuildCheckFixRound,
): BuildCheckFixStuckReport {
  return {
    reason,
    rounds_used: roundsUsed,
    max_rounds: maxRounds,
    blocking_gates: [...last.blocking_gates],
    blocking_criteria: [...last.failing_criteria],
    blocking_findings: [...last.blocking_findings],
    evidence_excerpt: last.evidence_excerpt,
    decisions_needed: deriveDecisions(last),
  };
}

function deriveDecisions(last: BuildCheckFixRound): string[] {
  const decisions: string[] = [];
  if (last.failing_criteria.length > 0) {
    decisions.push(
      `Decide whether acceptance criterion ${last.failing_criteria[0]} is correct or needs a spec change.`,
    );
  }
  if (last.blocking_findings.length > 0) {
    decisions.push(`Confirm or reclassify blocking finding ${last.blocking_findings[0]}.`);
  }
  if (decisions.length === 0 && last.blocking_gates.length > 0) {
    decisions.push(`Investigate why the ${last.blocking_gates[0]} gate keeps failing.`);
  }
  return decisions.slice(0, 2);
}

function emptyRound(now: string): BuildCheckFixRound {
  return {
    round_number: 0,
    started_at: now,
    completed_at: now,
    done: false,
    gates_passed: false,
    blocking_gates: [],
    failing_criteria: [],
    blocking_findings: [],
    progress_signature: null,
    evidence_excerpt: null,
  };
}
