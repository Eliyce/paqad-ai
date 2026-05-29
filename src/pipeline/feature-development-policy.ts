import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import type {
  FeatureDevelopmentChecksPolicy,
  FeatureDevelopmentLogicalCommand,
  FeatureDevelopmentPolicy,
  FeatureDevelopmentPolicyLoadResult,
  FeatureDevelopmentStageName,
  ResolvedFeatureDevelopmentCheckCommand,
} from '@/core/types/feature-development-policy.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import { SchemaValidator } from '@/validators/validator.js';

type RawStagePolicy = Partial<FeatureDevelopmentPolicy['stages'][FeatureDevelopmentStageName]>;
type RawFeatureDevelopmentPolicy = {
  schema_version?: string;
  merge_mode?: 'append';
  stages?: Partial<Record<FeatureDevelopmentStageName, RawStagePolicy>>;
};

const STAGE_ORDER: FeatureDevelopmentStageName[] = [
  'ticket_intake',
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
  'delivery',
];

const REQUIRED_TRUE_STRICTNESS: Partial<Record<FeatureDevelopmentStageName, Record<string, true>>> =
  {
    specification: { require_spec: true },
    review: { require_review: true },
    checks: { block_on_failure: true },
    documentation_sync: { require_canonical_sync: true },
  };

export function featureDevelopmentPolicyPath(projectRoot: string): string {
  return join(projectRoot, PATHS.WORKFLOWS_DIR, 'feature-development.yaml');
}

export function defaultFeatureDevelopmentPolicy(): FeatureDevelopmentPolicy {
  return {
    schema_version: '1',
    merge_mode: 'append',
    stages: {
      ticket_intake: {
        read: ['docs/instructions/**', '.paqad/decisions/resolved/**'],
        instructions: [
          'When a ticket provider MCP is configured and the request references a ticket, fetch it and ground the refinement in repo rules, stack, design-system, and prior resolved decisions.',
          'Detect implicit choices the ticket leaves open and resolve them priors-first (matching index.json fingerprints), then rules-second (rules/stack/design-system), then ask the user.',
          'Auto-resolved decisions must be surfaced for confirmation per conventions.intake_decisions.confirm_auto_resolutions; never bypass the user silently.',
        ],
        required_inputs: ['ticket ref or natural-language request'],
        strictness: {},
        escalation: {
          missing_ticket: 'warn',
          unresolved_decisions: 'stop',
        },
        artifacts: ['refined ticket', 'resolved decision packets'],
        checks: null,
      },
      planning: {
        read: ['docs/modules/**', 'docs/instructions/**'],
        instructions: [
          'Review the canonical module and instruction docs before planning the change.',
          'Keep planning scoped to the requested feature and the current repository state.',
          'Rules-as-scripts (issue #89): invoke rule-script-reconciler at planning entry. RS-* drift (rules edited without script regen, manual map edits, failing fixtures) surfaces via the Decision Pause Contract. Resolve per escalation.rule_scripts_stale before planning continues.',
        ],
        required_inputs: ['active request', 'canonical docs'],
        strictness: {
          require_docs_context: true,
          require_rule_scripts_synced: true,
        },
        escalation: {
          missing_docs_context: 'warn',
          rule_scripts_stale: 'ask',
          rule_scripts_missing: 'warn',
        },
        artifacts: ['implementation sequence'],
        checks: null,
      },
      specification: {
        read: [],
        instructions: [
          'Write or refine the feature specification before implementation when the lane includes specification.',
        ],
        required_inputs: ['approved spec boundary'],
        strictness: {
          require_spec: true,
        },
        escalation: {
          missing_spec: 'stop',
        },
        artifacts: ['specification'],
        checks: null,
      },
      development: {
        read: [],
        instructions: [
          'Implement only the requested feature behavior and avoid unrelated refactors.',
        ],
        required_inputs: ['approved spec', 'implementation sequence'],
        strictness: {
          avoid_unrelated_refactors: true,
        },
        escalation: {
          scope_expansion: 'ask',
        },
        artifacts: ['code changes'],
        checks: null,
      },
      review: {
        read: [],
        instructions: [
          'Review the change against correctness, regressions, and rollback risk before treating it as complete.',
        ],
        required_inputs: ['code diff', 'verification summary'],
        strictness: {
          require_review: true,
        },
        escalation: {
          review_findings: 'stop',
        },
        artifacts: ['review summary'],
        checks: null,
      },
      checks: {
        read: [],
        instructions: [
          'Run the project command checks after implementation and before finalizing the feature.',
        ],
        required_inputs: ['working tree diff'],
        strictness: {
          block_on_failure: true,
        },
        escalation: {
          missing_command_mapping: 'stop',
        },
        artifacts: ['verification summary'],
        checks: {
          use_project_profile_commands: true,
          commands: ['format', 'test', 'build'],
          shell_commands: [],
          block_on_failure: true,
        },
        // Rules-as-scripts gate (issue #89). Runs the registered rule scripts
        // diff-scoped after the command checks. `deterministic` findings block
        // under mode:strict; `heuristic` findings route to review and never
        // block. The runner is the TS engine in src/rule-scripts/runner.ts.
        rule_compliance: {
          enabled: true,
          mode: 'strict',
          scope: 'changed-files',
          diff_scope: true,
          cache_path: PATHS.RULE_SCRIPTS_REPORT,
          escalation: 'stop',
        },
      },
      documentation_sync: {
        read: [],
        instructions: [
          'Sync canonical docs affected by the feature diff after verification passes.',
        ],
        required_inputs: ['changed files'],
        strictness: {
          require_canonical_sync: true,
        },
        escalation: {
          stale_docs: 'stop',
        },
        artifacts: ['stale doc targets'],
        checks: null,
      },
      delivery: {
        read: [],
        instructions: [
          'After documentation_sync, ask the user whether to open a PR (yes / draft / no) via a delivery.open_pr Decision Packet.',
          'On yes/draft, render branch / commit / PR text from the conventions: block templates, infer the host from the git remote, and link back to the ticket if one is present.',
          'MCP / git / remote failures stop with actionable remediation — never silently fall back to a local-only commit.',
        ],
        required_inputs: ['merged change', 'conventions block'],
        strictness: {},
        escalation: {
          remote_failure: 'stop',
        },
        artifacts: ['branch', 'commit', 'pull request'],
        checks: null,
      },
    },
  };
}

export function loadFeatureDevelopmentPolicy(
  projectRoot: string,
  profile: Pick<ProjectProfile, 'commands'> | null = null,
): FeatureDevelopmentPolicyLoadResult {
  const defaults = defaultFeatureDevelopmentPolicy();
  const path = featureDevelopmentPolicyPath(projectRoot);
  if (!existsSync(path)) {
    return { policy: defaults, warnings: [] };
  }

  let parsed: RawFeatureDevelopmentPolicy;
  try {
    parsed = (YAML.parse(readFileSync(path, 'utf8')) as RawFeatureDevelopmentPolicy) ?? {};
  } catch (error) {
    return {
      policy: defaults,
      warnings: [
        `Feature development policy at ${PATHS.WORKFLOWS_DIR}/feature-development.yaml could not be parsed. Using framework defaults.`,
        error instanceof Error ? error.message : 'YAML parse failed',
      ],
    };
  }

  const validator = new SchemaValidator();
  const validation = validator.validate('feature-development-policy', parsed);
  if (!validation.valid) {
    return {
      policy: defaults,
      warnings: [
        `Feature development policy at ${PATHS.WORKFLOWS_DIR}/feature-development.yaml is invalid. Using framework defaults.`,
        ...validation.errors.map((error) => `${error.path} ${error.message}`),
      ],
    };
  }

  const merged = mergeFeatureDevelopmentPolicy(defaults, parsed);
  const commandWarnings =
    profile === null ? [] : validateRequiredCommands(merged.stages.checks.checks, profile);

  return {
    policy: merged,
    warnings: commandWarnings,
  };
}

export function resolveFeatureDevelopmentCheckCommands(
  checks: FeatureDevelopmentChecksPolicy | null,
  profile: Pick<ProjectProfile, 'commands'> | null,
): {
  commands: ResolvedFeatureDevelopmentCheckCommand[];
  warnings: string[];
} {
  if (checks === null) {
    return { commands: [], warnings: [] };
  }

  const commands: ResolvedFeatureDevelopmentCheckCommand[] = [];
  const warnings: string[] = [];

  if (checks.use_project_profile_commands) {
    if (profile === null) {
      return { commands, warnings };
    }

    for (const logicalCommand of checks.commands) {
      const resolved = profile?.commands?.[logicalCommand];
      if (!resolved) {
        warnings.push(
          `Feature development policy requested project command "${logicalCommand}" but it was not found in ${PATHS.PROJECT_PROFILE}.`,
        );
        continue;
      }

      commands.push({
        logical_command: logicalCommand,
        command: resolved,
        source: 'project-profile',
      });
    }
  }

  for (const shellCommand of checks.shell_commands) {
    commands.push({
      logical_command: null,
      command: shellCommand,
      source: 'policy',
    });
  }

  return { commands, warnings };
}

function mergeFeatureDevelopmentPolicy(
  defaults: FeatureDevelopmentPolicy,
  raw: RawFeatureDevelopmentPolicy,
): FeatureDevelopmentPolicy {
  const stages = {} as FeatureDevelopmentPolicy['stages'];

  for (const stageName of STAGE_ORDER) {
    const defaultStage = defaults.stages[stageName];
    const rawStage = raw.stages?.[stageName] ?? {};
    const defaultChecks = defaultStage.checks;
    const rawChecks = rawStage.checks;

    stages[stageName] = {
      read: appendUnique(defaultStage.read, rawStage.read),
      instructions: appendUnique(defaultStage.instructions, rawStage.instructions),
      required_inputs: appendUnique(defaultStage.required_inputs, rawStage.required_inputs),
      strictness: mergeStrictness(stageName, defaultStage.strictness, rawStage.strictness),
      escalation: {
        ...defaultStage.escalation,
        ...(rawStage.escalation ?? {}),
      },
      artifacts: appendUnique(defaultStage.artifacts, rawStage.artifacts),
      checks:
        defaultChecks === null && rawChecks === undefined
          ? null
          : {
              use_project_profile_commands:
                rawChecks?.use_project_profile_commands ??
                defaultChecks?.use_project_profile_commands ??
                true,
              commands: appendUniqueLogicalCommands(
                defaultChecks?.commands ?? [],
                rawChecks?.commands,
              ),
              shell_commands: appendUnique(
                defaultChecks?.shell_commands ?? [],
                rawChecks?.shell_commands,
              ),
              block_on_failure:
                rawChecks?.block_on_failure === true ||
                defaultChecks?.block_on_failure === true ||
                defaultStage.strictness.block_on_failure === true,
            },
    };
  }

  return {
    schema_version: '1',
    merge_mode: 'append',
    stages,
  };
}

function appendUnique(base: string[], additions: string[] | undefined): string[] {
  return Array.from(new Set([...base, ...(additions ?? [])]));
}

function appendUniqueLogicalCommands(
  base: FeatureDevelopmentLogicalCommand[],
  additions: FeatureDevelopmentLogicalCommand[] | undefined,
): FeatureDevelopmentLogicalCommand[] {
  return Array.from(new Set([...base, ...(additions ?? [])]));
}

function mergeStrictness(
  stageName: FeatureDevelopmentStageName,
  base: Record<string, boolean>,
  additions: Record<string, boolean> | undefined,
): Record<string, boolean> {
  const merged: Record<string, boolean> = { ...base };

  for (const [key, value] of Object.entries(additions ?? {})) {
    merged[key] = merged[key] === true ? true : value;
  }

  for (const [key, value] of Object.entries(REQUIRED_TRUE_STRICTNESS[stageName] ?? {})) {
    if (value === true) {
      merged[key] = true;
    }
  }

  return merged;
}

function validateRequiredCommands(
  checks: FeatureDevelopmentChecksPolicy | null,
  profile: Pick<ProjectProfile, 'commands'>,
): string[] {
  const resolved = resolveFeatureDevelopmentCheckCommands(checks, profile);
  return resolved.warnings;
}

export const RESERVED_WORKFLOW_POLICY_FILES = ['feature-development.yaml'] as const;

export function isReservedWorkflowPolicyFile(fileName: string): boolean {
  return RESERVED_WORKFLOW_POLICY_FILES.includes(
    fileName as (typeof RESERVED_WORKFLOW_POLICY_FILES)[number],
  );
}

export function renderDefaultFeatureDevelopmentPolicyYaml(): string {
  return `# Feature Development Stage Policy
# This file customizes how the built-in feature-development workflow behaves in this project.
# The framework still owns routing, phase order, and mandatory safety stages.
schema_version: "1"
merge_mode: append

stages:
  ticket_intake:
    read:
      - docs/instructions/**
      - .paqad/decisions/resolved/**
    instructions:
      - When a ticket provider MCP is configured and the request references a ticket, fetch it and ground the refinement in repo rules, stack, design-system, and prior resolved decisions.
      - Detect implicit choices the ticket leaves open and resolve them priors-first (matching index.json fingerprints), then rules-second (rules/stack/design-system), then ask the user.
      - Auto-resolved decisions must be surfaced for confirmation per conventions.intake_decisions.confirm_auto_resolutions; never bypass the user silently.
    required_inputs:
      - ticket ref or natural-language request
    escalation:
      missing_ticket: warn
      unresolved_decisions: stop
    artifacts:
      - refined ticket
      - resolved decision packets

  planning:
    # Extra context to load before planning starts.
    read:
      - docs/modules/**
      - docs/instructions/**
    instructions:
      - Review the canonical module and instruction docs before planning the change.
      - Keep planning scoped to the requested feature and the current repository state.
      - "Rules-as-scripts (issue #89): invoke rule-script-reconciler at planning entry. RS-* drift (rules edited without script regen, manual map edits, failing fixtures) surfaces via the Decision Pause Contract. Resolve per escalation.rule_scripts_stale before planning continues."
    required_inputs:
      - active request
      - canonical docs
    strictness:
      require_docs_context: true
      require_rule_scripts_synced: true
    escalation:
      missing_docs_context: warn
      rule_scripts_stale: ask
      rule_scripts_missing: warn
    artifacts:
      - implementation sequence

  specification:
    instructions:
      - Write or refine the feature specification before implementation when the lane includes specification.
    required_inputs:
      - approved spec boundary
    strictness:
      require_spec: true
    escalation:
      missing_spec: stop
    artifacts:
      - specification

  development:
    instructions:
      - Implement only the requested feature behavior and avoid unrelated refactors.
    required_inputs:
      - approved spec
      - implementation sequence
    strictness:
      avoid_unrelated_refactors: true
    escalation:
      scope_expansion: ask
    artifacts:
      - code changes

  review:
    instructions:
      - Review the change against correctness, regressions, and rollback risk before treating it as complete.
    required_inputs:
      - code diff
      - verification summary
    strictness:
      require_review: true
    escalation:
      review_findings: stop
    artifacts:
      - review summary

  checks:
    instructions:
      - Run the project command checks after implementation and before finalizing the feature.
    required_inputs:
      - working tree diff
    strictness:
      block_on_failure: true
    escalation:
      missing_command_mapping: stop
    artifacts:
      - verification summary
    checks:
      use_project_profile_commands: true
      commands:
        - format
        - test
        - build
      shell_commands: []
      block_on_failure: true
      # Add project-specific commands here when needed.
      # shell_commands:
      #   - pnpm typecheck
    # Rules-as-scripts gate (issue #89). Runs registered rule scripts diff-scoped
    # after the command checks. deterministic findings block under mode:strict;
    # heuristic findings route to review and never block.
    rule_compliance:
      enabled: true
      mode: strict
      scope: changed-files
      diff_scope: true
      cache_path: .paqad/scripts/rules/.cache/report.json
      escalation: stop

  documentation_sync:
    instructions:
      - Sync canonical docs affected by the feature diff after verification passes.
    required_inputs:
      - changed files
    strictness:
      require_canonical_sync: true
    escalation:
      stale_docs: stop
    artifacts:
      - stale doc targets

  delivery:
    instructions:
      - After documentation_sync, ask the user whether to open a PR (yes / draft / no) via a delivery.open_pr Decision Packet.
      - On yes/draft, render branch / commit / PR text from the conventions: block templates, infer the host from the git remote, and link back to the ticket if one is present.
      - MCP / git / remote failures stop with actionable remediation — never silently fall back to a local-only commit.
    required_inputs:
      - merged change
      - conventions block
    escalation:
      remote_failure: stop
    artifacts:
      - branch
      - commit
      - pull request
`;
}

export function summarizeFeatureDevelopmentStage(
  policy: FeatureDevelopmentPolicy | null,
  stageName: FeatureDevelopmentStageName,
): string | null {
  if (policy === null) {
    return null;
  }

  const stage = policy.stages[stageName];
  const fragments: string[] = [];

  if (stage.read.length > 0) {
    fragments.push(`reads ${stage.read.length} path(s)`);
  }

  if (stage.instructions.length > 0) {
    fragments.push(`${stage.instructions.length} instruction(s)`);
  }

  if (stage.required_inputs.length > 0) {
    fragments.push(`${stage.required_inputs.length} required input(s)`);
  }

  if (stage.artifacts.length > 0) {
    fragments.push(`${stage.artifacts.length} expected artifact(s)`);
  }

  if (stage.checks !== null) {
    const checkCount = stage.checks.commands.length + stage.checks.shell_commands.length;
    fragments.push(`${checkCount} configured check(s)`);
  }

  return fragments.length > 0 ? fragments.join(', ') : null;
}
