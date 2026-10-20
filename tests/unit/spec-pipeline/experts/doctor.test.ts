import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HealthChecker } from '@/health/checker.js';

import { pinSpecPipelineOff } from '../../../shared/spec-pipeline-off.js';

describe('doctor: Expert roster check', () => {
  let root: string;
  let home: string;
  let prevHome: string | undefined;
  const NAME = 'Expert roster config is coherent';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-expert-doctor-'));
    pinSpecPipelineOff(root);
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

  it('passes with the experts switched off (nothing to enforce)', async () => {
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === NAME);
    expect(check?.status).toBe('pass');
    expect(check?.detail).toMatch(/Expert roster is off; nothing to enforce/);
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
        'spec_pipeline_token_ceiling=60000',
      ].join('\n'),
    );
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === NAME);
    expect(check?.status).toBe('pass');
    expect(check?.detail).toMatch(/enabled and its config is coherent/);
  });

  it('warns when adoption is strict but the pipeline is off (FR-12.2a)', async () => {
    writeConfig(['spec_pipeline_enabled=false', 'spec_pipeline_adoption=strict'].join('\n'));
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === 'Spec pipeline adoption is coherent');
    expect(check?.status).toBe('warning');
    expect(check?.detail).toBe(
      'adoption is strict but the pipeline is off; the setting does nothing',
    );
  });

  it('warns when the token ceiling is too low for the standing experts', async () => {
    writeConfig(
      [
        'spec_pipeline_enabled=true',
        'spec_pipeline_experts_enabled=true',
        'spec_pipeline_token_ceiling=20000',
      ].join('\n'),
    );
    const report = await new HealthChecker().run(root);
    const check = report.checks.find(
      (c) => c.name === 'Spec pipeline token ceiling fits the experts',
    );
    expect(check?.status).toBe('warning');
    expect(check?.detail).toContain(
      'the standing experts need 24000 and one on-call expert about 6000',
    );
    expect(check?.detail).toContain('at least 30000');
  });

  it('does not warn at the default onboarded ceiling with the default standing list (AC-12)', async () => {
    writeConfig(['spec_pipeline_enabled=true', 'spec_pipeline_experts_enabled=true'].join('\n'));
    const report = await new HealthChecker().run(root);
    const check = report.checks.find(
      (c) => c.name === 'Spec pipeline token ceiling fits the experts',
    );
    expect(check).toBeUndefined();
  });

  it('warns when a standing role is not an expert', async () => {
    writeConfig(
      [
        'spec_pipeline_enabled=true',
        'spec_pipeline_experts_enabled=true',
        'spec_pipeline_standing_experts=qa-engineer,not-a-role',
      ].join('\n'),
    );
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === 'Standing experts are all expert roles');
    expect(check?.status).toBe('warning');
    expect(check?.detail).toBe(
      'spec_pipeline_standing_experts names "not-a-role", which is not an expert; it is ignored',
    );
  });

  it('confirms every roster role ships a lens (FR-12.2b — passes, the lenses ship)', async () => {
    writeConfig(['spec_pipeline_enabled=true', 'spec_pipeline_experts_enabled=true'].join('\n'));
    const report = await new HealthChecker().run(root);
    const check = report.checks.find((c) => c.name === 'Expert lens files are shipped');
    expect(check).toBeUndefined();
  });
});

describe('doctor: Spec pipeline settings', () => {
  let root: string;
  let home: string;
  let prevHome: string | undefined;
  const NAME = 'Spec pipeline settings';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sp-settings-'));
    home = join(tmpdir(), `paqad-sp-settings-home-${Date.now()}`);
    prevHome = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = home;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.PAQAD_FRAMEWORK_HOME;
    else process.env.PAQAD_FRAMEWORK_HOME = prevHome;
    delete process.env.PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED;
  });

  function teamPolicy(body: string): void {
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
    writeFileSync(join(root, '.paqad', 'configs', '.config.policy'), body, 'utf8');
  }
  async function check(): Promise<{ status: string; detail: string }> {
    const report = await new HealthChecker().run(root);
    return report.checks.find((c) => c.name === NAME) as { status: string; detail: string };
  }

  it('shows the defaults, the standing experts budget and how to switch off', async () => {
    const result = await check();
    expect(result.status).toBe('pass');
    expect(result.detail).toContain(
      'spec pipeline on (default), experts on (default), adoption strict (default).',
    );
    expect(result.detail).toContain('the fast lane never runs it');
    expect(result.detail).toContain(
      'The 4 standing experts carry about 24k tokens of budget per spec (ceiling 40k).',
    );
    expect(result.detail).toContain('spec_pipeline_enabled=false');
  });

  it('names the file that set one key and "default" for the two unset (AC-23)', async () => {
    teamPolicy('spec_pipeline_adoption=warn\n');
    const result = await check();
    expect(result.detail).toContain(
      'spec pipeline on (default), experts on (default), adoption warn (.paqad/configs/.config.policy).',
    );
  });

  it('names the env variable when the env set it', async () => {
    process.env.PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED = 'false';
    const result = await check();
    expect(result.detail).toContain('experts off (PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED)');
    expect(result.detail).not.toContain('standing experts carry');
  });

  it('says the pipeline is off, and default experts or adoption raise no warning', async () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad', '.config'), 'spec_pipeline_enabled=false\n');
    const report = await new HealthChecker().run(root);
    const settings = report.checks.find((c) => c.name === NAME)!;
    expect(settings.detail).toContain('spec pipeline off (.paqad/.config)');
    expect(settings.detail).toContain('no experts run');
    const roster = report.checks.find((c) => c.name === 'Expert roster config is coherent')!;
    expect(roster.status).toBe('pass');
    expect(roster.detail).toMatch(/Expert roster is off; nothing to enforce/);
    expect(
      report.checks.find((c) => c.name === 'Spec pipeline adoption is coherent'),
    ).toBeUndefined();
  });
});
