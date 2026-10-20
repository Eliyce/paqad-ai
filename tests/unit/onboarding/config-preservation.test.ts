import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateConfigExample, syncFrameworkConfig } from '@/core/framework-config.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { OnboardingOrchestrator } from '@/onboarding';

// Config-visibility / preservation (issue #220 follow-up): a re-onboard is a
// refresh, not a reset. Framework knobs live in `.paqad/.config`, which onboard
// never touches, so a team's customizations persist across a re-onboard. paqad
// resolves to enabled by default. See
// docs/instructions/rules/coding/config-visibility.md.

describe('onboarding preserves user config and materializes paqad.enabled', () => {
  let projectRoot: string;
  let frameworkHome: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-cfg-preserve-'));
    frameworkHome = join(tmpdir(), `paqad-cfg-home-${Date.now()}`);
    originalEnv = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = originalEnv;
    }
    rmSync(projectRoot, { recursive: true, force: true });
    if (frameworkHome) rmSync(frameworkHome, { recursive: true, force: true });
  });

  async function onboard(): Promise<void> {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });
  }

  it('writes paqad.enabled: true on a fresh onboard', async () => {
    await onboard();
    const profile = readProjectProfile(projectRoot);
    expect(profile?.paqad).toEqual({ enabled: true });
  });

  it('preserves enterprise, RAG, and paqad.enabled (in .config) across a re-onboard', async () => {
    await onboard();

    // The team customizes their framework config in `.paqad/.config`.
    const profile = readProjectProfile(projectRoot);
    expect(profile).not.toBeNull();
    syncFrameworkConfig(projectRoot, {
      enterprise: {
        enabled: true,
        evidence_ledger: true,
        ai_bom: false,
        compliance_citations: false,
      },
      intelligence: { ...profile!.intelligence, rag_enabled: true },
      paqad: { enabled: false },
    });

    // A refresh must not touch `.config`, so none of it is reset.
    await onboard();

    const after = readProjectProfile(projectRoot);
    expect(after?.enterprise?.enabled).toBe(true);
    expect(after?.enterprise?.evidence_ledger).toBe(true);
    expect(after?.intelligence.rag_enabled).toBe(true);
    expect(after?.paqad?.enabled).toBe(false);
  });

  it('leaves the tracked config of a newer checkout byte-identical on a re-onboard', async () => {
    await onboard();
    const examplePath = join(projectRoot, '.paqad', '.config.example');
    const appPath = join(projectRoot, '.paqad', 'configs', '.config.app');
    const newerExample = generateConfigExample('999.0.0');
    const app = '# team header\nfuture_knob=on\n';
    writeFileSync(examplePath, newerExample);
    writeFileSync(appPath, app);

    await onboard();

    expect(readFileSync(examplePath, 'utf8')).toBe(newerExample);
    expect(readFileSync(appPath, 'utf8')).toBe(app);
  });
});
