import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readModuleMapEvents } from '@/module-decisions/events.js';
import { WorkflowEngine } from '@/workflows/engine.js';
import { StepExecutor } from '@/workflows/step-executor.js';

function writeTemplate(projectRoot: string, name: string, body: string): void {
  const target = join(projectRoot, 'docs', 'instructions', 'workflows');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, `${name}.yaml`), body);
}

function cancelledEvents(projectRoot: string) {
  return readModuleMapEvents(projectRoot).filter((event) => event.type === 'run.cancelled');
}

describe('WorkflowEngine consumer cancellation (PQD-104)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns immediately when the signal is already aborted, with no started steps', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-wf-cancel-'));
    writeTemplate(
      projectRoot,
      'two-step',
      `name: two-step
description: Two sequential steps
steps:
  - skill: first
  - skill: second
`,
    );

    const executeSpy = vi
      .spyOn(StepExecutor.prototype, 'execute')
      .mockResolvedValue({ status: 'completed' });

    const controller = new AbortController();
    controller.abort();

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['first', 'second']),
    }).run('two-step', { classification: {} }, { signal: controller.signal });

    expect(progress.status).toBe('cancelled');
    expect(progress.cancelled_steps_completed).toBe(0);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(progress.steps.every((step) => step.status === 'not_started')).toBe(true);
    expect(cancelledEvents(projectRoot)).toHaveLength(1);
    expect(cancelledEvents(projectRoot)[0]?.run_id).toBe(progress.run_id);
  });

  it('cancels at the next step boundary and records completed steps', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-wf-cancel-'));
    writeTemplate(
      projectRoot,
      'two-step',
      `name: two-step
description: Two sequential steps
steps:
  - skill: first
  - skill: second
`,
    );

    const controller = new AbortController();
    vi.spyOn(StepExecutor.prototype, 'execute').mockImplementation(async (step) => {
      if (step.skill === 'first') {
        controller.abort(); // consumer aborts after the first step completes
      }
      return { status: 'completed' };
    });

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['first', 'second']),
    }).run('two-step', { classification: {} }, { signal: controller.signal });

    expect(progress.status).toBe('cancelled');
    expect(progress.cancelled_steps_completed).toBe(1);
    expect(progress.steps[0]?.status).toBe('completed');
    expect(progress.steps[1]?.status).toBe('not_started');
    expect(cancelledEvents(projectRoot)).toHaveLength(1);
  });

  it('cancels a run when a parallel group is aborted mid-flight', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-wf-cancel-'));
    writeTemplate(
      projectRoot,
      'parallel-cancel',
      `name: parallel-cancel
description: Cancel during a parallel group
steps:
  - parallel:
      - skill: branch-a
      - skill: branch-b
  - skill: after
`,
    );

    const controller = new AbortController();
    vi.spyOn(StepExecutor.prototype, 'execute').mockImplementation(async (step) => {
      if (step.skill === 'branch-a') {
        controller.abort();
      }
      return { status: 'completed' };
    });

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['branch-a', 'branch-b', 'after']),
    }).run('parallel-cancel', { classification: {} }, { signal: controller.signal });

    expect(progress.status).toBe('cancelled');
    expect(progress.steps[1]?.status).toBe('not_started');
    expect(cancelledEvents(projectRoot)).toHaveLength(1);
  });

  it('does not emit a duplicate run.cancelled event when the controller is aborted twice', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-wf-cancel-'));
    writeTemplate(
      projectRoot,
      'two-step',
      `name: two-step
description: Two sequential steps
steps:
  - skill: first
  - skill: second
`,
    );

    const controller = new AbortController();
    vi.spyOn(StepExecutor.prototype, 'execute').mockImplementation(async (step) => {
      if (step.skill === 'first') {
        controller.abort();
        controller.abort(); // second abort on an already-aborted controller is a no-op
      }
      return { status: 'completed' };
    });

    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['first', 'second']),
    }).run('two-step', { classification: {} }, { signal: controller.signal });

    expect(progress.status).toBe('cancelled');
    expect(cancelledEvents(projectRoot)).toHaveLength(1);
  });

  it('treats a late abort after completion as a no-op', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-wf-cancel-'));
    writeTemplate(
      projectRoot,
      'one-step',
      `name: one-step
description: Single step
steps:
  - skill: only
`,
    );

    vi.spyOn(StepExecutor.prototype, 'execute').mockResolvedValue({ status: 'completed' });

    const controller = new AbortController();
    const progress = await new WorkflowEngine({
      projectRoot,
      availableSkills: new Set(['only']),
    }).run('one-step', { classification: {} }, { signal: controller.signal });

    // Abort fires only after the run has already resolved.
    controller.abort();

    expect(progress.status).toBe('completed');
    expect(cancelledEvents(projectRoot)).toHaveLength(0);
  });
});
