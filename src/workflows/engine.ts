import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  WorkflowTemplate,
  WorkflowRunProgress,
  WorkflowStepProgress,
  TemplateStep,
} from './types.js';
import { WorkflowTemplateLoader } from './template-loader.js';
import { WorkflowTemplateValidator } from './template-validator.js';
import {
  StepExecutor,
  type StepExecutionContext,
  type StepExecutionResult,
  type WorkflowStepRunner,
} from './step-executor.js';
import { ParallelExecutor } from './parallel-executor.js';
import { CancelledError } from '../core/errors/cancelled-error.js';
import { appendRunCancelledEvent } from '../module-decisions/events.js';
import type { EngineEventBus } from '../event-bus/index.js';

/** Per-call options for cancellable workflow runs (PQD-104). */
export interface WorkflowRunOptions {
  /**
   * Optional consumer cancellation signal. When it aborts, the run settles at
   * the next step boundary with `status: 'cancelled'`, emits a single
   * `run.cancelled` event, and persists progress atomically so the consumer can
   * resume from the first not-yet-completed step.
   */
  signal?: AbortSignal;
}

export interface WorkflowEngineOptions {
  projectRoot: string;
  availableSkills: Set<string>;
  createStepExecutor?: (context: StepExecutionContext) => WorkflowStepRunner;
  /**
   * Optional engine event bus (PQD-99). When provided, the engine emits
   * `workflow-step-started` before each step and `workflow-step-completed` /
   * `workflow-step-failed` after it, so consumers can render progress live.
   * Omitting it leaves behaviour unchanged.
   */
  eventBus?: EngineEventBus;
}

export class WorkflowEngine {
  private readonly loader: WorkflowTemplateLoader;
  private readonly validator: WorkflowTemplateValidator;

  constructor(private readonly options: WorkflowEngineOptions) {
    this.loader = new WorkflowTemplateLoader(options.projectRoot);
    this.validator = new WorkflowTemplateValidator();
  }

  async getRegisteredWorkflowIds(): Promise<string[]> {
    return this.loader.list();
  }

  async run(
    templateName: string,
    context: StepExecutionContext,
    options: WorkflowRunOptions = {},
  ): Promise<WorkflowRunProgress> {
    const template = await this.loadAndValidateTemplate(templateName);

    const runId = randomUUID();
    const progress = this.initProgress(runId, template);

    // Pre-flight: an already-aborted signal returns immediately without writing
    // the initial progress file or emitting any started events (PQD-104).
    if (options.signal?.aborted) {
      return this.cancelRun(progress, templateName);
    }

    await this.saveProgress(progress, templateName);

    return this.executeSteps(template, progress, context, templateName, options.signal);
  }

  async resume(
    runId: string,
    templateName: string,
    context: StepExecutionContext,
    options: WorkflowRunOptions = {},
  ): Promise<WorkflowRunProgress> {
    const existing = await this.loadProgress(runId, templateName);
    if (!existing) {
      throw new Error(`No run found with id "${runId}" for template "${templateName}"`);
    }
    return this.executeSteps(
      await this.loadAndValidateTemplate(templateName),
      existing,
      context,
      templateName,
      options.signal,
    );
  }

  private async executeSteps(
    template: WorkflowTemplate,
    progress: WorkflowRunProgress,
    context: StepExecutionContext,
    templateName: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRunProgress> {
    const stepExecutor = this.options.createStepExecutor?.(context) ?? new StepExecutor(context);
    const parallelExecutor = new ParallelExecutor(stepExecutor);

    for (let i = 0; i < template.steps.length; i++) {
      // Between-step cancellation boundary: settle as cancelled before starting
      // the next step, leaving already-completed steps intact (PQD-104).
      if (signal?.aborted) {
        return this.cancelRun(progress, templateName);
      }

      const stepProgress = progress.steps[i];
      if (
        !stepProgress ||
        stepProgress.status === 'completed' ||
        stepProgress.status === 'skipped'
      ) {
        continue; // skip already done
      }

      const step: TemplateStep = template.steps[i];
      stepProgress.status = 'running';
      stepProgress.started_at = new Date().toISOString();
      this.options.eventBus?.emit({
        kind: 'workflow-step-started',
        at: new Date().toISOString(),
        runId: progress.run_id,
        stepIndex: i,
        skill: stepProgress.skill,
      });
      await this.saveProgress(progress, templateName);

      try {
        if ('parallel' in step) {
          const result = await parallelExecutor.execute(step, signal);
          if (result.overall === 'cancelled') {
            return this.cancelRun(progress, templateName);
          }
          stepProgress.status =
            result.overall === 'completed'
              ? 'completed'
              : result.overall === 'skipped'
                ? 'skipped'
                : 'failed';
          stepProgress.error = result.results.find((r) => r.status === 'failed')?.error ?? null;
        } else {
          const result = await this.executeSequentialStep(stepExecutor, step, signal);
          stepProgress.status = result.status;
          stepProgress.error = result.error ?? null;
        }
      } catch (error) {
        // A consumer abort surfacing mid-step (pre-flight throw inside the step
        // executor) settles the whole run as cancelled (PQD-104).
        if (error instanceof CancelledError) {
          return this.cancelRun(progress, templateName);
        }
        throw error;
      }

      stepProgress.completed_at = new Date().toISOString();
      if (stepProgress.status === 'failed') {
        this.options.eventBus?.emit({
          kind: 'workflow-step-failed',
          at: new Date().toISOString(),
          runId: progress.run_id,
          stepIndex: i,
          skill: stepProgress.skill,
          error: stepProgress.error ?? 'Workflow step failed',
        });
      } else {
        this.options.eventBus?.emit({
          kind: 'workflow-step-completed',
          at: new Date().toISOString(),
          runId: progress.run_id,
          stepIndex: i,
          skill: stepProgress.skill,
        });
      }
      await this.saveProgress(progress, templateName);

      // Handle abort
      if (stepProgress.status === 'failed') {
        const onFailure = 'on_failure' in step ? (step.on_failure ?? 'abort') : 'abort';
        if (onFailure === 'abort') {
          progress.status = 'aborted';
          await this.saveProgress(progress, templateName);
          return progress;
        }
      }
    }

    progress.status = progress.steps.some((s) => s.status === 'failed') ? 'failed' : 'completed';
    await this.saveProgress(progress, templateName);
    return progress;
  }

  private initProgress(runId: string, template: WorkflowTemplate): WorkflowRunProgress {
    const steps: WorkflowStepProgress[] = template.steps.map((step, i) => ({
      index: i,
      skill: 'skill' in step ? step.skill : null,
      type: 'parallel' in step ? 'parallel' : 'sequential',
      status: 'not_started',
      started_at: null,
      completed_at: null,
      error: null,
    }));

    return {
      schema_version: '1',
      run_id: runId,
      template_name: template.name,
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps,
    };
  }

  private progressPath(runId: string, templateName: string): string {
    return join(
      this.options.projectRoot,
      '.paqad',
      'workflows',
      templateName,
      'runs',
      runId,
      'progress.json',
    );
  }

  private async saveProgress(progress: WorkflowRunProgress, templateName: string): Promise<void> {
    progress.updated_at = new Date().toISOString();
    const path = this.progressPath(progress.run_id, templateName);
    await mkdir(dirname(path), { recursive: true });
    // Atomic tmp → rename so a process killed mid-save never leaves a torn
    // progress file — a prerequisite for the partial-checkpoint guarantee (PQD-104).
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(progress, null, 2), 'utf8');
    await rename(tmp, path);
  }

  /**
   * Settle the run as cancelled-by-consumer (PQD-104): record how many steps
   * finished, persist atomically, and emit exactly one `run.cancelled` event.
   * Callers return immediately afterward so no further events for this run follow.
   */
  private async cancelRun(
    progress: WorkflowRunProgress,
    templateName: string,
  ): Promise<WorkflowRunProgress> {
    progress.status = 'cancelled';
    progress.cancelled_steps_completed = progress.steps.filter(
      (step) => step.status === 'completed',
    ).length;
    await this.saveProgress(progress, templateName);
    appendRunCancelledEvent(this.options.projectRoot, progress.run_id, {
      template_name: templateName,
      cancelled_steps_completed: progress.cancelled_steps_completed,
    });
    return progress;
  }

  private async loadProgress(
    runId: string,
    templateName: string,
  ): Promise<WorkflowRunProgress | null> {
    try {
      const raw = await readFile(this.progressPath(runId, templateName), 'utf8');
      return JSON.parse(raw) as WorkflowRunProgress;
    } catch {
      return null;
    }
  }

  private async loadAndValidateTemplate(templateName: string): Promise<WorkflowTemplate> {
    const template = await this.loader.load(templateName);
    const { valid, errors } = this.validator.validate(template, this.options.availableSkills);
    if (!valid) {
      throw new Error(`Invalid workflow template "${templateName}": ${errors.join('; ')}`);
    }

    return template;
  }

  private async executeSequentialStep(
    stepExecutor: WorkflowStepRunner,
    step: TemplateStep,
    signal?: AbortSignal,
  ): Promise<StepExecutionResult> {
    if ('parallel' in step) {
      throw new Error('executeSequentialStep requires a sequential workflow step');
    }

    const firstResult = await stepExecutor.execute(step, signal);
    if (firstResult.status !== 'failed') {
      return firstResult;
    }

    const onFailure = step.on_failure ?? 'abort';
    if (onFailure === 'skip') {
      return firstResult.error
        ? { status: 'skipped', error: firstResult.error }
        : { status: 'skipped' };
    }

    if (onFailure === 'retry') {
      const retryResult = await stepExecutor.execute(step, signal);
      return retryResult.error
        ? { status: retryResult.status, error: retryResult.error }
        : { status: retryResult.status };
    }

    return firstResult.error
      ? { status: 'failed', error: firstResult.error }
      : { status: 'failed' };
  }
}
