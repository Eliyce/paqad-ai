import type { Lane } from './routing.js';

export const BUILD_CHECK_FIX_ROUNDS_SCHEMA_VERSION = '1.0.0';

export const DEFAULT_MAX_ROUNDS_BY_LANE: Record<Lane, number> = {
  fast: 2,
  graduated: 3,
  full: 5,
};

export const DEFAULT_FUTILITY_THRESHOLD = 2;

export type BuildCheckFixStatus = 'done' | 'stopped-at-cap' | 'stopped-futility';

export interface BuildCheckFixRound {
  round_number: number;
  started_at: string;
  completed_at: string;
  done: boolean;
  gates_passed: boolean;
  blocking_gates: string[];
  failing_criteria: string[];
  blocking_findings: string[];
  progress_signature: string | null;
  evidence_excerpt: string | null;
}

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
  stuck_report: BuildCheckFixStuckReport | null;
}

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
