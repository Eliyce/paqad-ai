import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type {
  ExecutionProgressTracker,
  ExecutionSlice,
  PlanningManifest,
  SliceExecutionStatus,
  SliceProgressEntry,
} from '@/core/types/planning.js';

import { computeSliceBudgetPlan } from './slice-budget.js';

export class ExecutionTracker {
  async load(projectRoot: string, slug: string): Promise<ExecutionProgressTracker | null> {
    const target = executionTrackerPath(projectRoot, slug);
    if (!existsSync(target)) {
      return null;
    }

    try {
      return JSON.parse(await readFile(target, 'utf8')) as ExecutionProgressTracker;
    } catch {
      return null;
    }
  }

  async initialize(
    projectRoot: string,
    manifest: PlanningManifest,
    totalBudget?: number,
  ): Promise<ExecutionProgressTracker> {
    const existing = await this.load(projectRoot, manifest.slug);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const slices = toTrackedSlices(manifest.execution_slices);
    const budget = computeSliceBudgetPlan(manifest.execution_slices, totalBudget);
    const tracker: ExecutionProgressTracker = {
      slug: manifest.slug,
      started_at: now,
      updated_at: now,
      total_slices: manifest.execution_slices.length,
      status: manifest.execution_slices.length === 0 ? 'completed' : 'not-started',
      slices,
      token_budget: budget.summary,
    };

    await this.save(projectRoot, tracker);
    return tracker;
  }

  async save(projectRoot: string, tracker: ExecutionProgressTracker): Promise<string> {
    const target = executionTrackerPath(projectRoot, tracker.slug);
    tracker.updated_at = new Date().toISOString();
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(tracker, null, 2)}\n`, 'utf8');
    return target;
  }

  markSliceStatus(
    tracker: ExecutionProgressTracker,
    sliceId: string,
    status: SliceExecutionStatus,
    attempt = 1,
  ): void {
    const entry = tracker.slices[sliceId];
    if (!entry) {
      throw new Error(`Unknown slice progress entry: ${sliceId}`);
    }

    const now = new Date().toISOString();
    entry.status = status;
    entry.attempt = attempt;
    if (status === 'in-progress') {
      entry.started_at = now;
      tracker.status = 'in-progress';
    }
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'escalated' ||
      status === 'blocked'
    ) {
      entry.completed_at = now;
    }

    tracker.status = deriveTrackerStatus(tracker);
  }

  applySliceMetrics(
    tracker: ExecutionProgressTracker,
    sliceId: string,
    metrics: Pick<
      SliceProgressEntry,
      'tokens_used' | 'tests_passed' | 'tests_failed' | 'docs_updated' | 'scope_clean'
    >,
  ): void {
    const entry = tracker.slices[sliceId];
    if (!entry) {
      throw new Error(`Unknown slice progress entry: ${sliceId}`);
    }

    entry.tokens_used = metrics.tokens_used;
    entry.tests_passed = metrics.tests_passed;
    entry.tests_failed = metrics.tests_failed;
    entry.docs_updated = metrics.docs_updated;
    entry.scope_clean = metrics.scope_clean;

    const consumed = Object.values(tracker.slices).reduce(
      (sum, slice) => sum + (slice.tokens_used ?? 0),
      0,
    );
    tracker.token_budget.consumed = consumed;
    tracker.token_budget.remaining = Math.max(0, tracker.token_budget.total - consumed);
  }

  resetSlices(tracker: ExecutionProgressTracker, sliceIds: string[]): void {
    for (const sliceId of sliceIds) {
      const entry = tracker.slices[sliceId];
      if (!entry) {
        continue;
      }

      entry.status = 'pending';
      entry.started_at = null;
      entry.completed_at = null;
      entry.attempt = 0;
      entry.tokens_used = null;
      entry.tests_passed = null;
      entry.tests_failed = null;
      entry.docs_updated = null;
      entry.scope_clean = null;
    }

    const consumed = Object.values(tracker.slices).reduce(
      (sum, slice) => sum + (slice.tokens_used ?? 0),
      0,
    );
    tracker.token_budget.consumed = consumed;
    tracker.token_budget.remaining = Math.max(0, tracker.token_budget.total - consumed);
    tracker.status = deriveTrackerStatus(tracker);
  }
}

export function executionTrackerPath(projectRoot: string, slug: string): string {
  return join(projectRoot, PATHS.PLANNING_SPECS_DIR, `${slug}.execution.json`);
}

function toTrackedSlices(slices: ExecutionSlice[]): ExecutionProgressTracker['slices'] {
  return Object.fromEntries(
    slices.map((slice) => [
      slice.slice_id,
      {
        status: 'pending',
        started_at: null,
        completed_at: null,
        attempt: 0,
        tokens_used: null,
        tests_passed: null,
        tests_failed: null,
        docs_updated: null,
        scope_clean: null,
      },
    ]),
  );
}

function deriveTrackerStatus(
  tracker: ExecutionProgressTracker,
): ExecutionProgressTracker['status'] {
  const entries = Object.values(tracker.slices);
  if (entries.every((entry) => entry.status === 'completed')) {
    return 'completed';
  }
  if (entries.some((entry) => entry.status === 'escalated')) {
    return entries.some((entry) => entry.status === 'completed') ? 'partial' : 'failed';
  }
  if (entries.some((entry) => entry.status === 'in-progress')) {
    return 'in-progress';
  }
  if (entries.some((entry) => entry.status === 'failed' || entry.status === 'completed')) {
    return 'in-progress';
  }
  return 'not-started';
}
