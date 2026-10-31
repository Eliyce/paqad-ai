import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HealthChecker } from '@/health/checker.js';
import type { HealthCheckResult } from '@/core/types/health.js';

type WithCheck = { checkAuthoringConfig(projectRoot: string): HealthCheckResult[] };

const roots: string[] = [];

function run(config: string): HealthCheckResult[] {
  const root = mkdtempSync(join(tmpdir(), 'paqad-authoring-doctor-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad', '.config'), config, 'utf8');
  const checker = new HealthChecker() as unknown as WithCheck;
  return checker.checkAuthoringConfig(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('doctor: skill authoring settings', () => {
  it('passes when every setting is at its default', () => {
    const results = run('');
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('pass');
  });

  it('warns once per out-of-range key, naming the key, the value and the range', () => {
    const results = run('authoring_collision_jaccard=2\nauthoring_max_iterations=0\n');
    expect(results.map((result) => result.status)).toEqual(['warning', 'warning']);
    expect(results[0]?.detail).toContain('authoring_max_iterations=0');
    expect(results[0]?.detail).toContain('a positive whole number');
    expect(results[1]?.detail).toContain('authoring_collision_jaccard=2');
    expect(results[1]?.detail).toContain('a number from 0 to 1');
    expect(results[1]?.remediation).toContain('authoring_collision_jaccard');
  });
});
