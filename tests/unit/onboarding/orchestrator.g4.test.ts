import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';

const { join } = posix;

import { PATHS } from '@/core/constants/paths.js';
import { FrameworkError } from '@/core/errors/index.js';
import { OnboardingOrchestrator } from '@/onboarding';
import { readOnboardingCheckpoint, writeOnboardingCheckpoint } from '@/onboarding/checkpoint.js';
import { MANAGED_HEADER } from '@/onboarding/decision-pause-contract-writer.js';
import { RagService } from '@/rag/service.js';

import { useOrchestratorSandbox } from './orchestrator-harness.js';

describe('OnboardingOrchestrator', () => {
  let projectRoot: string;

  useOrchestratorSandbox((sandbox) => {
    ({ projectRoot } = sandbox);
  });

  describe('PQD-424 — generate baseline docs and configs', () => {
    const selections = { domain: 'coding', stack: 'laravel', capabilities: [] } as const;

    it('does not create the deprecated .paqad/version, classifier-config, or next-steps', async () => {
      await new OnboardingOrchestrator().run({ projectRoot, selections });

      expect(existsSync(join(projectRoot, '.paqad/version'))).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad/classifier-config.json'))).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad/next-steps.md'))).toBe(false);
    });

    it('writes a tracked manifest with no churning framework_version field', async () => {
      await new OnboardingOrchestrator().run({ projectRoot, selections });

      const manifest = JSON.parse(
        readFileSync(join(projectRoot, PATHS.ONBOARDING_MANIFEST), 'utf8'),
      ) as Record<string, unknown>;
      expect(manifest).not.toHaveProperty('framework_version');
      expect(manifest).toHaveProperty('adapter');
      expect(manifest).toHaveProperty('generated_artifacts');
    });

    it('writes a project.onboarded audit line with project_id, wizard_version and steps_completed', async () => {
      await new OnboardingOrchestrator().run({ projectRoot, selections });

      const auditLog = readFileSync(join(projectRoot, PATHS.AUDIT_LOG), 'utf8');
      expect(auditLog).toContain('project.onboarded');
      expect(auditLog).toMatch(/project_id="[^"]+"/);
      expect(auditLog).toMatch(/wizard_version="[^"]+"/);
      expect(auditLog).toMatch(/steps_completed="\d+"/);
    });

    it('emits the project.onboarded audit line only once, not on a refresh re-run', async () => {
      const orchestrator = new OnboardingOrchestrator();
      await orchestrator.run({ projectRoot, selections });
      await orchestrator.run({ projectRoot, selections });

      const occurrences = readFileSync(join(projectRoot, PATHS.AUDIT_LOG), 'utf8')
        .split('\n')
        .filter((line) => line.includes('project.onboarded')).length;
      expect(occurrences).toBe(1);
    });

    it('refuses cleanly without touching disk when project creation is disabled', async () => {
      await expect(
        new OnboardingOrchestrator().run({
          projectRoot,
          selections,
          workspacePolicy: { project_creation_disabled: true },
        }),
      ).rejects.toMatchObject({ code: 'PROJECT_CREATION_DISABLED' });

      expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad/project-profile.yaml'))).toBe(false);
    });

    it('blocks with REGISTRY_CORRUPTED when the existing manifest is corrupt', async () => {
      mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
      writeFileSync(join(projectRoot, PATHS.ONBOARDING_MANIFEST), '{ not valid json');

      await expect(
        new OnboardingOrchestrator().run({ projectRoot, selections }),
      ).rejects.toBeInstanceOf(FrameworkError);
      await expect(
        new OnboardingOrchestrator().run({ projectRoot, selections }),
      ).rejects.toMatchObject({ code: 'REGISTRY_CORRUPTED' });
    });

    it('wires a managed entry stub into a pre-existing CLAUDE.md on a re-run, but forceOverwrite regenerates it', async () => {
      await new OnboardingOrchestrator().run({ projectRoot, selections });

      const claudePath = join(projectRoot, 'CLAUDE.md');
      writeFileSync(claudePath, '# user-customised entry\n');

      await new OnboardingOrchestrator().run({ projectRoot, selections });
      const rewired = readFileSync(claudePath, 'utf8');
      expect(rewired).toContain('# user-customised entry');
      expect(rewired).toContain('paqad-ai managed entry stub');
      expect(rewired).toContain('.paqad/framework-path.txt');
      expect(rewired).toContain('AGENT-BOOTSTRAP.md');

      await new OnboardingOrchestrator().run({ projectRoot, selections });
      const reonboarded = readFileSync(claudePath, 'utf8');
      expect(reonboarded).toBe(rewired);
      expect(reonboarded.split('paqad-ai managed entry stub (do').length - 1).toBe(1);

      await new OnboardingOrchestrator().run({ projectRoot, selections, forceOverwrite: true });
      const regenerated = readFileSync(claudePath, 'utf8');
      expect(regenerated).not.toBe('# user-customised entry\n');
      expect(regenerated).toContain('.paqad/framework-path.txt');
      expect(regenerated).toContain('AGENT-BOOTSTRAP.md');
      expect(regenerated).not.toContain('create documentation');
      expect(regenerated).not.toContain('docs/instructions');
      expect(regenerated).not.toContain('## Decision Pause Contract');
    });

    it('does not wire an entry stub into a pre-existing entry file when paqad is disabled', async () => {
      const claudePath = join(projectRoot, 'CLAUDE.md');
      writeFileSync(claudePath, '# Laravel Boost\n\nBoost-authored content.\n');

      await new OnboardingOrchestrator().run({
        projectRoot,
        selections,
        profileOverrides: { paqad: { enabled: false } },
      });

      const after = readFileSync(claudePath, 'utf8');
      expect(after).toBe('# Laravel Boost\n\nBoost-authored content.\n');
      expect(after).not.toContain('paqad-ai managed entry stub');
      expect(after).not.toContain('.paqad/framework-path.txt');
    });

    it('resumes from a checkpoint, skipping already-written files and producing the remainder', async () => {
      mkdirSync(join(projectRoot, '.claude'), { recursive: true });
      const cachePath = join(projectRoot, '.claude/cache.json');
      writeFileSync(cachePath, '{"sentinel":true}');
      writeOnboardingCheckpoint(projectRoot, ['.claude/cache.json']);

      const output = await new OnboardingOrchestrator().run({ projectRoot, selections });

      expect(readFileSync(cachePath, 'utf8')).toBe('{"sentinel":true}');
      expect(output.generated_files).not.toContain('.claude/cache.json');
      expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
      expect(readOnboardingCheckpoint(projectRoot)).toBeNull();
    });

    it('translates an ENOSPC disk-full error into a clean DISK_FULL FrameworkError', async () => {
      const fileWriter = await import('@/onboarding/file-writer.js');
      const spy = vi.spyOn(fileWriter, 'writeGeneratedFiles').mockImplementation(() => {
        const error = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
        error.code = 'ENOSPC';
        throw error;
      });

      try {
        await expect(
          new OnboardingOrchestrator().run({ projectRoot, selections }),
        ).rejects.toMatchObject({ code: 'DISK_FULL', retryable: true });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('phase 1 / phase 2 invariants', () => {
    const CORE_PHASE1_ARTIFACTS = [
      '.paqad/project-profile.yaml',
      '.paqad/detection-report.json',
      '.paqad/framework-version.txt',
      '.paqad/framework-path.txt',
      '.paqad/onboarding-manifest.json',
      '.paqad/compiled-rules.json',
      'CLAUDE.md',
    ];

    it('writes every core artifact before onPhase1Complete fires', async () => {
      const presentAtCallback: Record<string, boolean> = {};

      await new OnboardingOrchestrator().run({
        projectRoot,
        selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
        onPhase1Complete: () => {
          for (const artifact of CORE_PHASE1_ARTIFACTS) {
            presentAtCallback[artifact] = existsSync(join(projectRoot, artifact));
          }
        },
      });

      for (const artifact of CORE_PHASE1_ARTIFACTS) {
        expect(presentAtCallback[artifact]).toBe(true);
      }
    });

    it('keeps every core artifact on disk even when the RAG phase throws', async () => {
      vi.spyOn(RagService.prototype, 'configureAndBuild').mockRejectedValue(
        new Error('synthetic RAG failure'),
      );
      vi.spyOn(RagService.prototype, 'hasApiKey').mockReturnValue(true);

      const output = await new OnboardingOrchestrator().run({
        projectRoot,
        selections: {
          domain: 'coding',
          stack: 'laravel',
          capabilities: [],
          rag: { enabled: true, provider: 'local' },
        },
      });

      for (const artifact of CORE_PHASE1_ARTIFACTS) {
        expect(existsSync(join(projectRoot, artifact))).toBe(true);
      }
      expect(output.warnings.some((w) => w.includes('synthetic RAG failure'))).toBe(true);
    });

    it('finishes phase 1 even when the RAG resolver itself rejects', async () => {
      const ragModule = await import('@/onboarding/rag-onboarding.js');
      vi.spyOn(ragModule, 'resolveRagSelection').mockRejectedValue(
        new Error('synthetic RAG prompt failure'),
      );

      let phase1Reached = false;
      let phase1Output: { generated_files: string[] } | undefined;

      await new OnboardingOrchestrator()
        .run({
          projectRoot,
          selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
          onPhase1Complete: (output) => {
            phase1Reached = true;
            phase1Output = output;
          },
        })
        .catch(() => undefined);

      expect(phase1Reached).toBe(true);
      expect(phase1Output?.generated_files).toContain('CLAUDE.md');
      for (const artifact of CORE_PHASE1_ARTIFACTS) {
        expect(existsSync(join(projectRoot, artifact))).toBe(true);
      }
    });

    it('does not write the decision-pause or narration contract docs into the project', async () => {
      const output = await new OnboardingOrchestrator().run({
        projectRoot,
        selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
      });

      expect(existsSync(join(projectRoot, '.paqad/decision-pause-contract.md'))).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad/narration-contract.md'))).toBe(false);
      expect(output.generated_files).not.toContain('.paqad/decision-pause-contract.md');
      expect(output.generated_files).not.toContain('.paqad/narration-contract.md');
    });

    it('prunes a pre-existing managed decision-pause contract doc on re-onboard', async () => {
      const selections = { domain: 'coding', stack: 'laravel', capabilities: [] } as const;
      await new OnboardingOrchestrator().run({ projectRoot, selections });

      const contractPath = join(projectRoot, '.paqad/decision-pause-contract.md');
      writeFileSync(contractPath, `${MANAGED_HEADER}\n\n# Decision Pause Contract\n`);
      expect(existsSync(contractPath)).toBe(true);

      await new OnboardingOrchestrator().run({ projectRoot, selections });

      expect(existsSync(contractPath)).toBe(false);
    });

    it('leaves a non-managed file at the contract path untouched on re-onboard', async () => {
      const selections = { domain: 'coding', stack: 'laravel', capabilities: [] } as const;
      await new OnboardingOrchestrator().run({ projectRoot, selections });

      const contractPath = join(projectRoot, '.paqad/decision-pause-contract.md');
      writeFileSync(contractPath, '# team-owned notes, not paqad managed\n');

      await new OnboardingOrchestrator().run({ projectRoot, selections });

      expect(readFileSync(contractPath, 'utf8')).toBe('# team-owned notes, not paqad managed\n');
    });
  });
});
