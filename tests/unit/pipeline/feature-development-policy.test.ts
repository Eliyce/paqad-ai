import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  defaultFeatureDevelopmentPolicy,
  loadFeatureDevelopmentPolicy,
  renderDefaultFeatureDevelopmentPolicyYaml,
  resolveFeatureDevelopmentCheckCommands,
  reusePlanningInstructions,
} from '@/pipeline/feature-development-policy.js';

describe('feature development policy', () => {
  it('returns framework defaults when the project policy file is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));

    const result = loadFeatureDevelopmentPolicy(root);

    expect(result.policy).toEqual(defaultFeatureDevelopmentPolicy());
    expect(result.warnings).toEqual([]);
  });

  it('defines ticket_intake as the first stage and delivery as the last stage', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    const stageNames = Object.keys(policy.stages);
    expect(stageNames[0]).toBe('ticket_intake');
    expect(stageNames[stageNames.length - 1]).toBe('delivery');
    expect(policy.stages.ticket_intake.artifacts).toEqual(
      expect.arrayContaining(['refined ticket', 'resolved decision packets']),
    );
    expect(policy.stages.delivery.artifacts).toEqual(
      expect.arrayContaining(['branch', 'commit', 'pull request']),
    );
    expect(policy.stages.delivery.escalation.remote_failure).toBe('stop');
  });

  it('merges project overrides into the new ticket_intake and delivery stages', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));
    mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.WORKFLOWS_DIR, 'feature-development.yaml'),
      YAML.stringify({
        schema_version: '1',
        stages: {
          ticket_intake: {
            instructions: ['Always pull the ticket via the Linear MCP.'],
          },
          delivery: {
            instructions: ['Require a draft PR for changes touching migrations.'],
          },
        },
      }),
    );

    const result = loadFeatureDevelopmentPolicy(root);

    expect(result.policy.stages.ticket_intake.instructions).toEqual(
      expect.arrayContaining(['Always pull the ticket via the Linear MCP.']),
    );
    expect(result.policy.stages.delivery.instructions).toEqual(
      expect.arrayContaining(['Require a draft PR for changes touching migrations.']),
    );
  });

  it('merges project reads and checks with framework defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));
    mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.WORKFLOWS_DIR, 'feature-development.yaml'),
      YAML.stringify({
        schema_version: '1',
        stages: {
          planning: {
            read: ['docs/custom/**'],
          },
          checks: {
            checks: {
              commands: ['lint'],
              shell_commands: ['pnpm typecheck'],
            },
          },
          review: {
            strictness: {
              require_review: false,
            },
          },
        },
      }),
    );

    const result = loadFeatureDevelopmentPolicy(root);

    expect(result.policy.stages.planning.read).toEqual(
      expect.arrayContaining(['docs/modules/**', 'docs/instructions/**', 'docs/custom/**']),
    );
    expect(result.policy.stages.checks.checks?.commands).toEqual(
      expect.arrayContaining(['format', 'test', 'build', 'lint']),
    );
    expect(result.policy.stages.checks.checks?.shell_commands).toContain('pnpm typecheck');
    expect(result.policy.stages.review.strictness.require_review).toBe(true);
  });

  it('merges per-lane build-check-fix round caps (issue #108)', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));
    mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.WORKFLOWS_DIR, 'feature-development.yaml'),
      YAML.stringify({
        schema_version: '1',
        stages: {},
        rounds: { full: 8, graduated: 4 },
      }),
    );

    const result = loadFeatureDevelopmentPolicy(root);

    expect(result.policy.rounds).toEqual({ full: 8, graduated: 4 });
    expect(result.warnings).toEqual([]);
  });

  it('rejects an out-of-range round cap via the schema and falls back to defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));
    mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.WORKFLOWS_DIR, 'feature-development.yaml'),
      YAML.stringify({
        schema_version: '1',
        stages: {},
        rounds: { full: 0 },
      }),
    );

    const result = loadFeatureDevelopmentPolicy(root);

    expect(result.policy).toEqual(defaultFeatureDevelopmentPolicy());
    expect(result.warnings[0]).toContain('is invalid');
  });

  it('falls back to defaults with warnings when the project policy is invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));
    mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.WORKFLOWS_DIR, 'feature-development.yaml'),
      YAML.stringify({
        schema_version: '2',
      }),
    );

    const result = loadFeatureDevelopmentPolicy(root);

    expect(result.policy).toEqual(defaultFeatureDevelopmentPolicy());
    expect(result.warnings[0]).toContain('is invalid');
  });

  it('resolves logical check commands from the project profile and appends shell commands', () => {
    const resolved = resolveFeatureDevelopmentCheckCommands(
      {
        use_project_profile_commands: true,
        commands: ['format', 'build'],
        shell_commands: ['pnpm typecheck'],
        block_on_failure: true,
      },
      {
        commands: {
          install: 'pnpm install',
          dev: 'pnpm dev',
          test: 'pnpm test',
          test_single: 'pnpm test -- <pattern>',
          lint: 'pnpm lint',
          format: 'pnpm format',
          migrate: 'echo migrate',
          build: 'pnpm build',
        },
      },
    );

    expect(resolved.commands).toEqual([
      {
        logical_command: 'format',
        command: 'pnpm format',
        source: 'project-profile',
      },
      {
        logical_command: 'build',
        command: 'pnpm build',
        source: 'project-profile',
      },
      {
        logical_command: null,
        command: 'pnpm typecheck',
        source: 'policy',
      },
    ]);
    expect(resolved.warnings).toEqual([]);
  });

  describe('analytics stage injection (issue #279)', () => {
    function seedProject(options: { flagOn: boolean; sidecar?: unknown }): string {
      const root = mkdtempSync(join(tmpdir(), 'paqad-analytics-policy-'));
      mkdirSync(join(root, '.paqad', 'planning'), { recursive: true });
      if (options.flagOn) {
        writeFileSync(join(root, '.paqad', '.config'), 'analytics_instrumentation=true\n');
      }
      if (options.sidecar !== undefined) {
        writeFileSync(
          join(root, '.paqad', 'planning', 'analytics-decision.json'),
          JSON.stringify(options.sidecar),
        );
      }
      return root;
    }

    const instrumentSidecar = {
      status: 'instrument',
      provider: 'posthog',
      providerDisplay: 'PostHog',
      convention: 'snake_case',
      confidence: 'high',
      resolved_at: '2026-07-02T00:00:00.000Z',
    };

    it('appends analytics instructions to planning, spec, and development when on + instrument', () => {
      const root = seedProject({ flagOn: true, sidecar: instrumentSidecar });

      const { policy } = loadFeatureDevelopmentPolicy(root);

      expect(
        policy.stages.planning.instructions.some((i) => i.includes('analytics/index.md')),
      ).toBe(true);
      expect(policy.stages.planning.instructions.some((i) => i.includes('PostHog'))).toBe(true);
      expect(
        policy.stages.specification.instructions.some((i) => i.includes('analytics.new_event')),
      ).toBe(true);
      expect(policy.stages.development.instructions.some((i) => i.includes('docs/modules/'))).toBe(
        true,
      );
    });

    it('leaves the policy untouched when the flag is off', () => {
      const root = seedProject({ flagOn: false, sidecar: instrumentSidecar });

      const { policy } = loadFeatureDevelopmentPolicy(root);

      expect(policy).toEqual(defaultFeatureDevelopmentPolicy());
    });

    it('does not inject when the flag is on but no decision sidecar exists', () => {
      const root = seedProject({ flagOn: true });

      const { policy } = loadFeatureDevelopmentPolicy(root);

      expect(policy).toEqual(defaultFeatureDevelopmentPolicy());
    });

    it('does not inject when the flag is on but the gate is dormant', () => {
      const root = seedProject({
        flagOn: true,
        sidecar: { status: 'dormant', resolved_at: '2026-07-02T00:00:00.000Z' },
      });

      const { policy } = loadFeatureDevelopmentPolicy(root);

      expect(policy).toEqual(defaultFeatureDevelopmentPolicy());
    });
  });

  describe('reuse-first planning wiring (issue #359)', () => {
    const REPO_ROOT = resolve(__dirname, '../../..');

    /** The `triggers` array declared in a SKILL.md frontmatter block. */
    function skillTriggers(relPath: string): Array<Record<string, string[]>> {
      const text = readFileSync(join(REPO_ROOT, relPath), 'utf8');
      const match = /^---\n([\s\S]*?)\n---/.exec(text);
      expect(match, `${relPath} has no frontmatter block`).not.toBeNull();
      const front = YAML.parse(match![1]) as { triggers?: Array<Record<string, string[]>> };
      return front.triggers ?? [];
    }

    it('AC-4: the fast lane pays exactly one sentence — the reuse reflex, no skill blocks', () => {
      const fast = reusePlanningInstructions('fast');
      expect(fast).toHaveLength(1);
      expect(fast[0]).toMatch(/^Reuse before you build:/);
      expect(fast.join('\n')).not.toContain('diff-minimizer');
      expect(fast.join('\n')).not.toContain('cross-module-impact-scanner');
    });

    it('AC-4: graduated and full lanes add the diff-minimizer block', () => {
      for (const lane of ['graduated', 'full'] as const) {
        const instructions = reusePlanningInstructions(lane);
        expect(instructions).toHaveLength(2);
        expect(instructions[1]).toContain('diff-minimizer');
        expect(instructions[1]).toContain('existing-doc-checker');
        // Without multiModule, the cross-module block does not load.
        expect(instructions.join('\n')).not.toContain('cross-module-impact-scanner');
      }
    });

    it('AC-4: a multi-module graduated/full change adds the cross-module block', () => {
      for (const lane of ['graduated', 'full'] as const) {
        const instructions = reusePlanningInstructions(lane, { multiModule: true });
        expect(instructions).toHaveLength(3);
        expect(instructions[2]).toContain('cross-module-impact-scanner');
      }
      // The fast lane never gets the cross-module block, multiModule or not.
      expect(reusePlanningInstructions('fast', { multiModule: true })).toHaveLength(1);
    });

    it('AC-1: the default policy object carries the three blocks with their lane conditions', () => {
      const planning = defaultFeatureDevelopmentPolicy().stages.planning.instructions;
      expect(planning.some((i) => i.startsWith('Reuse before you build:'))).toBe(true);
      expect(
        planning.some(
          (i) => i.startsWith('On graduated and full lanes:') && i.includes('diff-minimizer'),
        ),
      ).toBe(true);
      expect(
        planning.some(
          (i) =>
            i.startsWith('On graduated and full lanes touching more than one module:') &&
            i.includes('cross-module-impact-scanner'),
        ),
      ).toBe(true);
    });

    it('AC-1 / INV-1: the rendered yaml carries the identical three instruction blocks', () => {
      const yaml = renderDefaultFeatureDevelopmentPolicyYaml();
      // Every reuse instruction on the object must appear verbatim in the rendered yaml, so
      // the two contract surfaces cannot drift (INV-1).
      for (const instruction of reusePlanningInstructions('full', { multiModule: true })) {
        expect(yaml).toContain(instruction);
      }
      // And the rendered yaml parses back into a policy whose planning stage carries them.
      const parsed = YAML.parse(yaml) as {
        stages: { planning: { instructions: string[] } };
      };
      expect(parsed.stages.planning.instructions).toEqual(
        expect.arrayContaining(reusePlanningInstructions('full', { multiModule: true })),
      );
    });

    it('AC-2: every wired skill named in the instructions resolves at its install path and declares feature-development', () => {
      const instructions = reusePlanningInstructions('full', { multiModule: true }).join('\n');
      const skills = [
        'runtime/base/skills/diff-minimizer/SKILL.md',
        'runtime/base/skills/existing-doc-checker/SKILL.md',
        'runtime/base/skills/cross-module-impact-scanner/SKILL.md',
      ];
      for (const relPath of skills) {
        const name = relPath.split('/')[3]!;
        // The instruction must name the skill by its exact directory name so the model can
        // find it through the install path.
        expect(instructions, `instructions should name ${name}`).toContain(name);
        expect(existsSync(join(REPO_ROOT, relPath)), `${relPath} must exist`).toBe(true);
        const declaresFeatureDev = skillTriggers(relPath).some((trigger) =>
          (trigger.workflow ?? []).includes('feature-development'),
        );
        expect(
          declaresFeatureDev,
          `${name} must declare feature-development in triggers.workflow`,
        ).toBe(true);
      }
      // The solution-architect procedure is an agent, not a skill; assert it too resolves.
      expect(instructions).toContain('solution-architect');
      expect(
        existsSync(join(REPO_ROOT, 'runtime/capabilities/coding/agents/solution-architect.md')),
      ).toBe(true);
    });
  });

  // Issue #360 — the review stage gets machine-built evidence, and the instruction that
  // says so is authored ONCE so the default policy object and the rendered yaml (the two
  // contract surfaces a project actually reads) cannot say different things.
  describe('review evidence digest wiring (issue #360)', () => {
    function reviewDigestInstruction(): string {
      const review = defaultFeatureDevelopmentPolicy().stages.review.instructions;
      const found = review.find((instruction) =>
        instruction.startsWith('Review digest (issue #360):'),
      );
      expect(found, 'the default review stage must carry the digest instruction').toBeDefined();
      return found!;
    }

    it('AC-4: the default policy object tells the review stage to build and read the digest', () => {
      const instruction = reviewDigestInstruction();
      expect(instruction).toContain('npx paqad-ai review digest');
      expect(instruction).toContain('.paqad/session/review-digest.md');
      expect(instruction).toContain('judgment-only');
      expect(instruction).toContain(
        'an unaddressed deterministic finding is itself a review finding',
      );
    });

    it('AC-4 / FR-8: the rendered yaml carries the identical instruction and parses back', () => {
      const instruction = reviewDigestInstruction();
      const yaml = renderDefaultFeatureDevelopmentPolicyYaml();
      expect(yaml).toContain(instruction);
      const parsed = YAML.parse(yaml) as { stages: { review: { instructions: string[] } } };
      expect(parsed.stages.review.instructions).toEqual(expect.arrayContaining([instruction]));
    });

    it('AC-4: this repo’s live contract and the shipped rule pack carry it too', () => {
      const liveYaml = readFileSync(
        resolve(__dirname, '../../..', 'docs/instructions/workflows/feature-development.yaml'),
        'utf8',
      );
      const rulePack = readFileSync(
        resolve(__dirname, '../../..', 'runtime/capabilities/coding/rules/feature-development.md'),
        'utf8',
      );
      for (const source of [liveYaml, rulePack]) {
        expect(source).toContain('review digest');
        expect(source).toContain('.paqad/session/review-digest.md');
      }
    });
  });
});
