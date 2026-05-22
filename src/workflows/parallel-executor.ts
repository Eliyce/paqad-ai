import type { ParallelGroup, WorkflowStep } from './types.js';
import type { WorkflowStepRunner } from './step-executor.js';

export interface ParallelResult {
  results: Array<{ skill: string; status: 'completed' | 'skipped' | 'failed'; error?: string }>;
  overall: 'completed' | 'failed' | 'skipped';
}

export class ParallelExecutor {
  constructor(private readonly stepExecutor: WorkflowStepRunner) {}

  async execute(group: ParallelGroup): Promise<ParallelResult> {
    const onFailure = group.on_failure ?? 'abort';
    let results = await this.executeGroup(group.parallel);

    if (results.some((result) => result.status === 'failed')) {
      if (onFailure === 'retry') {
        const retrySteps = group.parallel.filter((_, index) => results[index]?.status === 'failed');
        const retried = await this.executeGroup(retrySteps);
        let retryIndex = 0;
        results = results.map((result) =>
          result.status === 'failed' ? (retried[retryIndex++] ?? result) : result,
        );
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

  private async executeGroup(steps: WorkflowStep[]): Promise<ParallelResult['results']> {
    const settled = await Promise.allSettled(
      steps.map(async (step: WorkflowStep) => ({
        skill: step.skill,
        result: await this.stepExecutor.execute(step),
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
