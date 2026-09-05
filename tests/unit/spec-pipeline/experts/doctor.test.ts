import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HealthChecker } from '@/health/checker.js';

// Issue #521, FR-9 / AC-6 — the doctor expert-roster coherence check.
describe('doctor: Expert roster check', () => {
  let root: string;
  let home: string;
  let prevHome: string | undefined;
  const NAME = 'Expert roster config is coherent';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-expert-doctor-'));
    home = join(tmpdir(), `paqad-expert-doctor-home-${Date.now()}`);
    prevHome = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = home;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.PAQAD_FRAMEWORK_HOME;
    else process.env.PAQAD_FRAMEWORK_HOME = prevHome;
  });

  function writeConfig(body: string): void {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad', '.config'), body, 'utf8');
  }

  it('passes with the default off config (nothing to enforce)', async () => {
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === NAME);
    expect(check?.status).toBe('pass');
    expect(check?.detail).toMatch(/off \(default\)/);
  });

  it('warns when experts are on but the pipeline itself is off (AC-6)', async () => {
    writeConfig(['spec_pipeline_enabled=false', 'spec_pipeline_experts_enabled=true'].join('\n'));
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === NAME);
    expect(check?.status).toBe('warning');
    expect(check?.detail).toMatch(/pipeline itself is off/);
  });

  it('warns when experts are on but the clarification round is off (AC-6)', async () => {
    writeConfig(
      [
        'spec_pipeline_enabled=true',
        'spec_pipeline_experts_enabled=true',
        'spec_pipeline_clarification=off',
      ].join('\n'),
    );
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === NAME);
    expect(check?.status).toBe('warning');
    expect(check?.detail).toMatch(/question round is disabled/);
  });

  it('passes when experts are on with a coherent config', async () => {
    writeConfig(
      [
        'spec_pipeline_enabled=true',
        'spec_pipeline_experts_enabled=true',
        'spec_pipeline_clarification=warn',
      ].join('\n'),
    );
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === NAME);
    expect(check?.status).toBe('pass');
    expect(check?.detail).toMatch(/enabled and its config is coherent/);
  });
});
