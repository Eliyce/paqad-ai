import { describe, expect, it } from 'vitest';

import { resolveTestPlan } from '@/checks/parallel-plan.js';
import type { OsFacts, TestPlanKnobs } from '@/checks/parallel-plan.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

const GiB = 1024 ** 3;
const DEFAULT_KNOBS: TestPlanKnobs = { checksParallel: true, checksMaxProcesses: 0 };

function make(
  test: string,
  testParallel: string | undefined,
  testing: ProjectProfile['testing'],
): Pick<ProjectProfile, 'commands' | 'testing'> {
  return {
    commands: {
      install: '',
      dev: '',
      test,
      test_single: '',
      lint: '',
      format: '',
      migrate: '',
      build: '',
      ...(testParallel ? { test_parallel: testParallel } : {}),
    },
    testing,
  };
}

const AVAILABLE = (): ProjectProfile['testing'] => ({
  runner_id: 'pest',
  parallel: 'available',
  detected_by: 'script',
  recorded_at: '2026-09-11T00:00:00.000Z',
});

// The plan resolver (issue #554, AC-3): pure, os facts injected.
describe('resolveTestPlan (AC-3)', () => {
  const os = (availableParallelism: number, totalmem: number): OsFacts => ({
    availableParallelism,
    totalmem,
  });

  it('available with 12 cores and ample memory → parallel ×11', () => {
    const plan = resolveTestPlan(
      make('php artisan test', 'php artisan test --parallel --processes=<processes>', AVAILABLE()),
      os(12, 64 * GiB),
      DEFAULT_KNOBS,
    );
    expect(plan.mode).toBe('parallel');
    expect(plan.processes).toBe(11);
    expect(plan.command).toBe('php artisan test --parallel --processes=11');
  });

  it('low memory (6 GiB) caps at 4', () => {
    const plan = resolveTestPlan(
      make('t', 't --processes=<processes>', AVAILABLE()),
      os(12, 6 * GiB),
      DEFAULT_KNOBS,
    );
    expect(plan.processes).toBe(4);
  });

  it('a container wrapper with 32 cores caps at 8', () => {
    const plan = resolveTestPlan(
      make('vendor/bin/sail test', 'vendor/bin/sail test --processes=<processes>', AVAILABLE()),
      os(32, 64 * GiB),
      DEFAULT_KNOBS,
    );
    expect(plan.processes).toBe(8);
  });

  it('fewer than 4 cores → sequential, too-few-cores', () => {
    const plan = resolveTestPlan(
      make('t', 't --processes=<processes>', AVAILABLE()),
      os(2, 64 * GiB),
      DEFAULT_KNOBS,
    );
    expect(plan.mode).toBe('sequential');
    expect(plan.reason).toBe('too-few-cores');
  });

  it('checks_parallel=false → sequential, disabled', () => {
    const plan = resolveTestPlan(make('t', 't --processes=<processes>', AVAILABLE()), os(12, 64 * GiB), {
      checksParallel: false,
      checksMaxProcesses: 0,
    });
    expect(plan.mode).toBe('sequential');
    expect(plan.reason).toBe('disabled');
  });

  it('checks_max_processes=3 caps the count at 3', () => {
    const plan = resolveTestPlan(make('t', 't --processes=<processes>', AVAILABLE()), os(12, 64 * GiB), {
      checksParallel: true,
      checksMaxProcesses: 3,
    });
    expect(plan.processes).toBe(3);
  });

  it('native → the sequential command, mode native', () => {
    const plan = resolveTestPlan(
      make('pnpm test', undefined, {
        runner_id: 'vitest',
        parallel: 'native',
        detected_by: 'script',
        recorded_at: '2026-09-11T00:00:00.000Z',
      }),
      os(12, 64 * GiB),
      DEFAULT_KNOBS,
    );
    expect(plan.mode).toBe('native');
    expect(plan.command).toBe('pnpm test');
  });

  it('unavailable → sequential with the recorded reason', () => {
    const plan = resolveTestPlan(
      make('bundle exec rspec', undefined, {
        runner_id: 'rspec',
        parallel: 'unavailable',
        reason: 'paratest-missing',
        detected_by: 'script',
        recorded_at: '2026-09-11T00:00:00.000Z',
      }),
      os(12, 64 * GiB),
      DEFAULT_KNOBS,
    );
    expect(plan.mode).toBe('sequential');
    expect(plan.reason).toBe('paratest-missing');
  });

  it('no testing record → sequential, unknown', () => {
    const plan = resolveTestPlan(make('t', undefined, undefined), os(12, 64 * GiB), DEFAULT_KNOBS);
    expect(plan.mode).toBe('sequential');
    expect(plan.reason).toBe('unknown');
  });
});
