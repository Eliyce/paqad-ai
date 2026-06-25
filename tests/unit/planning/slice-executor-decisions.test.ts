import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

const { mockPromptForDecision, mockPromptForMalformedDecision } = vi.hoisted(() => ({
  mockPromptForDecision: vi.fn(),
  mockPromptForMalformedDecision: vi.fn(),
}));

vi.mock('@/cli/ui/decision-screen.js', () => ({
  promptForDecision: mockPromptForDecision,
  promptForMalformedDecision: mockPromptForMalformedDecision,
}));

import { PATHS } from '@/core/constants/paths.js';
import { syncFrameworkConfig } from '@/core/framework-config.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import { EngineEventBus, type EngineEvent } from '@/event-bus/index.js';
import { DecisionStore, readDecisionAuditEvents, SliceExecutor } from '@/planning/index.js';

import { createManifest } from './fixtures.js';

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Issue #184 — minted decision ids are now opaque ULIDs (`D-<ULID>`), not the
// old predictable `D-2`/`D-3`. Tests derive the id from disk/events instead of
// hardcoding it. Ids returned sorted, which is chronological for ULIDs.
const ULID_DECISION_ID = /^D-[0-9A-HJKMNP-TV-Z]{26}$/;

function decisionIdsIn(root: string, relativeDir: string): string[] {
  const dir = join(root, relativeDir);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => /^D-.*\.json$/.test(file))
        .map((file) => file.replace(/\.json$/, ''))
        .sort()
    : [];
}

describe('slice executor decision flow', () => {
  beforeEach(() => {
    mockPromptForDecision.mockReset();
    mockPromptForMalformedDecision.mockReset();
  });

  it('writes and resolves a decision packet before executing the slice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-flow-'));
    try {
      mockPromptForDecision.mockResolvedValue({
        chosen_option_key: 'reuse-existing',
        intent: 'explicit',
        explanation_rounds_used: 1,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      });

      const manifest = createManifest({
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we reuse existing code or create new support?',
            touches: ['src/planning/index.ts'],
          },
        ],
      });

      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
      writeStrictProfile(root);
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: vi.fn().mockImplementation(async ({ context }) => {
          expect(
            context.decision_context.some((decision) =>
              ULID_DECISION_ID.test(decision.decision_id),
            ),
          ).toBe(true);
          return {
            tokens_used: 10,
            files_changed: ['src/planning/index.ts'],
            change_summary: 'updated existing file',
          };
        }),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(result.completedSliceIds).toEqual(['SL-1']);
      expect(mockPromptForDecision).toHaveBeenCalledTimes(1);
      expect(decisionIdsIn(root, PATHS.DECISIONS_RESOLVED_DIR)).toHaveLength(1);

      const savedManifest = YAML.parse(
        readFileSync(join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`), 'utf8'),
      ) as { decision_log: Array<{ decision_id: string }> };
      expect(
        savedManifest.decision_log.some((decision) => ULID_DECISION_ID.test(decision.decision_id)),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves high-confidence forks without prompting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-auto-'));
    try {
      mockPromptForDecision.mockReset();

      const manifest = createManifest({
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we reuse existing code or create new support?',
            touches: ['src/planning/index.ts'],
          },
        ],
      });

      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: vi.fn().mockImplementation(async ({ context }) => ({
          tokens_used: 10,
          files_changed: context.current_slice.touches,
          change_summary: 'updated existing file',
        })),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(result.completedSliceIds).toEqual(['SL-1']);
      expect(mockPromptForDecision).not.toHaveBeenCalled();
      expect(decisionIdsIn(root, PATHS.DECISIONS_RESOLVED_DIR)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('only resumes pending decisions for the current task session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-resume-'));
    try {
      mockPromptForDecision.mockResolvedValue({
        chosen_option_key: 'reuse-existing',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      });

      const manifest = createManifest();
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );
      mkdirSync(join(root, '.paqad/decisions/pending'), { recursive: true });
      writeFileSync(
        join(root, '.paqad/decisions/pending/D-9.json'),
        JSON.stringify({
          decision_id: 'D-9',
          fingerprint: 'sha256:resume',
          category: 'create-vs-reuse',
          question: 'Use what exists or make new?',
          context: 'Resume another task.',
          options: [
            {
              option_key: 'reuse-existing',
              label: 'Reuse what exists',
              one_line_preview: 'If you pick this, we will update src/planning/index.ts.',
              trade_off: 'You give up: a blank-slate implementation.',
              evidence: { file: 'src/planning/index.ts', callers: 1, evidence_partial: true },
            },
            {
              option_key: 'make-new',
              label: 'Make a new one',
              one_line_preview: 'If you pick this, we will create src/planning/new-index.ts.',
              trade_off: 'You give up: the shared path that already exists.',
              evidence: { file: 'src/planning/new-index.ts', callers: 0, evidence_partial: true },
            },
          ],
          recommendation: 'reuse-existing',
          recommendation_reason: 'It is cheaper than starting from scratch.',
          confidence: 0.2,
          requested_by: 'codex-cli',
          task_session_id: 'another-session',
          created_at: '2026-04-27T12:00:00Z',
          status: 'pending',
          ttl_until: '2099-12-31T12:00:00Z',
          invalidation_watch: ['src/planning/index.ts'],
        }),
        'utf8',
      );

      const resume = await new SliceExecutor().resume(root, manifest.slug);

      expect(resume.currentSliceId).toBe('SL-1');
      expect(mockPromptForDecision).not.toHaveBeenCalled();
      expect(existsSync(join(root, '.paqad/decisions/pending/D-9.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rebuilds a stale pending decision when repo state changes during the pause', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-rebuild-'));
    try {
      mockPromptForDecision.mockResolvedValue({
        chosen_option_key: 'reuse-existing',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      });

      const manifest = createManifest({
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we reuse existing code or create new support?',
            touches: ['src/planning/index.ts'],
          },
        ],
      });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 2;\n', 'utf8');
      writeStrictProfile(root);
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );
      mkdirSync(join(root, '.paqad/decisions/pending'), { recursive: true });
      writeFileSync(
        join(root, '.paqad/decisions/pending/D-9.json'),
        JSON.stringify({
          decision_id: 'D-9',
          fingerprint: 'sha256:old',
          category: 'create-vs-reuse',
          question: 'Use what exists or make new?',
          context: 'Old pause.',
          options: [
            {
              option_key: 'reuse-existing',
              label: 'Reuse what exists',
              one_line_preview: 'If you pick this, we will update src/planning/index.ts.',
              trade_off: 'You give up: a blank-slate implementation.',
              evidence: { file: 'src/planning/index.ts', callers: 1, evidence_partial: true },
            },
            {
              option_key: 'make-new',
              label: 'Make a new one',
              one_line_preview: 'If you pick this, we will create src/planning/new-index.ts.',
              trade_off: 'You give up: the shared path that already exists.',
              evidence: { file: 'src/planning/new-index.ts', callers: 0, evidence_partial: true },
            },
          ],
          recommendation: 'reuse-existing',
          recommendation_reason: 'Old answer.',
          confidence: 0.2,
          requested_by: 'codex-cli',
          task_session_id: manifest.slug,
          created_at: '2026-04-01T12:00:00Z',
          status: 'pending',
          ttl_until: '2099-12-31T12:00:00Z',
          invalidation_watch: ['src/planning/index.ts'],
        }),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: vi.fn().mockResolvedValue({
          tokens_used: 10,
          files_changed: ['src/planning/index.ts'],
          change_summary: 'updated existing file',
        }),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(result.completedSliceIds).toEqual(['SL-1']);
      expect(mockPromptForDecision).toHaveBeenCalledTimes(1);
      const resolved = JSON.parse(
        readFileSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, 'D-9.json'), 'utf8'),
      ) as { fingerprint: string };
      expect(resolved.fingerprint).not.toBe('sha256:old');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back cleanly when a pending file is malformed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-malformed-'));
    try {
      mockPromptForMalformedDecision.mockResolvedValue('continue');
      mockPromptForDecision.mockResolvedValue({
        chosen_option_key: 'reuse-existing',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      });

      const manifest = createManifest({
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we reuse existing code or create new support?',
            touches: ['src/planning/index.ts'],
          },
        ],
      });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeStrictProfile(root);
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );
      mkdirSync(join(root, '.paqad/decisions/pending'), { recursive: true });
      writeFileSync(join(root, '.paqad/decisions/pending/D-9.json'), '{bad', 'utf8');

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: vi.fn().mockResolvedValue({
          tokens_used: 10,
          files_changed: ['src/planning/index.ts'],
          change_summary: 'updated existing file',
        }),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(result.completedSliceIds).toEqual(['SL-1']);
      expect(mockPromptForMalformedDecision).toHaveBeenCalledTimes(1);
      expect(existsSync(join(root, PATHS.DECISIONS_PENDING_DIR, 'D-9.json'))).toBe(false);
      expect(existsSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, 'D-9.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes a handoff when a pending decision has been idle past the configured timeout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-idle-'));
    try {
      mockPromptForDecision.mockResolvedValue({
        chosen_option_key: 'reuse-existing',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      });

      const manifest = createManifest({
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we reuse existing code or create new support?',
            touches: ['src/planning/index.ts'],
          },
        ],
      });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeIdleProfile(root);
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );
      mkdirSync(join(root, '.paqad/decisions/pending'), { recursive: true });
      writeFileSync(
        join(root, '.paqad/decisions/pending/D-9.json'),
        JSON.stringify({
          decision_id: 'D-9',
          fingerprint: 'sha256:old',
          category: 'create-vs-reuse',
          question: 'Use what exists or make new?',
          context: 'Idle pause.',
          options: [
            {
              option_key: 'reuse-existing',
              label: 'Reuse what exists',
              one_line_preview: 'If you pick this, we will update src/planning/index.ts.',
              trade_off: 'You give up: a blank-slate implementation.',
              evidence: { file: 'src/planning/index.ts', callers: 1, evidence_partial: true },
            },
            {
              option_key: 'make-new',
              label: 'Make a new one',
              one_line_preview: 'If you pick this, we will create src/planning/new-index.ts.',
              trade_off: 'You give up: the shared path that already exists.',
              evidence: { file: 'src/planning/new-index.ts', callers: 0, evidence_partial: true },
            },
          ],
          recommendation: 'reuse-existing',
          recommendation_reason: 'Old answer.',
          confidence: 0.2,
          requested_by: 'codex-cli',
          task_session_id: manifest.slug,
          created_at: '2026-04-01T12:00:00Z',
          status: 'pending',
          ttl_until: '2099-12-31T12:00:00Z',
          invalidation_watch: ['src/planning/index.ts'],
        }),
        'utf8',
      );

      await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: vi.fn().mockResolvedValue({
          tokens_used: 10,
          files_changed: ['src/planning/index.ts'],
          change_summary: 'updated existing file',
        }),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      const handoff = JSON.parse(
        readFileSync(join(root, '.paqad/session/handoff.json'), 'utf8'),
      ) as { active_task: { description: string } };
      expect(handoff.active_task.description).toContain('Pending decision');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies a task carry-over only within the current task and matching category', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-task-carry-over-'));
    try {
      mockPromptForDecision.mockResolvedValue({
        chosen_option_key: 'reuse-existing',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'task',
      });

      const baseSlice = createManifest().execution_slices[0];
      const manifest = createManifest({
        execution_slices: [
          {
            ...baseSlice,
            goal: 'Should we reuse existing code or create new support?',
            slice_id: 'SL-1',
            touches: ['src/planning/index.ts'],
          },
          {
            ...baseSlice,
            goal: 'Should we reuse existing code or create new support for the next step?',
            slice_id: 'SL-2',
            covers: ['FR-1', 'AC-2'],
            touches: ['src/planning/next.ts'],
          },
        ],
      });

      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeStrictProfile(root);
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
      writeFileSync(join(root, 'src/planning/next.ts'), 'export const next = 1;\n', 'utf8');
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: vi.fn().mockResolvedValue({
          tokens_used: 10,
          files_changed: ['src/planning/index.ts'],
          change_summary: 'updated existing file',
        }),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(result.completedSliceIds).toEqual(['SL-1', 'SL-2']);
      expect(mockPromptForDecision).toHaveBeenCalledTimes(1);
      // The carry-over decision is the second (latest) resolved packet.
      const carryOverId = decisionIdsIn(root, PATHS.DECISIONS_RESOLVED_DIR).at(-1);
      const resolved = JSON.parse(
        readFileSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${carryOverId}.json`), 'utf8'),
      ) as { human_response: { note: string } };
      expect(resolved.human_response.note).toContain('Applied carry-over preference');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies a session carry-over across tasks in the same process and does not persist it across executor instances', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-session-carry-over-'));
    try {
      mockPromptForDecision.mockResolvedValue({
        chosen_option_key: 'reuse-existing',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'session',
      });

      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeStrictProfile(root);
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
      writeFileSync(join(root, 'src/planning/task-two.ts'), 'export const taskTwo = 1;\n', 'utf8');
      writeFileSync(
        join(root, 'src/planning/task-three.ts'),
        'export const taskThree = 1;\n',
        'utf8',
      );

      const firstManifest = createManifest({
        slug: 'task-one',
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we reuse existing code or create new support?',
            touches: ['src/planning/index.ts'],
          },
        ],
      });
      const secondManifest = createManifest({
        slug: 'task-two',
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we reuse existing code or create new support in task two?',
            touches: ['src/planning/task-two.ts'],
          },
        ],
      });
      const thirdManifest = createManifest({
        slug: 'task-three',
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we reuse existing code or create new support in task three?',
            touches: ['src/planning/task-three.ts'],
          },
        ],
      });

      for (const manifest of [firstManifest, secondManifest, thirdManifest]) {
        writeFileSync(
          join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
          YAML.stringify(manifest),
          'utf8',
        );
      }

      const options = {
        executeSlice: vi
          .fn()
          .mockImplementation(
            async ({ context }: { context: { current_slice: { touches: string[] } } }) => ({
              tokens_used: 10,
              files_changed: context.current_slice.touches,
              change_summary: 'updated existing file',
            }),
          ),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      };

      const firstExecutor = new SliceExecutor();
      await firstExecutor.execute(root, firstManifest.slug, options);
      await firstExecutor.execute(root, secondManifest.slug, options);
      expect(mockPromptForDecision).toHaveBeenCalledTimes(1);

      for (const entry of readdirSync(join(root, PATHS.DECISIONS_RESOLVED_DIR))) {
        if (entry !== '.gitkeep') {
          unlinkSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, entry));
        }
      }

      await new SliceExecutor().execute(root, thirdManifest.slug, options);
      expect(mockPromptForDecision).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('enforces the per-task cap at three screens and falls back to safer-default-by-cap', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-cap-'));
    try {
      mockPromptForDecision.mockResolvedValue({
        chosen_option_key: 'reuse-existing',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      });

      const baseSlice = createManifest().execution_slices[0];
      const manifest = createManifest({
        execution_slices: [
          {
            ...baseSlice,
            slice_id: 'SL-1',
            goal: 'Should we reuse existing code or create new support?',
            touches: ['src/planning/one.ts'],
          },
          {
            ...baseSlice,
            slice_id: 'SL-2',
            goal: 'Should we reuse existing code or create new support for step two?',
            covers: ['FR-1', 'AC-2'],
            touches: ['src/planning/two.ts'],
          },
          {
            ...baseSlice,
            slice_id: 'SL-3',
            goal: 'Should we reuse existing code or create new support for step three?',
            covers: ['FR-1', 'AC-3'],
            touches: ['src/planning/three.ts'],
          },
          {
            ...baseSlice,
            slice_id: 'SL-4',
            goal: 'Should we reuse existing code or create new support for step four?',
            covers: ['FR-1', 'AC-4'],
            touches: ['src/planning/four.ts'],
          },
        ],
      });

      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeCappedProfile(root);
      for (const file of ['one.ts', 'two.ts', 'three.ts', 'four.ts']) {
        writeFileSync(
          join(root, 'src/planning', file),
          `export const ${file.replace('.ts', '')} = 1;\n`,
          'utf8',
        );
      }
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: vi.fn().mockImplementation(async ({ context }) => ({
          tokens_used: 10,
          files_changed: context.current_slice.touches,
          change_summary: 'updated existing file',
        })),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(result.completedSliceIds).toEqual(['SL-1', 'SL-2', 'SL-3', 'SL-4']);
      expect(mockPromptForDecision).toHaveBeenCalledTimes(3);
      // The cap-triggered decision is the last one created (highest ULID).
      const cappedId = decisionIdsIn(root, PATHS.DECISIONS_RESOLVED_DIR).at(-1);
      const capped = JSON.parse(
        readFileSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${cappedId}.json`), 'utf8'),
      ) as { human_response: { intent: string; note: string } };
      expect(capped.human_response.intent).toBe('safer-default-by-cap');
      expect(capped.human_response.note).toContain('per-task screen cap');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('batches same-category forks on the fourth decision and carries that answer forward', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-batch-'));
    try {
      mockPromptForDecision
        .mockResolvedValueOnce({
          chosen_option_key: 'reuse-existing',
          intent: 'explicit',
          explanation_rounds_used: 0,
          responded_at: '2026-04-27T12:01:00Z',
          responded_by: 'haider',
          carry_over_scope: 'none',
        })
        .mockResolvedValueOnce({
          chosen_option_key: 'reuse-existing',
          intent: 'explicit',
          explanation_rounds_used: 0,
          responded_at: '2026-04-27T12:02:00Z',
          responded_by: 'haider',
          carry_over_scope: 'none',
        })
        .mockResolvedValueOnce({
          chosen_option_key: 'reuse-existing',
          intent: 'explicit',
          explanation_rounds_used: 0,
          responded_at: '2026-04-27T12:03:00Z',
          responded_by: 'haider',
          carry_over_scope: 'none',
        })
        .mockResolvedValueOnce({
          chosen_option_key: 'reuse-existing',
          intent: 'explicit',
          explanation_rounds_used: 0,
          responded_at: '2026-04-27T12:04:00Z',
          responded_by: 'haider',
          carry_over_scope: 'none',
        });

      const baseSlice = createManifest().execution_slices[0];
      const manifest = createManifest({
        execution_slices: [
          {
            ...baseSlice,
            slice_id: 'SL-1',
            goal: 'Should we reuse existing code or create new support?',
            touches: ['src/planning/one.ts'],
          },
          {
            ...baseSlice,
            slice_id: 'SL-2',
            goal: 'Should we reuse existing code or create new support for step two?',
            covers: ['FR-1', 'AC-2'],
            touches: ['src/planning/two.ts'],
          },
          {
            ...baseSlice,
            slice_id: 'SL-3',
            goal: 'Should we reuse existing code or create new support for step three?',
            covers: ['FR-1', 'AC-3'],
            touches: ['src/planning/three.ts'],
          },
          {
            ...baseSlice,
            slice_id: 'SL-4',
            goal: 'Should we reuse existing code or create new support for step four?',
            covers: ['FR-1', 'AC-4'],
            touches: ['src/planning/four.ts'],
          },
          {
            ...baseSlice,
            slice_id: 'SL-5',
            goal: 'Should we reuse existing code or create new support for step five?',
            covers: ['FR-1', 'AC-5'],
            touches: ['src/planning/five.ts'],
          },
        ],
      });

      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeCappedProfile(root);
      for (const file of ['one.ts', 'two.ts', 'three.ts', 'four.ts', 'five.ts']) {
        writeFileSync(
          join(root, 'src/planning', file),
          `export const ${file.replace('.ts', '')} = 1;\n`,
          'utf8',
        );
      }
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: vi.fn().mockImplementation(async ({ context }) => ({
          tokens_used: 10,
          files_changed: context.current_slice.touches,
          change_summary: 'updated existing file',
        })),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(result.completedSliceIds).toEqual(['SL-1', 'SL-2', 'SL-3', 'SL-4', 'SL-5']);
      expect(mockPromptForDecision).toHaveBeenCalledTimes(4);
      const carried = YAML.parse(
        readFileSync(join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`), 'utf8'),
      ) as { decision_log: Array<{ decision_id: string; reason: string }> };
      expect(carried.decision_log).toHaveLength(6);
      // The fifth decision carries the answer forward from the fourth (batched) one.
      expect(carried.decision_log[5]?.reason).toContain(
        `Applied carry-over preference from ${carried.decision_log[4]?.decision_id}.`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('materializes memoized decisions with audit events instead of prompting again', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-memoized-'));
    try {
      mockPromptForDecision.mockResolvedValue({
        chosen_option_key: 'reuse-existing',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      });

      const firstManifest = createManifest({
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we reuse existing code or create new support?',
            touches: ['src/planning/index.ts'],
          },
        ],
      });
      const secondManifest = createManifest({
        slug: 'planning-manifest-two',
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we reuse existing code or create new support?',
            touches: ['src/planning/index.ts'],
          },
        ],
      });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${firstManifest.slug}.yaml`),
        YAML.stringify(firstManifest),
        'utf8',
      );
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${secondManifest.slug}.yaml`),
        YAML.stringify(secondManifest),
        'utf8',
      );

      const executor = new SliceExecutor();
      await executor.execute(root, firstManifest.slug, {
        executeSlice: vi.fn().mockResolvedValue({
          tokens_used: 10,
          files_changed: ['src/planning/index.ts'],
          change_summary: 'updated existing file',
        }),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      mockPromptForDecision.mockReset();
      await executor.execute(root, secondManifest.slug, {
        executeSlice: vi.fn().mockResolvedValue({
          tokens_used: 10,
          files_changed: ['src/planning/index.ts'],
          change_summary: 'updated existing file',
        }),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(mockPromptForDecision).not.toHaveBeenCalled();
      // First run minted the reused decision; the second memoized a fresh one.
      // ULIDs sort chronologically, so [reused, memoized].
      const [reusedId, memoizedId] = decisionIdsIn(root, PATHS.DECISIONS_RESOLVED_DIR);
      expect(existsSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${memoizedId}.json`))).toBe(true);
      expect(readDecisionAuditEvents(root)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'decision-reused', decision_id: reusedId }),
          expect.objectContaining({
            event: 'decision-resolved-by-memoization',
            decision_id: memoizedId,
            provider: 'paqad-system',
          }),
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags an undeclared silent choice after slice completion and writes a deferred review packet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-decision-undeclared-'));
    try {
      const manifest = createManifest({
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Implement the dashboard button action.',
            touches: ['src/components/ButtonV2.tsx'],
          },
        ],
      });

      mkdirSync(join(root, 'src/components'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeFileSync(join(root, 'src/components/Button.tsx'), 'export const Button = 1;\n', 'utf8');
      writeFileSync(
        join(root, 'src/components/ButtonV2.tsx'),
        'export const ButtonV2 = 1;\n',
        'utf8',
      );
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: vi.fn().mockResolvedValue({
          tokens_used: 10,
          files_changed: ['src/components/ButtonV2.tsx'],
          change_summary: 'created a new component path',
        }),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(result.completedSliceIds).toEqual(['SL-1']);
      const [undeclaredId] = decisionIdsIn(root, PATHS.DECISIONS_PENDING_DIR);
      expect(undeclaredId).toMatch(ULID_DECISION_ID);
      expect(result.warnings).toEqual([
        `decision:undeclared:${undeclaredId}:src/components/ButtonV2.tsx`,
      ]);
      expect(existsSync(join(root, PATHS.DECISIONS_PENDING_DIR, `${undeclaredId}.json`))).toBe(
        true,
      );
      expect(readDecisionAuditEvents(root)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'decision-pending-written',
            decision_id: undeclaredId,
            task_session_id: 'retroactive:planning-manifest:SL-1',
          }),
          expect.objectContaining({
            event: 'undeclared-decision-flagged',
            decision_id: undeclaredId,
            provider: 'paqad-system',
          }),
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves silently when only one viable option remains after filtering weak candidates (§15.5)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-single-viable-'));
    try {
      // "or" in the goal triggers architecture-path fork detection.
      // architecture-path options: keep-current-path (similarity 0.74, passes floor 0.55)
      // and take-new-path (similarity 0.46, filtered out by floor).
      // resolveByConfidence returns null because 0.74 < threshold 0.85.
      // §15.5 then kicks in: 1 viable option → silent resolution, no screen shown.
      const manifest = createManifest({
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            goal: 'Should we keep the current module path or refactor entirely?',
            touches: ['src/planning/index.ts'],
          },
        ],
      });

      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
      writeFileSync(
        join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: vi.fn().mockResolvedValue({
          tokens_used: 10,
          files_changed: ['src/planning/index.ts'],
          change_summary: 'updated existing file',
        }),
        criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
        regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
        fullSuiteRunner: vi.fn().mockResolvedValue({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(result.completedSliceIds).toEqual(['SL-1']);
      expect(mockPromptForDecision).not.toHaveBeenCalled();
      const [silentId] = decisionIdsIn(root, PATHS.DECISIONS_RESOLVED_DIR);
      expect(silentId).toMatch(ULID_DECISION_ID);
      expect(readDecisionAuditEvents(root)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'decision-resolved-by-rag-confident',
            decision_id: silentId,
          }),
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe('PQD-101 decision-pause event streaming', () => {
    it('streams decision-paused and decision-resolved through the unified event bus', async () => {
      const root = mkdtempSync(join(tmpdir(), 'slice-decision-events-'));
      try {
        mockPromptForDecision.mockResolvedValue({
          chosen_option_key: 'reuse-existing',
          intent: 'explicit',
          explanation_rounds_used: 1,
          responded_at: '2026-04-27T12:01:00Z',
          responded_by: 'haider',
          carry_over_scope: 'none',
        });

        const manifest = createManifest({
          execution_slices: [
            {
              ...createManifest().execution_slices[0],
              goal: 'Should we reuse existing code or create new support?',
              touches: ['src/planning/index.ts'],
            },
          ],
        });
        mkdirSync(join(root, 'src/planning'), { recursive: true });
        mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
        writeStrictProfile(root);
        writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
        writeFileSync(
          join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
          YAML.stringify(manifest),
          'utf8',
        );

        const bus = new EngineEventBus();
        const events: EngineEvent[] = [];
        bus.subscribe((event) => events.push(event));

        await new SliceExecutor().execute(root, manifest.slug, {
          executeSlice: vi.fn().mockResolvedValue({
            tokens_used: 10,
            files_changed: ['src/planning/index.ts'],
            change_summary: 'updated existing file',
          }),
          criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
          regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
          fullSuiteRunner: vi.fn().mockResolvedValue({
            total_tests: 1,
            passing: 1,
            failing: 0,
            failing_tests: [],
            duration_ms: 10,
          }),
          eventBus: bus,
        });
        await flushMicrotasks();

        const paused = events.find((event) => event.kind === 'decision-paused');
        const resolved = events.find((event) => event.kind === 'decision-resolved');
        const pausedId = (paused as { decisionId?: string } | undefined)?.decisionId;
        expect(pausedId).toMatch(ULID_DECISION_ID);
        expect(paused).toMatchObject({
          kind: 'decision-paused',
          decisionId: pausedId,
          packetPath: `${PATHS.DECISIONS_PENDING_DIR}/${pausedId}.json`,
        });
        expect(resolved).toMatchObject({
          kind: 'decision-resolved',
          decisionId: pausedId,
          chosenOptionKey: 'reuse-existing',
          resolver: 'human',
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('emits decision-packet-corrupt when a pending file is malformed', async () => {
      const root = mkdtempSync(join(tmpdir(), 'slice-decision-corrupt-'));
      try {
        mockPromptForMalformedDecision.mockResolvedValue('continue');
        mockPromptForDecision.mockResolvedValue({
          chosen_option_key: 'reuse-existing',
          intent: 'explicit',
          explanation_rounds_used: 0,
          responded_at: '2026-04-27T12:01:00Z',
          responded_by: 'haider',
          carry_over_scope: 'none',
        });

        const manifest = createManifest({
          execution_slices: [
            {
              ...createManifest().execution_slices[0],
              goal: 'Should we reuse existing code or create new support?',
              touches: ['src/planning/index.ts'],
            },
          ],
        });
        mkdirSync(join(root, 'src/planning'), { recursive: true });
        mkdirSync(join(root, PATHS.PLANNING_SPECS_DIR), { recursive: true });
        writeStrictProfile(root);
        writeFileSync(join(root, 'src/planning/index.ts'), 'export const value = 1;\n', 'utf8');
        writeFileSync(
          join(root, PATHS.PLANNING_SPECS_DIR, `${manifest.slug}.yaml`),
          YAML.stringify(manifest),
          'utf8',
        );
        mkdirSync(join(root, PATHS.DECISIONS_PENDING_DIR), { recursive: true });
        writeFileSync(join(root, PATHS.DECISIONS_PENDING_DIR, 'D-9.json'), '{bad', 'utf8');

        const bus = new EngineEventBus();
        const events: EngineEvent[] = [];
        bus.subscribe((event) => events.push(event));

        await new SliceExecutor().execute(root, manifest.slug, {
          executeSlice: vi.fn().mockResolvedValue({
            tokens_used: 10,
            files_changed: ['src/planning/index.ts'],
            change_summary: 'updated existing file',
          }),
          criteriaRunner: vi.fn().mockResolvedValue({ passed: true }),
          regressionRunner: vi.fn().mockResolvedValue({ passed: true }),
          fullSuiteRunner: vi.fn().mockResolvedValue({
            total_tests: 1,
            passing: 1,
            failing: 0,
            failing_tests: [],
            duration_ms: 10,
          }),
          eventBus: bus,
        });
        await flushMicrotasks();

        const corrupt = events.find((event) => event.kind === 'decision-packet-corrupt');
        expect(corrupt).toMatchObject({ kind: 'decision-packet-corrupt', decisionId: 'D-9' });
        expect(
          corrupt?.kind === 'decision-packet-corrupt' && corrupt.reason.length,
        ).toBeGreaterThan(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('discardDecision removes the pending packet and streams decision-discarded', async () => {
      const root = mkdtempSync(join(tmpdir(), 'slice-decision-discard-'));
      try {
        const store = new DecisionStore(root);
        store.initialize();
        store.writePending({
          decision_id: 'D-3',
          fingerprint: 'sha256:test',
          category: 'component-reuse',
          question: 'Use the Button we have?',
          context: 'Adding a dashboard action.',
          options: [
            {
              option_key: 'reuse-button',
              label: 'Reuse Button',
              one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
              trade_off: 'You give up: a fresh design.',
              evidence: { file: 'src/components/Button.tsx', callers: 3 },
            },
            {
              option_key: 'make-new',
              label: 'Make new Button',
              one_line_preview: 'If you pick this, we will create src/components/ButtonV2.tsx.',
              trade_off: 'You give up: one shared place.',
              evidence: { file: 'src/components/ButtonV2.tsx', evidence_partial: true },
            },
          ],
          confidence: 0.72,
          requested_by: 'codex-cli',
          task_session_id: 'session-1',
          created_at: '2026-04-27T12:00:00Z',
          status: 'pending',
          ttl_until: '2099-12-31T12:00:00Z',
          invalidation_watch: [],
        });

        const bus = new EngineEventBus();
        const events: EngineEvent[] = [];
        bus.subscribe((event) => events.push(event));

        const removed = new SliceExecutor().discardDecision(root, 'D-3', 'superseded', bus);
        await flushMicrotasks();

        expect(removed?.decision_id).toBe('D-3');
        expect(existsSync(join(root, PATHS.DECISIONS_PENDING_DIR, 'D-3.json'))).toBe(false);
        expect(existsSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, 'D-3.json'))).toBe(false);
        expect(events.find((event) => event.kind === 'decision-discarded')).toMatchObject({
          kind: 'decision-discarded',
          decisionId: 'D-3',
          reason: 'superseded',
        });
        // An unknown id returns null without throwing.
        expect(new SliceExecutor().discardDecision(root, 'D-404', 'gone', bus)).toBeNull();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});

function writeStrictProfile(root: string): void {
  writeProfile(root, 'strict');
}

function writeIdleProfile(root: string): void {
  writeProfile(root, 'strict', 1);
}

function writeCappedProfile(root: string): void {
  writeProfile(root, 'strict', 30, 3);
}

function writeProfile(
  root: string,
  askThreshold: NonNullable<ProjectProfile['custom']['decisions']>['ask_threshold'],
  idleTimeoutMinutes = 30,
  maxScreensPerTask = 10,
): void {
  const profile: ProjectProfile = {
    project: { name: 'Test', id: 'test', description: 'test' },
    active_capabilities: ['content', 'coding', 'security'],
    stack_profile: {
      frameworks: ['node'],
      traits: [],
      toolchains: [],
      version_bands: [],
      sources: [],
    },
    commands: {
      install: 'pnpm install',
      dev: 'pnpm dev',
      test: 'pnpm test',
      test_single: 'pnpm test',
      lint: 'pnpm lint',
      format: 'pnpm format',
      migrate: 'pnpm migrate',
      build: 'pnpm build',
    },
    strictness: {
      full_lane_default: true,
      require_adversarial_review: false,
      block_on_stale_docs: false,
      require_db_review_for_migrations: false,
    },
    compliance_packs: [],
    features: {
      spec_only_mode: false,
      market_research: false,
      design_research: false,
      team_agents: false,
    },
    mcp: { servers: [] },
    model_routing: {
      default_model: 'gpt-5.4',
      reasoning_model: 'gpt-5.4',
      fast_model: 'gpt-5.4-mini',
    },
    research: { depth: 'standard' },
    intelligence: {
      rag_enabled: true,
      rag_similarity_threshold: 0.8,
      rag_top_n: 5,
    },
    efficiency: {},
    escalation: {
      destructive_operations: 'warn',
      risky_migrations: 'warn',
      security_findings: 'warn',
      db_row_threshold: 1000,
    },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
      decisions: {
        ask_threshold: askThreshold,
        idle_timeout_minutes: idleTimeoutMinutes,
        max_screens_per_task: maxScreensPerTask,
      },
    },
  };

  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.PROJECT_PROFILE), YAML.stringify(profile), 'utf8');
  // The decision knobs (ask_threshold, idle_timeout_minutes, max_screens_per_task)
  // are framework config: they now resolve from `.paqad/.config`, not the YAML.
  // Persist them so the slice executor sees the tuning these tests configured.
  syncFrameworkConfig(root, profile);
}
