import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { OnboardingOrchestrator } from '@/onboarding';

const FILE = 'feature-development/workflow.yaml';
const LISTED = 'Keep planning scoped to the requested feature and the current repository state.';

describe('onboarding reports what the team config sync found', () => {
  let projectRoot: string;
  let frameworkHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-onboarding-notes-'));
    frameworkHome = mkdtempSync(join(tmpdir(), 'paqad-onboarding-notes-home-'));
    rmSync(frameworkHome, { recursive: true, force: true });
    originalHome = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ scripts: {} }));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    if (existsSync(frameworkHome)) rmSync(frameworkHome, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.PAQAD_FRAMEWORK_HOME;
    else process.env.PAQAD_FRAMEWORK_HOME = originalHome;
  });

  function writeConfig(rel: string, text: string): void {
    const path = join(projectRoot, PATHS.PROJECT_CONFIGS_DIR, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }

  it('warns about a removed old entry and an invalid team file', async () => {
    writeConfig(
      FILE,
      `paqad_version: "1.118.0"\nstages:\n  planning:\n    instructions:\n      - ${LISTED}\n`,
    );
    writeConfig('models.yaml', 'enabled: [true\n');
    const { warnings } = await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
    });
    expect(warnings).toContain(
      `Removed an old copy of paqad's planning instruction from ${FILE}: ${LISTED.slice(0, 60)}`,
    );
    expect(warnings.some((line) => line.startsWith("models.yaml isn't valid YAML"))).toBe(true);
    expect(readFileSync(join(projectRoot, PATHS.PROJECT_CONFIGS_DIR, FILE), 'utf8')).not.toContain(
      LISTED,
    );
  });
});
