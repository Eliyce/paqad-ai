import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { FEATURE_DEVELOPMENT_ESCALATION_ACTIONS } from '@/core/types/feature-development-policy.js';
import {
  defaultFeatureDevelopmentPolicy,
  loadFeatureDevelopmentPolicy,
  OUT_OF_SCOPE_FINDINGS_INSTRUCTION,
  renderDefaultFeatureDevelopmentPolicyYaml,
  resolveFeatureDevelopmentCheckCommands,
  REVIEW_DIGEST_REFRESH_INSTRUCTION,
  reusePlanningInstructions,
} from '@/pipeline/feature-development-policy.js';
import { stageNoteLines } from '@/stage-isolation/stage-agents.js';

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
      expect.arrayContaining([
        'docs/instructions/stack/**',
        'docs/instructions/design-system/**',
        'docs/instructions/workflows/**',
        'docs/custom/**',
      ]),
    );
    expect(result.policy.stages.checks.checks?.commands).toEqual(
      expect.arrayContaining(['format', 'test', 'build', 'lint']),
    );
    expect(result.policy.stages.checks.checks?.shell_commands).toContain('pnpm typecheck');
    expect(result.policy.stages.review.strictness.require_review).toBe(true);
  });

  it('merges per-lane build-check-fix round caps', () => {
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

  it('skips an empty mapped command as not mapped instead of reporting it not found', () => {
    const resolved = resolveFeatureDevelopmentCheckCommands(
      {
        use_project_profile_commands: true,
        commands: ['format', 'test', 'build'],
        shell_commands: [],
        block_on_failure: true,
      },
      {
        commands: {
          install: 'npm install',
          dev: '',
          test: 'npm test',
          test_single: 'npm test -- <pattern>',
          lint: '',
          format: '',
          migrate: '',
          build: '  ',
        },
      },
    );

    expect(resolved.commands).toEqual([
      { logical_command: 'test', command: 'npm test', source: 'project-profile' },
    ]);
    expect(resolved.warnings).toEqual([
      'format is not mapped in the profile; skipped',
      'build is not mapped in the profile; skipped',
    ]);
  });

  describe('analytics stage injection', () => {
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

  describe('reuse-first planning wiring', () => {
    const REPO_ROOT = resolve(__dirname, '../../..');

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
        expect(instructions.join('\n')).not.toContain('cross-module-impact-scanner');
      }
    });

    it('AC-4: a multi-module graduated/full change adds the cross-module block', () => {
      for (const lane of ['graduated', 'full'] as const) {
        const instructions = reusePlanningInstructions(lane, { multiModule: true });
        expect(instructions).toHaveLength(3);
        expect(instructions[2]).toContain('cross-module-impact-scanner');
      }
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
      for (const instruction of reusePlanningInstructions('full', { multiModule: true })) {
        expect(yaml).toContain(instruction);
      }
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
      expect(instructions).toContain('solution-architect');
      expect(
        existsSync(join(REPO_ROOT, 'runtime/capabilities/coding/agents/solution-architect.md')),
      ).toBe(true);
    });
  });

  describe('review evidence digest wiring', () => {
    function reviewDigestInstruction(): string {
      const review = defaultFeatureDevelopmentPolicy().stages.review.instructions;
      const found = review.find((instruction) => instruction.startsWith('Review digest:'));
      expect(found, 'the default review stage must carry the digest instruction').toBeDefined();
      return found!;
    }

    it('AC-4: the default policy object tells the review stage to build and read the digest', () => {
      const instruction = reviewDigestInstruction();
      expect(instruction).toContain('paqad-ai review digest');
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

  describe('out-of-scope findings wiring', () => {
    const repo = (path: string): string =>
      readFileSync(resolve(__dirname, '../../..', path), 'utf8');

    it('the default review and doc-sync stages carry the debt instruction', () => {
      const { stages } = defaultFeatureDevelopmentPolicy();
      expect(OUT_OF_SCOPE_FINDINGS_INSTRUCTION).toContain('paqad-ai debt add');
      expect(stages.review.instructions).toContain(OUT_OF_SCOPE_FINDINGS_INSTRUCTION);
      expect(stages.documentation_sync.instructions).toContain(OUT_OF_SCOPE_FINDINGS_INSTRUCTION);
    });

    it('the rendered yaml, the live contract, the rule pack and its mirror carry it verbatim', () => {
      const parsed = YAML.parse(renderDefaultFeatureDevelopmentPolicyYaml()) as {
        stages: Record<string, { instructions: string[] }>;
      };
      const live = YAML.parse(repo('docs/instructions/workflows/feature-development.yaml')) as {
        stages: Record<string, { instructions: string[] }>;
      };
      for (const doc of [parsed, live]) {
        expect(doc.stages.review!.instructions).toContain(OUT_OF_SCOPE_FINDINGS_INSTRUCTION);
        expect(doc.stages.documentation_sync!.instructions).toContain(
          OUT_OF_SCOPE_FINDINGS_INSTRUCTION,
        );
      }
      for (const path of [
        'runtime/capabilities/coding/rules/feature-development.md',
        'docs/instructions/rules/coding/feature-development.md',
        'runtime/claude-plugin/agents/paqad-review.md',
        'runtime/claude-plugin/agents/paqad-documentation-sync.md',
      ]) {
        expect(repo(path)).toContain(OUT_OF_SCOPE_FINDINGS_INSTRUCTION);
      }
      expect(repo('runtime/claude-plugin/agents/paqad-development.md')).not.toContain(
        OUT_OF_SCOPE_FINDINGS_INSTRUCTION,
      );
    });
  });

  describe('review digest refresh before review record', () => {
    const repo = (path: string): string =>
      readFileSync(resolve(__dirname, '../../..', path), 'utf8');

    it('AC-15: tells review to re-run the digest and to return blocked when the re-run fails', () => {
      expect(REVIEW_DIGEST_REFRESH_INSTRUCTION).toContain('Just before `paqad-ai review record`');
      expect(REVIEW_DIGEST_REFRESH_INSTRUCTION).toContain('run `paqad-ai review digest` again');
      expect(REVIEW_DIGEST_REFRESH_INSTRUCTION).toContain('do not record the review');
      expect(REVIEW_DIGEST_REFRESH_INSTRUCTION).toContain('return blocked with the digest error');
    });

    it('AC-13: the default review stage carries it right after the review digest instruction', () => {
      const { instructions } = defaultFeatureDevelopmentPolicy().stages.review;
      const digestAt = instructions.findIndex((line) => line.startsWith('Review digest:'));
      expect(digestAt).toBeGreaterThanOrEqual(0);
      expect(instructions[digestAt + 1]).toBe(REVIEW_DIGEST_REFRESH_INSTRUCTION);
    });

    it('AC-13: the rendered yaml and the live contract carry it in the review stage', () => {
      const parsed = YAML.parse(renderDefaultFeatureDevelopmentPolicyYaml()) as {
        stages: Record<string, { instructions: string[] }>;
      };
      const live = YAML.parse(repo('docs/instructions/workflows/feature-development.yaml')) as {
        stages: Record<string, { instructions: string[] }>;
      };
      for (const doc of [parsed, live]) {
        const { instructions } = doc.stages.review!;
        const digestAt = instructions.findIndex((line) => line.startsWith('Review digest:'));
        expect(instructions[digestAt + 1]).toBe(REVIEW_DIGEST_REFRESH_INSTRUCTION);
      }
    });

    it('AC-13: the review stage brief and review agent carry it; development does not', () => {
      expect(stageNoteLines('review')).toContain(REVIEW_DIGEST_REFRESH_INSTRUCTION);
      expect(stageNoteLines('development')).not.toContain(REVIEW_DIGEST_REFRESH_INSTRUCTION);
      expect(repo('runtime/claude-plugin/agents/paqad-review.md')).toContain(
        REVIEW_DIGEST_REFRESH_INSTRUCTION,
      );
      expect(repo('runtime/claude-plugin/agents/paqad-development.md')).not.toContain(
        REVIEW_DIGEST_REFRESH_INSTRUCTION,
      );
    });
  });

  describe('attribution_pending defer', () => {
    it('AC-11: the default policy defers attribution to the spec question round', () => {
      expect(defaultFeatureDevelopmentPolicy().stages.planning.escalation.attribution_pending).toBe(
        'defer',
      );
      expect(FEATURE_DEVELOPMENT_ESCALATION_ACTIONS).toContain('defer');
    });

    it('AC-11: the schema accepts defer and a project that sets stop keeps stop', () => {
      const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));
      mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
      const write = (value: string) =>
        writeFileSync(
          join(root, PATHS.WORKFLOWS_DIR, 'feature-development.yaml'),
          YAML.stringify({
            schema_version: '1',
            stages: { planning: { escalation: { attribution_pending: value } } },
          }),
        );

      write('defer');
      const deferred = loadFeatureDevelopmentPolicy(root);
      expect(deferred.warnings).toEqual([]);
      expect(deferred.policy.stages.planning.escalation.attribution_pending).toBe('defer');

      write('stop');
      const stopped = loadFeatureDevelopmentPolicy(root);
      expect(stopped.warnings).toEqual([]);
      expect(stopped.policy.stages.planning.escalation.attribution_pending).toBe('stop');
    });

    it('AC-11: the shipped workflow yaml defers attribution and the inferencer step', () => {
      const raw = YAML.parse(
        readFileSync(resolve('docs/instructions/workflows/feature-development.yaml'), 'utf8'),
      ) as {
        stages: {
          planning: {
            escalation: Record<string, string>;
            attribution_gate: { pipeline: Array<Record<string, string>> };
          };
        };
      };
      expect(raw.stages.planning.escalation.attribution_pending).toBe('defer');
      const inferencer = raw.stages.planning.attribution_gate.pipeline.find(
        (step) => step.skill === 'module-attribution-inferencer',
      );
      expect(inferencer?.on_not_confident).toBe('defer');
    });
  });
});
