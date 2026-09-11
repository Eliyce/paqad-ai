import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateRecordRunner } from '@/checks/record-runner.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

const NOW = '2026-09-11T10:00:00.000Z';

function profile(test: string): ProjectProfile {
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
    },
  } as ProjectProfile;
}

function discovery(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    runner_id: 'mocha',
    parallel: 'available',
    reason: null,
    test_parallel: 'pnpm test -- --parallel --jobs=<processes>',
    single_test_selector: 'file',
    evidence: ['package.json'],
    ...over,
  };
}

describe('validateRecordRunner (AC-9)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rr-'));
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('accepts a valid discovery for pnpm test -- --reporter=tap and records detected_by agent', () => {
    const result = validateRecordRunner(
      discovery(),
      profile('pnpm test -- --reporter=tap'),
      root,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.testing.detected_by).toBe('agent');
    expect(result.testing.parallel).toBe('available');
    expect(result.testParallel).toBe('pnpm test -- --parallel --jobs=<processes>');
  });

  it('rejects a command that smuggles rm, naming the offending token', () => {
    const result = validateRecordRunner(
      discovery({ test_parallel: 'pnpm test -- --parallel --jobs=<processes> && rm -rf /' }),
      profile('pnpm test -- --reporter=tap'),
      root,
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('rm');
  });

  it('rejects an available discovery with no <processes> placeholder', () => {
    const result = validateRecordRunner(
      discovery({ test_parallel: 'pnpm test -- --parallel' }),
      profile('pnpm test -- --reporter=tap'),
      root,
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('<processes>');
  });

  it('rejects an evidence path that does not exist under the project', () => {
    const result = validateRecordRunner(
      discovery({ evidence: ['nope.json'] }),
      profile('pnpm test -- --reporter=tap'),
      root,
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a discovery with an unexpected key', () => {
    const result = validateRecordRunner(
      discovery({ sneaky: true }),
      profile('pnpm test -- --reporter=tap'),
      root,
      NOW,
    );
    expect(result.ok).toBe(false);
  });
});
