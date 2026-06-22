import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TransitionLogManager } from '@/cache/transition-log.js';
import { HandoffWriter } from '@/session/handoff-writer.js';
import { checkBooleanGate, createFail, createPass, identity } from '@/verification/gates/shared.js';
import { ParallelExecutor } from '@/workflows/parallel-executor.js';
import { WorkflowTemplateValidator } from '@/workflows/template-validator.js';
import { ProjectQuestionPhase } from '@/pipeline/phases/question-answering.js';
import { RootCauseAnalysisPhase } from '@/pipeline/phases/root-cause-analysis.js';

const { mockOnboardingRun, mockPrintBanner, mockPrintNextSteps } = vi.hoisted(() => ({
  // The CLI hands phase-1 completion back via `onPhase1Complete` so the banner
  // (which now also carries the next-steps guidance) runs only after the
  // orchestrator has durably written every core `.paqad/**` artifact. The mock
  // honors that contract by invoking the callback once before resolving. See #62.
  mockOnboardingRun: vi.fn(
    async (options: { projectRoot: string; onPhase1Complete?: () => void }) => {
      options.onPhase1Complete?.();
    },
  ),
  mockPrintBanner: vi.fn(),
  mockPrintNextSteps: vi.fn(),
}));

vi.mock('@/onboarding/orchestrator.js', () => ({
  OnboardingOrchestrator: class {
    run = mockOnboardingRun;
  },
}));

vi.mock('@/cli/ui/banner.js', () => ({
  printBanner: mockPrintBanner,
  printNextSteps: mockPrintNextSteps,
}));

import { createOnboardCommand } from '@/cli/commands/onboard.js';

describe('coverage small branches', () => {
  describe('TransitionLogManager', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-transition-extra-'));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('returns an empty probability list when the stack has no entries', async () => {
      const manager = new TransitionLogManager(root);
      await expect(manager.computeProbabilities('missing', 'plan')).resolves.toEqual([]);
    });
  });

  describe('onboard command', () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('runs without explicit selections and writes next steps', async () => {
      const root = mkdtempSync(join(tmpdir(), 'paqad-onboard-'));
      const command = createOnboardCommand();

      await command.parseAsync(['node', 'onboard', '--project-root', root], { from: 'node' });

      expect(mockOnboardingRun).toHaveBeenCalledWith(
        expect.objectContaining({
          projectRoot: root,
          selections: undefined,
          onPhase1Complete: expect.any(Function),
        }),
      );
      expect(mockPrintBanner).toHaveBeenCalledOnce();
      // The next-steps guidance is delivered via the banner, not an on-disk file.
      expect(mockPrintNextSteps).toHaveBeenCalledOnce();

      rmSync(root, { recursive: true, force: true });
    });

    it('passes explicit stack, capability, and providers through to the orchestrator', async () => {
      const root = mkdtempSync(join(tmpdir(), 'paqad-onboard-'));
      const command = createOnboardCommand();

      await command.parseAsync(
        [
          'node',
          'onboard',
          '--project-root',
          root,
          '--stack',
          'laravel',
          '--capability',
          'boost',
          '--providers',
          'codex-cli',
          'claude-code',
        ],
        { from: 'node' },
      );

      expect(mockOnboardingRun).toHaveBeenLastCalledWith(
        expect.objectContaining({
          projectRoot: root,
          selections: {
            stack: 'laravel',
            capabilities: ['boost'],
            providers: ['codex-cli', 'claude-code'],
          },
          onPhase1Complete: expect.any(Function),
        }),
      );

      rmSync(root, { recursive: true, force: true });
    });
  });

  describe('HandoffWriter', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-handoff-'));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it('writes JSON, markdown, and stats with optional spec paths and zero-token compression fallback', async () => {
      vi.spyOn(await import('@/core/project-profile.js'), 'readProjectProfile').mockReturnValue(
        null,
      );

      const writer = new HandoffWriter(
        {
          summarize: vi
            .fn()
            .mockReturnValueOnce({
              summary: 'a',
              decisions: ['Use queue'],
              files_touched: ['src/a.ts'],
              blockers: ['Need approval'],
              next_steps: ['Ship'],
            })
            .mockReturnValueOnce({
              summary: 'b',
              decisions: ['Add retry'],
              files_touched: ['src/b.ts'],
              blockers: [],
              next_steps: ['Verify'],
            }),
        } as never,
        root,
      );

      const handoff = await writer.write(
        [
          { text: 'first', timestamp: '2026-03-28T10:00:00.000Z' },
          { text: 'second', timestamp: '2026-03-28T10:05:00.000Z' },
        ],
        'stack-hash',
        'session-1',
        {
          classification: 'implementation',
          description: 'Fix checkout',
          spec_path: 'docs/spec.md',
        },
        {
          spec_artifacts: ['docs/spec.md'],
          relevant_files: ['src/a.ts'],
          relevant_docs: ['docs/guide.md'],
        },
        0,
      );

      expect(handoff.retrieval).toEqual({ rag_enabled: false, embedding_provider: undefined });
      expect(handoff.compression_stats.compression_ratio).toBe(0);
      expect(readFileSync(join(root, '.paqad', 'session', 'handoff.md'), 'utf8')).toContain(
        '**Spec:** docs/spec.md',
      );
      expect(readFileSync(join(root, '.paqad', 'session', 'handoff-stats.json'), 'utf8')).toContain(
        '"session_id": "session-1"',
      );
    });
  });

  describe('verification shared helpers', () => {
    it('creates pass and fail gate results and reads context fields', () => {
      expect(checkBooleanGate('spec-review', true, 'ok', 'bad', 'fix')).toEqual({
        gate: 'spec-review',
        passed: true,
        detail: 'ok',
        remediation: undefined,
      });
      expect(createPass('implementation-review', 'done')).toEqual({
        gate: 'implementation-review',
        passed: true,
        detail: 'done',
      });
      expect(createFail('story-quality', 'bad', 'fix')).toEqual({
        gate: 'story-quality',
        passed: false,
        detail: 'bad',
        remediation: 'fix',
      });
      expect(identity('project_root')({ project_root: '/repo' } as never)).toBe('/repo');
    });
  });

  describe('WorkflowTemplateValidator', () => {
    it('validates empty templates, invalid steps, and parallel groups', () => {
      const validator = new WorkflowTemplateValidator();
      const available = new Set(['analyze', 'fix']);

      expect(validator.validate({ name: '', steps: [] } as never, available)).toEqual({
        valid: false,
        errors: ['Template must have a name', 'Template must have at least one step'],
      });

      const invalid = validator.validate(
        {
          name: 'demo',
          steps: [
            { skill: 'missing', on_failure: 'explode' },
            {
              parallel: [
                { skill: 'analyze', on_failure: 'retry' },
                { skill: 'missing', on_failure: 'explode' },
              ],
            },
          ],
        } as never,
        available,
      );

      expect(invalid.valid).toBe(false);
      expect(invalid.errors).toEqual(
        expect.arrayContaining([
          'Step 0: unknown skill "missing"',
          'Step 0: invalid on_failure value "explode"',
          'Step 1: unknown skill "missing" in parallel group',
          'Step 1: invalid on_failure value "explode"',
        ]),
      );
      expect(validator.isParallelGroup({ parallel: [] } as never)).toBe(true);
    });
  });

  describe('ParallelExecutor', () => {
    it('completes, retries, skips, and reports thrown failures', async () => {
      const stepExecutor = {
        execute: vi
          .fn()
          .mockResolvedValueOnce({ status: 'completed' })
          .mockResolvedValueOnce({ status: 'skipped' })
          .mockResolvedValueOnce({ status: 'failed', error: 'boom' })
          .mockResolvedValueOnce({ status: 'completed' })
          .mockRejectedValueOnce(new Error('thrown')),
      };
      const executor = new ParallelExecutor(stepExecutor as never);

      await expect(
        executor.execute({
          parallel: [{ skill: 'a' }, { skill: 'b' }],
        } as never),
      ).resolves.toEqual({
        results: [
          { skill: 'a', status: 'completed', error: undefined },
          { skill: 'b', status: 'skipped', error: undefined },
        ],
        overall: 'completed',
      });

      await expect(
        executor.execute({
          parallel: [{ skill: 'c' }],
          on_failure: 'retry',
        } as never),
      ).resolves.toEqual({
        results: [{ skill: 'c', status: 'completed', error: undefined }],
        overall: 'completed',
      });

      await expect(
        executor.execute({
          parallel: [{ skill: 'd' }],
          on_failure: 'skip',
        } as never),
      ).resolves.toEqual({
        results: [{ skill: 'unknown', status: 'failed', error: 'thrown' }],
        overall: 'skipped',
      });
    });
  });

  describe('pipeline phases', () => {
    it('handles project-question workflow and root-cause-analysis success/failure', async () => {
      const questionPhase = new ProjectQuestionPhase();
      await expect(
        questionPhase.execute({
          classification: { workflow: 'feature-development' },
          phases: [],
        } as never),
      ).resolves.toMatchObject({ summary: 'No project-question workflow requested' });
      await expect(
        questionPhase.execute({
          classification: { workflow: 'project-question' },
          phases: [],
          project_root: '/tmp/nonexistent',
        } as never),
      ).resolves.toMatchObject({
        status: 'pass',
        phase: 'question-answering',
      });

      const rcaPhase = new RootCauseAnalysisPhase();
      const rcaPhaseWithWorkflow = rcaPhase as RootCauseAnalysisPhase & {
        workflow: { run: ReturnType<typeof vi.fn> };
      };
      rcaPhaseWithWorkflow.workflow = {
        run: vi.fn().mockResolvedValue({ output_path: 'docs/rca.md' }),
      };
      await expect(
        rcaPhase.execute({
          project_root: '/repo',
          classification: { workflow: 'root-cause-analysis' },
          phases: [],
        } as never),
      ).resolves.toMatchObject({
        status: 'pass',
        artifacts: ['docs/rca.md'],
      });

      rcaPhaseWithWorkflow.workflow = {
        run: vi.fn().mockRejectedValue(new Error('rca failed')),
      };
      await expect(
        rcaPhase.execute({
          project_root: '/repo',
          classification: { workflow: 'root-cause-analysis' },
          phases: [],
        } as never),
      ).resolves.toMatchObject({
        status: 'fail',
        summary: 'rca failed',
      });
    });
  });
});
