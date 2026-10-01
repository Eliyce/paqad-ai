import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { syncFrameworkConfig } from '@/core/framework-config.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { createProjectWorkspace } from '@/onboarding/create-project.js';

// INV-6 — re-onboarding a created-then-configured project preserves team-owned settings through
// the orchestrator's existing config-preservation. This is a regression guard, not new behaviour:
// framework knobs live in `.paqad/.config`, which creation (via the orchestrator) never touches.
describe('createProjectWorkspace preserves team-owned config on rerun (INV-6)', () => {
  let parentDir: string;
  let frameworkHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'paqad-preserve-'));
    frameworkHome = join(tmpdir(), `paqad-preserve-home-${Date.now()}-${Math.random()}`);
    originalHome = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
  });

  afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true });
    if (existsSync(frameworkHome)) rmSync(frameworkHome, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = originalHome;
    }
  });

  it('keeps a team edit to framework config across a creation rerun', async () => {
    const first = await createProjectWorkspace({ name: 'team-proj', parentDir });
    expect(first.created).toBe(true);
    const projectRoot = join(parentDir, 'team-proj');

    // The team customizes their framework config (the team-owned `.paqad/.config` layer).
    syncFrameworkConfig(projectRoot, {
      enterprise: {
        enabled: true,
        evidence_ledger: true,
        ai_bom: false,
        compliance_citations: false,
      },
      intelligence: { ...readProjectProfile(projectRoot)!.intelligence, rag_enabled: true },
    });

    // A rerun is a refresh, not a reset — it must not clobber the team's config.
    const second = await createProjectWorkspace({ name: 'team-proj', parentDir });
    expect(second.created).toBe(false);

    const after = readProjectProfile(projectRoot);
    expect(after?.enterprise?.enabled).toBe(true);
    expect(after?.enterprise?.evidence_ledger).toBe(true);
    expect(after?.intelligence.rag_enabled).toBe(true);
  });
});
