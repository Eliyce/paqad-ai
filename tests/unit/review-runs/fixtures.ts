import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { join } from 'pathe';

import { REVIEW_KINDS } from '@/review-runs/kinds.js';
import type { ReviewRun, ReviewStageRecord } from '@/review-runs/types.js';

export const T0 = '2026-03-01T10:00:00.000Z';

export function at(minutes: number): string {
  return new Date(Date.parse(T0) + minutes * 60_000).toISOString();
}

export function clockAt(minutes: number): () => Date {
  return () => new Date(at(minutes));
}

export function tempRoot(prefix = 'paqad-review-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export const SECURITY = REVIEW_KINDS.security;
export const DESIGN = REVIEW_KINDS.design;

export function reviewRun(
  overrides: Partial<ReviewRun> & { states?: Record<string, ReviewStageRecord['status']> } = {},
): ReviewRun {
  const { states = {}, ...rest } = overrides;
  const kind = REVIEW_KINDS[rest.kind ?? 'security'];
  const stages = Object.fromEntries(
    kind.stages.map((stage) => [
      stage.id,
      {
        status: states[stage.id] ?? 'todo',
        started_at: states[stage.id] && states[stage.id] !== 'todo' ? at(0) : null,
        ended_at: null,
      },
    ]),
  );
  return {
    schema_version: 1,
    kind: kind.id,
    run_id: `${kind.id}-run`,
    revision: 1,
    status: 'running',
    started_at: at(0),
    updated_at: at(0),
    finished_at: null,
    current_stage: null,
    stopped: null,
    stages,
    findings: [],
    gaps: [],
    ...rest,
  };
}
