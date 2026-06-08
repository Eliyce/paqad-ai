import type { PhaseExecutor } from './phase.interface.js';
import type { PhaseResult, PipelineRunContext } from '@/core/types/pipeline.js';
import type { DoneInput } from '@/core/types/feature-spec.js';
import type { BuildCheckFixStuckReport } from '@/core/types/build-check-fix.js';
import { runBuildCheckFixLoop, type RoundCheck } from '@/loop/build-check-fix-loop.js';
import {
  BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH,
  buildRoundsLog,
  writeBuildCheckFixRoundsLog,
} from '@/loop/rounds-log.js';

const EVIDENCE_EXCERPT_BUDGET = 600;

/**
 * Issue #108 — wraps the single verification pass in the bounded, quiet
 * build-check-fix loop. Each call to the inner phase is one round's "check";
 * the loop owns the round count, futility detection, and the stop decision.
 *
 * Quiet by default: when the work converges (round 1 in the common case) this
 * is transparent — it returns the inner phase's pass result and trivial work
 * never feels the loop machinery. When the work stays unclean to the lane's
 * `max_rounds` (or futility) the loop emits exactly ONE honest "stuck" report
 * via the `stop` escalation, and the round-by-round record is persisted to
 * `.paqad/session/build-check-fix-rounds.json` for the agent's own use.
 *
 * The done condition is #102's `isDone()` (verification gates as the proven
 * criterion at this layer), and the loop construct stays the only place rounds
 * live — it does not re-implement triage (#107) or the prove-it protocol (#103).
 */
export class VerificationLoopPhase implements PhaseExecutor {
  readonly phase = 'verification-gates' as const;

  constructor(
    private readonly inner: PhaseExecutor,
    private readonly options: { now?: () => string; futilityThreshold?: number } = {},
  ) {}

  async execute(context: PipelineRunContext): Promise<PhaseResult> {
    const now = this.options.now ?? (() => new Date().toISOString());
    const override = context.feature_policy?.rounds?.[context.lane];

    let lastInnerResult: PhaseResult | null = null;

    const outcome = await runBuildCheckFixLoop({
      lane: context.lane,
      max_rounds: override ?? null,
      futility_threshold: this.options.futilityThreshold,
      now,
      runRound: async (): Promise<RoundCheck> => {
        const result = await this.inner.execute(context);
        lastInnerResult = result;
        const gatesPassed = result.status === 'pass';
        const blockingGates = collectBlockingGates(context, gatesPassed);
        const doneInput: DoneInput = {
          gates_passed: gatesPassed,
          // At this layer the verification gates ARE the proven criterion; the
          // full per-AC proof set is #102's spec layer (out of scope here).
          acceptance_criteria: [{ criterion_id: 'verification-gates', proof_passing: gatesPassed }],
          findings: [],
        };
        return {
          done_input: doneInput,
          blocking_gates: blockingGates,
          evidence_excerpt: gatesPassed ? null : truncate(result.summary, EVIDENCE_EXCERPT_BUDGET),
        };
      },
    });

    await this.persistRoundsLog(context.project_root, outcome, now());

    if (outcome.status === 'done' && lastInnerResult) {
      // Transparent: hand back the inner pass result unchanged.
      return lastInnerResult;
    }

    // Stopped unclean: the single honest "stuck" report, surfaced once via the
    // `stop` escalation. Intermediate rounds stay in the internal log only.
    return {
      phase: this.phase,
      status: 'fail',
      summary: renderStuckReport(outcome.stuck_report),
      artifacts: [`handoff:${context.phases.length + 1}`, BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH],
    };
  }

  private async persistRoundsLog(
    projectRoot: string,
    outcome: Awaited<ReturnType<typeof runBuildCheckFixLoop>>,
    updatedAt: string,
  ): Promise<void> {
    try {
      await writeBuildCheckFixRoundsLog(buildRoundsLog(outcome, updatedAt), {
        project_root: projectRoot,
      });
    } catch (error) {
      // The rounds log is an internal side-channel artifact; never fail the
      // verification phase because of an I/O issue here.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`paqad: could not write build-check-fix-rounds.json (${message})`);
    }
  }
}

function collectBlockingGates(context: PipelineRunContext, gatesPassed: boolean): string[] {
  if (gatesPassed) {
    return [];
  }
  const failing = (context.verification_results ?? [])
    .filter((result) => !result.passed)
    .map((result) => result.gate);
  return failing.length > 0 ? failing : ['verification-gates'];
}

function renderStuckReport(report: BuildCheckFixStuckReport | null): string {
  if (report === null) {
    return 'stop: the build-check-fix loop stopped without a clean result.';
  }

  const limit =
    report.reason === 'stopped-futility'
      ? `no net progress across rounds (stopped early after ${report.rounds_used})`
      : `reached the ${report.max_rounds}-round limit (used ${report.rounds_used})`;

  const fragments: string[] = [];
  if (report.blocking_gates.length > 0) {
    fragments.push(`failing gate(s): ${report.blocking_gates.join(', ')}`);
  }
  if (report.blocking_criteria.length > 0) {
    fragments.push(`failing AC: ${report.blocking_criteria.join(', ')}`);
  }
  if (report.blocking_findings.length > 0) {
    fragments.push(`blocking finding(s): ${report.blocking_findings.join(', ')}`);
  }
  const where = fragments.length > 0 ? fragments.join('; ') : 'verification still failing';
  const evidence = report.evidence_excerpt ? ` Last evidence: ${report.evidence_excerpt}` : '';
  const decisions =
    report.decisions_needed.length > 0
      ? ` Needs a human decision: ${report.decisions_needed.join(' ')}`
      : '';

  return `stop: I couldn't get this fully clean — ${limit}. Where it stands: ${where}.${evidence}${decisions}`;
}

function truncate(value: string, budget: number): string {
  return value.length <= budget ? value : value.slice(0, budget);
}
