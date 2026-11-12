import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInstallCommand } from '@/cli/commands/install.js';
import { formatUpdateReportLines } from '@/cli/commands/update.js';
import { HealthChecker } from '@/health/checker.js';
import { DISCOVERY_CLASH_MESSAGE } from '@/health/plugin-install.js';
import { bootstrapFramework } from '@/install/bootstrap.js';
import { OnboardingOrchestrator } from '@/onboarding';
import { FrameworkUpdater } from '@/update/index.js';

let home: string;
let project: string;
let frameworkHome: string;
const saved: Record<string, string | undefined> = {};

function installBoth(): void {
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'paqad@eliyce': [{ scope: 'user' }],
        'paqad-product-discovery@paqad-product-discovery': [{ scope: 'user' }],
      },
    }),
  );
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'discovery-clash-home-'));
  project = mkdtempSync(join(tmpdir(), 'discovery-clash-repo-'));
  frameworkHome = join(mkdtempSync(join(tmpdir(), 'discovery-clash-fw-')), 'current');
  for (const key of ['CLAUDE_CONFIG_DIR', 'PAQAD_FRAMEWORK_HOME']) saved[key] = process.env[key];
  process.env.CLAUDE_CONFIG_DIR = join(home, '.claude');
  process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  rmSync(join(frameworkHome, '..'), { recursive: true, force: true });
});

describe('AC-16: doctor, update and install name the discovery plugin clash', () => {
  it('AC-16: doctor fails with exactly the sentence when both plugins are installed', async () => {
    installBoth();
    const report = await new HealthChecker({ homeDir: home }).run(project);
    const row = report.checks.find((check) => check.name === 'Claude plugins');
    expect(row).toMatchObject({ status: 'fail', detail: DISCOVERY_CLASH_MESSAGE });
    expect(report.overall_status).not.toBe('healthy');
  });

  it('AC-18: doctor adds no row when only the paqad plugin is installed', async () => {
    const report = await new HealthChecker({ homeDir: home }).run(project);
    expect(report.checks.some((check) => check.name === 'Claude plugins')).toBe(false);
    expect(report.checks.some((check) => check.detail === DISCOVERY_CLASH_MESSAGE)).toBe(false);
  });

  it('AC-16: update reports the sentence as a warning line', async () => {
    installBoth();
    const report = await new FrameworkUpdater({ generateCandidates: async () => [] }).run(project);
    expect(report.plugin_notes).toEqual([DISCOVERY_CLASH_MESSAGE]);
    expect(formatUpdateReportLines(report).at(-1)).toBe(`Warning: ${DISCOVERY_CLASH_MESSAGE}`);
  });

  it('AC-18: update carries no plugin note and prints nothing new without the clash', async () => {
    const report = await new FrameworkUpdater({ generateCandidates: async () => [] }).run(project);
    expect('plugin_notes' in report).toBe(false);
    expect(formatUpdateReportLines(report).join('\n')).not.toContain(DISCOVERY_CLASH_MESSAGE);
  });

  it('AC-16: the install result carries the sentence as a warning only on a clash', () => {
    expect('warnings' in bootstrapFramework(project)).toBe(false);
    installBoth();
    expect(bootstrapFramework(project).warnings).toEqual([DISCOVERY_CLASH_MESSAGE]);
  });

  it('AC-16: the install command prints the sentence as a warning line only on a clash', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await createInstallCommand().parseAsync(['node', 'install', '--project-root', project]);
      expect(error).not.toHaveBeenCalledWith(`Warning: ${DISCOVERY_CLASH_MESSAGE}`);
      installBoth();
      await createInstallCommand().parseAsync(['node', 'install', '--project-root', project]);
      expect(error).toHaveBeenCalledWith(`Warning: ${DISCOVERY_CLASH_MESSAGE}`);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).warnings).toEqual([
        DISCOVERY_CLASH_MESSAGE,
      ]);
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });

  it('AC-16: onboarding carries the sentence in its warnings on a clash', async () => {
    installBoth();
    const output = await new OnboardingOrchestrator().run({
      projectRoot: project,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });
    expect(output.warnings).toContain(DISCOVERY_CLASH_MESSAGE);
  }, 60_000);
});
