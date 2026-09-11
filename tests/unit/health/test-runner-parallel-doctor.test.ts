import { describe, expect, it } from 'vitest';

import { HealthChecker } from '@/health/checker.js';
import type { HealthCheckResult } from '@/core/types/health.js';
import type { ProjectProfile, ProjectTesting } from '@/core/types/project-profile.js';

type WithCheck = { checkTestRunnerParallel(profile: ProjectProfile | null): HealthCheckResult };

function run(testing: ProjectTesting | undefined): HealthCheckResult {
  const checker = new HealthChecker() as unknown as WithCheck;
  return checker.checkTestRunnerParallel(({ testing } as ProjectProfile) ?? null);
}

// Doctor warn-check for the recorded parallel mode (issue #554, AC-13).
describe('checkTestRunnerParallel', () => {
  it('warns for unavailable with a package-missing reason and names the package', () => {
    const result = run({
      runner_id: 'pest',
      parallel: 'unavailable',
      reason: 'brianium/paratest-missing',
      detected_by: 'script',
      recorded_at: '2026-09-11T00:00:00.000Z',
    });
    expect(result.status).toBe('warning');
    expect(result.remediation).toContain('brianium/paratest');
  });

  it('passes for native', () => {
    const result = run({
      runner_id: 'vitest',
      parallel: 'native',
      detected_by: 'script',
      recorded_at: '2026-09-11T00:00:00.000Z',
    });
    expect(result.status).toBe('pass');
  });

  it('passes (informational) when nothing is recorded yet', () => {
    expect(run(undefined).status).toBe('pass');
  });
});
