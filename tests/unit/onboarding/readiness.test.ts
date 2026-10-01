import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';
import { createProjectWorkspace } from '@/onboarding/create-project.js';
import { verifyReadinessToDevelop } from '@/onboarding/readiness.js';

// FR-7 — after installation and onboarding, creation verifies readiness to develop before
// declaring setup complete. An undecided workspace is honestly NOT ready.
describe('verifyReadinessToDevelop (FR-7)', () => {
  let parentDir: string;
  let frameworkHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'paqad-readiness-'));
    frameworkHome = join(tmpdir(), `paqad-readiness-home-${Date.now()}-${Math.random()}`);
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

  it('reports an undecided workspace as NOT ready with the undecided blocker', async () => {
    await createProjectWorkspace({ name: 'undecided-proj', parentDir });
    const projectRoot = join(parentDir, 'undecided-proj');

    const result = verifyReadinessToDevelop(projectRoot);

    expect(result.ready).toBe(false);
    expect(result.checks.commandsConfigured).toBe(false);
    expect(result.blockers).toContain('application stack still undecided');
  });

  it('reports ready once real commands and non-empty module docs exist', async () => {
    await createProjectWorkspace({ name: 'ready-proj', parentDir });
    const projectRoot = join(parentDir, 'ready-proj');

    // The owner chose a stack: real commands replace the undecided placeholders…
    const profile = readProjectProfile(projectRoot)!;
    profile.commands = {
      ...profile.commands,
      install: 'pnpm install',
      dev: 'pnpm dev',
      build: 'pnpm build',
      test: 'pnpm test',
    };
    writeProjectProfile(projectRoot, profile);

    // …and module documentation now exists.
    const modulesDir = join(projectRoot, PATHS.MODULES_DIR);
    mkdirSync(modulesDir, { recursive: true });
    writeFileSync(join(modulesDir, 'core.md'), '# Core module\n', 'utf8');

    const result = verifyReadinessToDevelop(projectRoot);

    expect(result.ready).toBe(true);
    expect(result.checks).toEqual({ commandsConfigured: true, moduleDocsPresent: true });
    expect(result.blockers).toEqual([]);
  });

  it('flags missing module docs even when commands are configured', async () => {
    await createProjectWorkspace({ name: 'nodocs-proj', parentDir });
    const projectRoot = join(parentDir, 'nodocs-proj');

    const profile = readProjectProfile(projectRoot)!;
    profile.commands = {
      ...profile.commands,
      dev: 'pnpm dev',
      build: 'pnpm build',
      test: 'pnpm test',
    };
    writeProjectProfile(projectRoot, profile);
    rmSync(join(projectRoot, PATHS.MODULES_DIR), { recursive: true, force: true });

    const result = verifyReadinessToDevelop(projectRoot);

    expect(result.ready).toBe(false);
    expect(result.checks.commandsConfigured).toBe(true);
    expect(result.checks.moduleDocsPresent).toBe(false);
    expect(result.blockers.some((line) => line.includes('module documentation missing'))).toBe(
      true,
    );
  });

  it('treats a non-directory docs/modules as absent module docs', async () => {
    await createProjectWorkspace({ name: 'badmod-proj', parentDir });
    const projectRoot = join(parentDir, 'badmod-proj');

    // docs/modules is a FILE, not a directory — readdirSync throws, which must read as "absent".
    const modulesPath = join(projectRoot, PATHS.MODULES_DIR);
    rmSync(modulesPath, { recursive: true, force: true });
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(modulesPath, 'not a directory', 'utf8');

    expect(verifyReadinessToDevelop(projectRoot).checks.moduleDocsPresent).toBe(false);
  });

  it('reports NOT ready with a clear blocker when no profile exists', () => {
    const bare = mkdtempSync(join(tmpdir(), 'paqad-readiness-bare-'));
    try {
      const result = verifyReadinessToDevelop(bare);
      expect(result.ready).toBe(false);
      expect(result.checks.commandsConfigured).toBe(false);
      expect(result.blockers.some((line) => line.includes('no project profile found'))).toBe(true);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
