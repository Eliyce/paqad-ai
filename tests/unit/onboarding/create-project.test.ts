import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FrameworkError } from '@/core/errors/index.js';
import { readProjectProfile } from '@/core/project-profile.js';
import {
  EMPTY_STACK_PROFILE,
  UNDECIDED_COMMANDS,
  UNDECIDED_STACK,
  createProjectWorkspace,
} from '@/onboarding/create-project.js';

/** Point onboarding's framework home at a throwaway dir for the duration of `fn`. */
async function withFrameworkHome<T>(fn: () => Promise<T>): Promise<T> {
  const frameworkHome = join(tmpdir(), `paqad-ai-home-${Date.now()}-${Math.random()}`);
  const originalHome = process.env.PAQAD_FRAMEWORK_HOME;
  process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
  try {
    return await fn();
  } finally {
    if (existsSync(frameworkHome)) rmSync(frameworkHome, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = originalHome;
    }
  }
}

describe('createProjectWorkspace', () => {
  it('exposes empty-stack constants that carry no framework default (ENT-02)', () => {
    expect(EMPTY_STACK_PROFILE.frameworks).toEqual([]);
    expect(EMPTY_STACK_PROFILE.traits).toEqual([]);
    // Every undecided command is a self-explaining placeholder, never a pnpm/react default.
    for (const command of Object.values(UNDECIDED_COMMANDS)) {
      expect(command).toContain('choose an application stack first');
      expect(command).not.toContain('pnpm');
    }
  });

  // Full onboarding is heavy (code-knowledge index + rule compile), so the read-only happy-path
  // assertions share ONE real creation rather than re-onboarding per test — this keeps the
  // Windows CI worker from being starved by a dozen back-to-back onboarding runs.
  describe('a freshly created undecided workspace (shared)', () => {
    let parentDir: string;
    let projectRoot: string;
    let result: Awaited<ReturnType<typeof createProjectWorkspace>>;

    beforeAll(async () => {
      parentDir = mkdtempSync(join(tmpdir(), 'paqad-ai-new-'));
      await withFrameworkHome(async () => {
        result = await createProjectWorkspace({ name: 'my-app', parentDir });
      });
      projectRoot = join(parentDir, 'my-app');
    });

    afterAll(() => {
      rmSync(parentDir, { recursive: true, force: true });
    });

    it('creates a framework workspace with an undecided stack and no application code (AC-1, INV-1)', () => {
      expect(result.projectRoot).toBe(projectRoot);
      expect(result.created).toBe(true);
      expect(result.stack).toBe(UNDECIDED_STACK);
      expect(result.generatedFiles.length).toBeGreaterThan(0);

      // Framework scaffolding exists…
      expect(existsSync(join(projectRoot, '.paqad/project-profile.yaml'))).toBe(true);
      expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);

      // …but no application source is ever created (INV-1).
      expect(existsSync(join(projectRoot, 'package.json'))).toBe(false);
      expect(existsSync(join(projectRoot, 'src'))).toBe(false);
      expect(existsSync(join(projectRoot, 'index.ts'))).toBe(false);
    });

    it('records no framework and no framework-specific commands (AC-4, INV-5)', () => {
      const profile = readProjectProfile(projectRoot);
      expect(profile).not.toBeNull();
      expect(profile!.stack_profile?.frameworks ?? []).toEqual([]);
      expect(profile!.project.id).toBe('my-app');
      // The commands are the undecided placeholders, NOT pnpm/react defaults.
      expect(profile!.commands.install).toContain('choose an application stack first');
      expect(profile!.commands.build).not.toContain('pnpm');
      expect(profile!.commands.dev).not.toContain('pnpm');
    });

    it('initializes git when the directory is not already inside a work tree (FR-8)', () => {
      expect(result.gitInitialized).toBe(true);
      expect(existsSync(join(projectRoot, '.git'))).toBe(true);
      expect(result.recovery).toBeUndefined();
    });
  });

  describe('creation behaviour', () => {
    let parentDir: string;

    beforeEach(() => {
      parentDir = mkdtempSync(join(tmpdir(), 'paqad-ai-new-'));
    });

    afterEach(() => {
      rmSync(parentDir, { recursive: true, force: true });
    });

    it('reruns on an already-created workspace without throwing, preserving work (AC-2)', async () => {
      const projectRoot = join(parentDir, 'rerun-app');
      // A prior creation already ran here: a `.paqad/` marks the rerun/resume path, and the owner
      // added their own file afterwards. One real onboarding run (the rerun) must preserve both.
      mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
      writeFileSync(join(projectRoot, 'NOTES.md'), 'keep me', 'utf8');

      const second = await withFrameworkHome(() =>
        createProjectWorkspace({ name: 'rerun-app', parentDir }),
      );
      expect(second.created).toBe(false);
      expect(second.preserved).toContain('.paqad');
      expect(existsSync(join(projectRoot, 'NOTES.md'))).toBe(true);
    });

    it('refuses to clobber a non-empty, non-paqad directory and writes nothing (AC-5)', async () => {
      const projectRoot = join(parentDir, 'occupied');
      mkdirSync(projectRoot, { recursive: true });
      writeFileSync(join(projectRoot, 'keep.txt'), 'user work', 'utf8');

      await expect(createProjectWorkspace({ name: 'occupied', parentDir })).rejects.toMatchObject({
        code: 'PROJECT_DIR_NOT_EMPTY',
      });

      // Nothing was written: the user's file survives and no `.paqad/` was created.
      expect(existsSync(join(projectRoot, 'keep.txt'))).toBe(true);
      expect(existsSync(join(projectRoot, '.paqad'))).toBe(false);
      expect(readdirSync(projectRoot)).toEqual(['keep.txt']);
    });

    it('overwrites a non-empty directory when force is set (ENT-03 escape hatch)', async () => {
      const projectRoot = join(parentDir, 'forced');
      mkdirSync(projectRoot, { recursive: true });
      writeFileSync(join(projectRoot, 'legacy.txt'), 'old', 'utf8');

      const result = await withFrameworkHome(() =>
        createProjectWorkspace({ name: 'forced', parentDir, force: true }),
      );

      expect(result.created).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad/project-profile.yaml'))).toBe(true);
    });

    it('resumes an interrupted creation and completes the remainder (AC-3)', async () => {
      const projectRoot = join(parentDir, 'resumed');
      // Simulate an interrupted first run: a partial `.paqad/` with a resume checkpoint present.
      mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
      writeFileSync(
        join(projectRoot, '.paqad/onboarding-checkpoint.json'),
        `${JSON.stringify({ schema_version: 1, written: [] }, null, 2)}\n`,
        'utf8',
      );

      // A `.paqad/` directory marks this as a rerun/resume rather than a clobber, so it must
      // not throw and must finish writing the full workspace.
      const result = await withFrameworkHome(() =>
        createProjectWorkspace({ name: 'resumed', parentDir }),
      );

      expect(result.created).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad/onboarding-manifest.json'))).toBe(true);
      expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
    });

    it('throws a FrameworkError (not a raw error) on the non-empty guard', async () => {
      const projectRoot = join(parentDir, 'guard');
      mkdirSync(projectRoot, { recursive: true });
      writeFileSync(join(projectRoot, 'x'), '', 'utf8');

      await expect(createProjectWorkspace({ name: 'guard', parentDir })).rejects.toBeInstanceOf(
        FrameworkError,
      );
    });

    it('preserves an existing repo and does not re-init inside a work tree (FR-8)', async () => {
      // Make the parent a git work tree, so a workspace created inside it is already tracked.
      execFileSync('git', ['init'], { cwd: parentDir, stdio: 'ignore' });

      const result = await withFrameworkHome(() =>
        createProjectWorkspace({ name: 'nested-app', parentDir }),
      );
      const projectRoot = join(parentDir, 'nested-app');

      expect(result.gitInitialized).toBe(false);
      // No new nested repo was created — the directory stays part of the parent work tree.
      expect(existsSync(join(projectRoot, '.git'))).toBe(false);
    });
  });
});
