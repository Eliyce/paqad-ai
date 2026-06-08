import type { ParallelGroup, WorkflowStep } from './types.js';
import type { WorkflowStepRunner } from './step-executor.js';

export interface ParallelResult {
  results: Array<{ skill: string; status: 'completed' | 'skipped' | 'failed'; error?: string }>;
  overall: 'completed' | 'failed' | 'skipped' | 'cancelled';
}

const ABORTED = Symbol('aborted');

export class ParallelExecutor {
  constructor(private readonly stepExecutor: WorkflowStepRunner) {}

  async execute(group: ParallelGroup, signal?: AbortSignal): Promise<ParallelResult> {
    // Pre-flight: if the consumer already aborted, start no branches (PQD-104).
    if (signal?.aborted) {
      return { results: [], overall: 'cancelled' };
    }

    const onFailure = group.on_failure ?? 'abort';
    const raced = await this.raceAgainstAbort(this.executeGroup(group.parallel, signal), signal);
    if (raced === ABORTED) {
      return { results: [], overall: 'cancelled' };
    }
    let results = raced;

    if (results.some((result) => result.status === 'failed')) {
      if (onFailure === 'retry') {
        const retrySteps = group.parallel.filter((_, index) => results[index]?.status === 'failed');
        const retried = await this.executeGroup(retrySteps, signal);
        let retryIndex = 0;
        results = results.map((result) =>
          result.status === 'failed' ? (retried[retryIndex++] ?? result) : result,
        );
      }

      if (signal?.aborted) {
        return { results, overall: 'cancelled' };
      }

      if (results.some((result) => result.status === 'failed')) {
        if (onFailure === 'skip') {
          return { results, overall: 'skipped' };
        }

        return { results, overall: 'failed' };
      }
    }

    return { results, overall: 'completed' };
  }

  /**
   * Resolve as soon as either the group settles or the consumer aborts, so a
   * cancellation returns control within a bounded delay even if some in-flight
   * branch is slow (PQD-104).
   */
  private async raceAgainstAbort(
    groupPromise: Promise<ParallelResult['results']>,
    signal?: AbortSignal,
  ): Promise<ParallelResult['results'] | typeof ABORTED> {
    if (!signal) {
      return groupPromise;
    }
    const abortPromise = new Promise<typeof ABORTED>((resolve) => {
      if (signal.aborted) {
        resolve(ABORTED);
        return;
      }
      signal.addEventListener('abort', () => resolve(ABORTED), { once: true });
    });
    return Promise.race([groupPromise, abortPromise]);
  }

  private async executeGroup(
    steps: WorkflowStep[],
    signal?: AbortSignal,
  ): Promise<ParallelResult['results']> {
    const settled = await Promise.allSettled(
      steps.map(async (step: WorkflowStep) => ({
        skill: step.skill,
        result: await this.stepExecutor.execute(step, signal),
      })),
    );

    return settled.map((s) => {
      if (s.status === 'fulfilled') {
        return {
          skill: s.value.skill,
          status: s.value.result.status,
          error: s.value.result.error,
        };
      }
      return {
        skill: 'unknown',
        status: 'failed' as const,
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      };
    });
  }
}
