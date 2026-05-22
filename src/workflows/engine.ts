import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

export interface WorkflowEngineOptions {
  projectRoot: string;
  availableSkills: Set<string>;
  createStepExecutor?: (context: StepExecutionContext) => WorkflowStepRunner;
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

  async run(templateName: string, context: StepExecutionContext): Promise<WorkflowRunProgress> {
    const template = await this.loadAndValidateTemplate(templateName);

    const runId = randomUUID();
    const progress = this.initProgress(runId, template);
    await this.saveProgress(progress, templateName);

    return this.executeSteps(template, progress, context, templateName);
  }

  async resume(
    runId: string,
    templateName: string,
    context: StepExecutionContext,
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
    );
  }

  private async executeSteps(
    template: WorkflowTemplate,
    progress: WorkflowRunProgress,
    context: StepExecutionContext,
    templateName: string,
  ): Promise<WorkflowRunProgress> {
    const stepExecutor = this.options.createStepExecutor?.(context) ?? new StepExecutor(context);
    const parallelExecutor = new ParallelExecutor(stepExecutor);

    for (let i = 0; i < template.steps.length; i++) {
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
      await this.saveProgress(progress, templateName);

      if ('parallel' in step) {
        const result = await parallelExecutor.execute(step);
        stepProgress.status =
          result.overall === 'completed'
            ? 'completed'
            : result.overall === 'skipped'
              ? 'skipped'
              : 'failed';
        stepProgress.error = result.results.find((r) => r.status === 'failed')?.error ?? null;
      } else {
        const result = await this.executeSequentialStep(stepExecutor, step);
        stepProgress.status = result.status;
        stepProgress.error = result.error ?? null;
      }

      stepProgress.completed_at = new Date().toISOString();
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
    await writeFile(path, JSON.stringify(progress, null, 2), 'utf8');
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
  ): Promise<StepExecutionResult> {
    if ('parallel' in step) {
      throw new Error('executeSequentialStep requires a sequential workflow step');
    }

    const firstResult = await stepExecutor.execute(step);
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
      const retryResult = await stepExecutor.execute(step);
      return retryResult.error
        ? { status: retryResult.status, error: retryResult.error }
        : { status: retryResult.status };
    }

    return firstResult.error
      ? { status: 'failed', error: firstResult.error }
      : { status: 'failed' };
  }
}
