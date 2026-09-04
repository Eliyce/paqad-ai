import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HealthChecker } from '@/health/checker.js';

// FR-10 — the doctor spec-pipeline check. The parity-corpus branch (pass) is exercised by the
// full HealthChecker suite; here we cover the config-coherence warn branch.
describe('doctor: Spec pipeline check', () => {
  let root: string;
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sp-doctor-'));
    home = join(tmpdir(), `paqad-sp-doctor-home-${Date.now()}`);
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

  it('warns on an incoherent config: required final-review on a disabled pipeline (FR-10-T4)', async () => {
    writeConfig(['spec_pipeline_enabled=false', 'spec_pipeline_final_review=strict'].join('\n'));
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === 'Spec pipeline is healthy');
    expect(check?.status).toBe('warning');
    expect(check?.detail).toMatch(/disabled pipeline/);
  });

  it('passes with the default (coherent) config', async () => {
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === 'Spec pipeline is healthy');
    expect(check?.status).toBe('pass');
  });
});
