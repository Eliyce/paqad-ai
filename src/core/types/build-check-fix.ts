import type { Lane } from './routing.js';

// Issue #108 — the bounded, quiet build-check-fix loop. These types are the
// internal record the loop keeps for its own stop decision and for debugging;
// they are never surfaced round-by-round to the person.

export const BUILD_CHECK_FIX_ROUNDS_SCHEMA_VERSION = '1.0.0';

/**
 * Lane-scaled default round caps (open decision #1 — taking the issue's
 * recommendation: `fast` lowest, `full` highest). Project-tunable via the
 * `rounds:` block in `.paqad/workflows/feature-development.yaml`.
 */
export const DEFAULT_MAX_ROUNDS_BY_LANE: Record<Lane, number> = {
  fast: 2,
  graduated: 3,
  full: 5,
};

/**
 * How many consecutive no-progress rounds (the same failing set) trip futility
 * detection (open decision #2 — start with no-progress + same-failing-set;
 * richer oscillation detection can come later).
 */
export const DEFAULT_FUTILITY_THRESHOLD = 2;

/** Why the loop stopped. */
export type BuildCheckFixStatus =
  | 'done' // isDone() satisfied — success
  | 'stopped-at-cap' // ran the lane's max_rounds without converging
  | 'stopped-futility'; // no net progress across K rounds — stopped early

/** One round's internal record (kept for the agent, never surfaced). */
export interface BuildCheckFixRound {
  round_number: number;
  started_at: string;
  completed_at: string;
  done: boolean;
  gates_passed: boolean;
  blocking_gates: string[];
  failing_criteria: string[];
  blocking_findings: string[];
  /** Stable signature of the failing set; null when the round was done. */
  progress_signature: string | null;
  /** Short evidence excerpt (last failing detail) for the stuck report. */
  evidence_excerpt: string | null;
}

/**
 * The single honest "I couldn't get this fully clean" report. Produced exactly
 * once, only when the loop stops unclean (cap or futility). Open decision #4:
 * it carries the blocking gate/AC, the last evidence, rounds used, and the one
 * or two things a human must decide.
 */
export interface BuildCheckFixStuckReport {
  reason: 'stopped-at-cap' | 'stopped-futility';
  rounds_used: number;
  max_rounds: number;
  blocking_gates: string[];
  blocking_criteria: string[];
  blocking_findings: string[];
  evidence_excerpt: string | null;
  decisions_needed: string[];
}

export interface BuildCheckFixOutcome {
  status: BuildCheckFixStatus;
  lane: Lane;
  max_rounds: number;
  rounds_used: number;
  rounds: BuildCheckFixRound[];
  /** Present only when status !== 'done'. Exactly one report. */
  stuck_report: BuildCheckFixStuckReport | null;
}

/**
 * The persisted internal rounds log — extends the per-round verification
 * evidence into a feature-level record at
 * `.paqad/session/build-check-fix-rounds.json`. For the agent's own use and
 * debugging; never shown round-by-round.
 */
export interface BuildCheckFixRoundsLog {
  schema_version: typeof BUILD_CHECK_FIX_ROUNDS_SCHEMA_VERSION;
  lane: Lane;
  status: BuildCheckFixStatus;
  max_rounds: number;
  rounds_used: number;
  updated_at: string;
  rounds: BuildCheckFixRound[];
  stuck_report: BuildCheckFixStuckReport | null;
}
