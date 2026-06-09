import { CancelledError } from '../core/errors/cancelled-error.js';
import type { SkillCacheManager } from '../skills/cache-manager.js';
import type { PredictiveCache } from '../cache/predictive-cache.js';
import type { WorkflowStep, StepCondition } from './types.js';

export interface StepExecutionContext {
  classification: {
    complexity?: string;
    risk?: string;
    workflow?: string;
    [key: string]: unknown;
  };
}

export interface StepExecutionResult {
  status: 'completed' | 'skipped' | 'failed';
  error?: string;
}

export interface WorkflowStepRunner {
  execute(step: WorkflowStep, signal?: AbortSignal): Promise<StepExecutionResult>;
}

export interface StepExecutorOptions {
  sessionId?: string;
  stackKey?: string;
  predictiveCache?: PredictiveCache;
  skillCacheManager?: SkillCacheManager;
}

export class StepExecutor implements WorkflowStepRunner {
  private readonly sessionId: string;
  private readonly stackKey: string;
  private readonly predictiveCache: PredictiveCache | undefined;
  private readonly skillCacheManager: SkillCacheManager | undefined;
  private lastSkill: string | undefined;

  constructor(
    private readonly context: StepExecutionContext,
    options: StepExecutorOptions = {},
  ) {
    this.sessionId = options.sessionId ?? 'default';
    this.stackKey = options.stackKey ?? 'default';
    this.predictiveCache = options.predictiveCache;
    this.skillCacheManager = options.skillCacheManager;
  }

  shouldExecute(step: WorkflowStep): boolean {
    if (!step.condition) return true;
    return this.evaluateCondition(step.condition, this.context.classification);
  }

  async execute(step: WorkflowStep, signal?: AbortSignal): Promise<StepExecutionResult> {
    // Pre-flight cancellation: never start a step's work once the consumer has
    // aborted (PQD-104). Throwing keeps the engine loop's cancellation handling
    // and the parallel executor's short-circuit in a single place.
    if (signal?.aborted) {
      throw new CancelledError();
    }

    if (!this.shouldExecute(step)) {
      return { status: 'skipped' };
    }

    try {
      if (this.skillCacheManager) {
        const cacheResult = await this.skillCacheManager.checkCache(step.skill, []);
        if (cacheResult.hit) {
          this.lastSkill = step.skill;
          return { status: 'completed' };
        }
      }

      await this.runStep(_stepToExecutionPayload(step));

      if (this.skillCacheManager) {
        const inputHash = await this.skillCacheManager.computeInputHash([]);
        await this.skillCacheManager.writeCache(step.skill, inputHash, null, []);
      }

      if (this.predictiveCache) {
        const outputHash = String(Date.now());
        const workflow = String(this.context.classification.workflow ?? 'custom');
        await this.predictiveCache.onSkillComplete(
          this.sessionId,
          this.stackKey,
          workflow,
          step.skill,
          outputHash,
          undefined,
        );
      }
      this.lastSkill = step.skill;
      return { status: 'completed' };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { status: 'failed', error };
    }
  }

  /** Exposed for testing only. */
  getLastSkill(): string | undefined {
    return this.lastSkill;
  }

  protected async runStep(payload: WorkflowStep): Promise<void> {
    throw new Error(
      `No workflow skill runner is configured for "${payload.skill}". Custom workflow steps cannot be marked complete without execution.`,
    );
  }

  private evaluateCondition(
    condition: StepCondition,
    classification: StepExecutionContext['classification'],
  ): boolean {
    for (const [field, allowedValues] of Object.entries(condition)) {
      const classValue = classification[field];
      if (classValue === undefined) return false;
      if (!Array.isArray(allowedValues)) continue;
      if (!allowedValues.includes(classValue as string)) return false;
    }
    return true;
  }
}

function _stepToExecutionPayload(step: WorkflowStep): WorkflowStep {
  return step;
}
