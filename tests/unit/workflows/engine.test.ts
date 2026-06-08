import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineEventBus } from '@/event-bus/engine-event-bus.js';
import type { EngineEvent } from '@/event-bus/types.js';
import { WorkflowEngine } from '@/workflows/engine.js';
import { StepExecutor } from '@/workflows/step-executor.js';

function writeTemplate(projectRoot: string, name: string, body: string): void {
  const target = join(projectRoot, 'docs', 'instructions', 'workflows');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, `${name}.yaml`), body);
}

describe('WorkflowEngine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats sequential on_failure: skip as skipped and continues the workflow', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-engine-'));
    writeTemplate(
      projectRoot,
      'skip-step',
      `name: skip-step
description: Skip failed steps
steps:
  - skill: flaky-skill
    on_failure: skip
  - skill: follow-up
`,
    );

    vi.spyOn(StepExecutor.prototype, 'execute').mockImplementation(async (step) => {
      if (step.skill === 'flaky-skill') {
        return { status: 'failed', error: 'boom' };
      }

      return { status: 'completed' };
    });

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['flaky-skill', 'follow-up']),
    }).run('skip-step', { classification: {} });

    expect(progress.status).toBe('completed');
    expect(progress.steps[0]?.status).toBe('skipped');
    expect(progress.steps[1]?.status).toBe('completed');
  });

  it('retries sequential steps once when on_failure: retry is set', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-engine-'));
    writeTemplate(
      projectRoot,
      'retry-step',
      `name: retry-step
description: Retry failed steps
steps:
  - skill: flaky-skill
    on_failure: retry
`,
    );

    let attempts = 0;
    vi.spyOn(StepExecutor.prototype, 'execute').mockImplementation(async (step) => {
      if (step.skill !== 'flaky-skill') {
        return { status: 'completed' };
      }

      attempts += 1;
      return attempts === 1 ? { status: 'failed', error: 'boom' } : { status: 'completed' };
    });

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['flaky-skill']),
    }).run('retry-step', { classification: {} });

    expect(attempts).toBe(2);
    expect(progress.status).toBe('completed');
    expect(progress.steps[0]?.status).toBe('completed');
  });

  it('treats parallel on_failure: skip as skipped and continues the workflow', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-engine-'));
    writeTemplate(
      projectRoot,
      'skip-parallel',
      `name: skip-parallel
description: Skip failed parallel groups
steps:
  - parallel:
      - skill: flaky-skill
      - skill: stable-skill
    on_failure: skip
  - skill: follow-up
`,
    );

    vi.spyOn(StepExecutor.prototype, 'execute').mockImplementation(async (step) => {
      if (step.skill === 'flaky-skill') {
        return { status: 'failed', error: 'boom' };
      }

      return { status: 'completed' };
    });

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['flaky-skill', 'stable-skill', 'follow-up']),
    }).run('skip-parallel', { classification: {} });

    expect(progress.status).toBe('completed');
    expect(progress.steps[0]?.status).toBe('skipped');
    expect(progress.steps[1]?.status).toBe('completed');
  });

  it('retries failed parallel steps once when on_failure: retry is set', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-engine-'));
    writeTemplate(
      projectRoot,
      'retry-parallel',
      `name: retry-parallel
description: Retry failed parallel groups
steps:
  - parallel:
      - skill: flaky-skill
      - skill: stable-skill
    on_failure: retry
`,
    );

    let attempts = 0;
    vi.spyOn(StepExecutor.prototype, 'execute').mockImplementation(async (step) => {
      if (step.skill === 'flaky-skill') {
        attempts += 1;
        return attempts === 1 ? { status: 'failed', error: 'boom' } : { status: 'completed' };
      }

      return { status: 'completed' };
    });

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['flaky-skill', 'stable-skill']),
    }).run('retry-parallel', { classification: {} });

    expect(attempts).toBe(2);
    expect(progress.status).toBe('completed');
    expect(progress.steps[0]?.status).toBe('completed');
  });

  it('getRegisteredWorkflowIds returns workflow IDs from the workflows directory', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-engine-ids-'));
    writeTemplate(projectRoot, 'pentest', 'name: pentest\ndescription: Pentest\nsteps: []');
    writeTemplate(projectRoot, 'root-cause-analysis', 'name: rca\ndescription: RCA\nsteps: []');

    const engine = new WorkflowEngine({ projectRoot, availableSkills: new Set() });
    const ids = await engine.getRegisteredWorkflowIds();

    expect(ids).toContain('pentest');
    expect(ids).toContain('root-cause-analysis');
  });

  it('getRegisteredWorkflowIds returns empty array when no workflows directory', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-engine-empty-'));
    const engine = new WorkflowEngine({ projectRoot, availableSkills: new Set() });
    const ids = await engine.getRegisteredWorkflowIds();
    expect(ids).toEqual([]);
  });

  it('revalidates templates on resume before executing', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-engine-'));
    writeTemplate(
      projectRoot,
      'resume-invalid',
      `name: resume-invalid
description: Invalid on resume
steps:
  - skill: missing-skill
`,
    );

    const runId = 'run-123';
    const progressPath = join(
      projectRoot,
      '.paqad',
      'workflows',
      'resume-invalid',
      'runs',
      runId,
      'progress.json',
    );
    mkdirSync(dirname(progressPath), { recursive: true });
    writeFileSync(
      progressPath,
      JSON.stringify({
        schema_version: '1',
        run_id: runId,
        template_name: 'resume-invalid',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        steps: [
          {
            index: 0,
            skill: 'missing-skill',
            type: 'sequential',
            status: 'not_started',
            started_at: null,
            completed_at: null,
            error: null,
          },
        ],
      }),
      'utf8',
    );

    await expect(
      new WorkflowEngine({
        projectRoot,
        availableSkills: new Set(['different-skill']),
      }).resume(runId, 'resume-invalid', { classification: {} }),
    ).rejects.toThrow('Invalid workflow template "resume-invalid"');
  });

  it('aborts custom workflows when no skill runner is wired for a referenced skill', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-engine-'));
    writeTemplate(
      projectRoot,
      'stubbed-runner',
      `name: stubbed-runner
description: Must not fake success
steps:
  - skill: real-skill
`,
    );

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['real-skill']),
    }).run('stubbed-runner', { classification: {} });

    expect(progress.status).toBe('aborted');
    expect(progress.steps[0]?.status).toBe('failed');
    expect(progress.steps[0]?.error).toContain('No workflow skill runner is configured');
  });

  it('marks custom workflows complete when a concrete step executor is wired', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-engine-'));
    writeTemplate(
      projectRoot,
      'wired-runner',
      `name: wired-runner
description: Executes a real runner
steps:
  - skill: real-skill
`,
    );

    const execute = vi.fn().mockResolvedValue({ status: 'completed' });

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['real-skill']),
      createStepExecutor: () => ({
        execute,
      }),
    }).run('wired-runner', { classification: { workflow: 'custom' } });

    expect(execute).toHaveBeenCalledWith({
      skill: 'real-skill',
    });
    expect(progress.status).toBe('completed');
    expect(progress.steps[0]?.status).toBe('completed');
  });

  it('emits workflow-step events to the engine event bus when provided (PQD-99)', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-engine-'));
    writeTemplate(
      projectRoot,
      'bus-steps',
      `name: bus-steps
description: Emits step events
steps:
  - skill: ok-skill
  - skill: bad-skill
`,
    );

    vi.spyOn(StepExecutor.prototype, 'execute').mockImplementation(async (step) =>
      step.skill === 'bad-skill' ? { status: 'failed', error: 'kaboom' } : { status: 'completed' },
    );

    const bus = new EngineEventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['ok-skill', 'bad-skill']),
      eventBus: bus,
    }).run('bus-steps', { classification: {} });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const byKind = events.map((e) => e.kind);
    expect(byKind).toEqual([
      'workflow-step-started',
      'workflow-step-completed',
      'workflow-step-started',
      'workflow-step-failed',
    ]);
    const failed = events[3] as {
      runId: string;
      stepIndex: number;
      skill: string | null;
      error: string;
    };
    expect(failed.runId).toBe(progress.run_id);
    expect(failed.stepIndex).toBe(1);
    expect(failed.skill).toBe('bad-skill');
    expect(failed.error).toBe('kaboom');
  });
});
