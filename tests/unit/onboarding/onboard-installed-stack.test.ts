import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FrameworkError } from '@/core/errors/index.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';
import { createProjectWorkspace } from '@/onboarding/create-project.js';
import { onboardInstalledStack } from '@/onboarding/onboard-installed-stack.js';

describe('onboardInstalledStack (SET-03/SET-05)', () => {
  let templateRoot: string;
  let frameworkHome: string;
  let parentDir: string;
  let originalHome: string | undefined;

  beforeAll(async () => {
    const templateParent = mkdtempSync(join(tmpdir(), 'paqad-onboard-tpl-'));
    frameworkHome = join(tmpdir(), `paqad-onboard-home-${Date.now()}-${Math.random()}`);
    originalHome = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
    try {
      await createProjectWorkspace({ name: 'template-proj', parentDir: templateParent });
      templateRoot = join(templateParent, 'template-proj');
    } finally {
      restoreHome();
    }
  });

  afterAll(() => {
    if (templateRoot) rmSync(join(templateRoot, '..'), { recursive: true, force: true });
    if (frameworkHome && existsSync(frameworkHome)) {
      rmSync(frameworkHome, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'paqad-onboard-'));
  });

  afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true });
    restoreHome();
  });

  function restoreHome(): void {
    if (originalHome === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = originalHome;
    }
  }

  function freshWorkspace(name: string): string {
    const projectRoot = join(parentDir, name);
    cpSync(templateRoot, projectRoot, { recursive: true });
    return projectRoot;
  }

  it('throws a clear error when the directory is not a paqad workspace', async () => {
    const bare = join(parentDir, 'bare');

    await expect(onboardInstalledStack({ projectRoot: bare })).rejects.toThrowError(FrameworkError);
    await expect(onboardInstalledStack({ projectRoot: bare })).rejects.toThrow(
      /No paqad workspace/,
    );
  });

  it('refuses to onboard when no application framework is detected (ENT-02), leaving the workspace undecided', async () => {
    const projectRoot = freshWorkspace('still-empty');

    const result = await onboardInstalledStack({ projectRoot });

    expect(result.onboarded).toBe(false);
    expect(result.detectedFrameworks).toEqual([]);
    expect(result.commandsRederived).toBe(false);
    expect(result.recovery).toMatch(/No application framework detected/);
    expect(result.providers).toEqual(['claude-code']);

    const profile = readProjectProfile(projectRoot)!;
    expect(profile.commands.dev).toContain('choose an application stack first');
  });

  it('falls back to claude-code when the workspace has no onboarding manifest', async () => {
    const projectRoot = freshWorkspace('no-manifest');
    rmSync(join(projectRoot, '.paqad', 'onboarding-manifest.json'), { force: true });

    const result = await onboardInstalledStack({ projectRoot });

    expect(result.onboarded).toBe(false);
    expect(result.providers).toEqual(['claude-code']);
  });

  it('re-derives real commands from the installed stack and preserves team-owned settings (SET-03/SET-05, INV-6)', async () => {
    const projectRoot = freshWorkspace('with-react');

    writeFileSync(
      join(projectRoot, 'package.json'),
      `${JSON.stringify(
        { name: 'with-react', private: true, dependencies: { react: '^19.0.0' } },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const before = readProjectProfile(projectRoot)!;
    before.project = { ...before.project, description: 'owner-authored description' };
    writeProjectProfile(projectRoot, before);

    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
    const result = await onboardInstalledStack({ projectRoot, providers: ['claude-code'] });

    expect(result.onboarded).toBe(true);
    expect(result.detectedFrameworks).toContain('react');
    expect(result.commandsRederived).toBe(true);

    const after = readProjectProfile(projectRoot)!;
    expect(after.commands.dev).not.toContain('choose an application stack first');
    expect(after.stack_profile?.frameworks ?? []).toContain('react');
    expect(after.project.description).toBe('owner-authored description');

    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
    const second = await onboardInstalledStack({ projectRoot, providers: ['claude-code'] });
    expect(second.onboarded).toBe(true);
    expect(second.commandsRederived).toBe(false);
    expect(readProjectProfile(projectRoot)!.commands.dev).toBe(after.commands.dev);
  });
});
