import type { ReviewKindId } from './kinds.js';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const PROOFS = ['confirmed', 'lead'] as const;
export const SERIOUS: ReadonlySet<Severity> = new Set(['critical', 'high']);

export type Severity = (typeof SEVERITIES)[number];
export type Proof = (typeof PROOFS)[number];
export type ReviewRunStatus = 'running' | 'stopped' | 'finished' | 'abandoned';
export type ReviewStageStatus = 'todo' | 'running' | 'done' | 'skipped' | 'gap';

export interface ReviewStageRecord {
  status: ReviewStageStatus;
  started_at: string | null;
  ended_at: string | null;
}

export interface ReviewFinding {
  severity: Severity;
  proof: Proof;
  id: string | null;
  at: string;
}

export interface ReviewGap {
  code: string;
  stage: string;
  say: string;
  at: string;
}

export interface ReviewRun {
  schema_version: 1;
  kind: ReviewKindId;
  run_id: string;
  revision: number;
  status: ReviewRunStatus;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  current_stage: string | null;
  stopped: { stage: string; was_running: boolean } | null;
  stages: Record<string, ReviewStageRecord>;
  findings: ReviewFinding[];
  gaps: ReviewGap[];
}

export const OPEN_STATUSES: ReadonlySet<ReviewRunStatus> = new Set(['running', 'stopped']);
