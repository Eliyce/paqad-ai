import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { readAnalyticsDecision } from '@/analytics/gate.js';
import { PATHS } from '@/core/constants/paths.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import type {
  FeatureDevelopmentChecksPolicy,
  FeatureDevelopmentLogicalCommand,
  FeatureDevelopmentPolicy,
  FeatureDevelopmentPolicyLoadResult,
  FeatureDevelopmentRoundsPolicy,
  FeatureDevelopmentRuleCompliancePolicy,
  FeatureDevelopmentStageName,
  FeatureDevelopmentStagePolicy,
  ResolvedFeatureDevelopmentCheckCommand,
} from '@/core/types/feature-development-policy.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import { SchemaValidator } from '@/validators/validator.js';

type RawStagePolicy = Partial<FeatureDevelopmentPolicy['stages'][FeatureDevelopmentStageName]>;
type RawFeatureDevelopmentPolicy = {
  schema_version?: string;
  merge_mode?: 'append';
  stages?: Partial<Record<FeatureDevelopmentStageName, RawStagePolicy>>;
  rounds?: FeatureDevelopmentRoundsPolicy;
};

/**
 * The canonical feature-development stage order. Exported so the stage-evidence
 * ledger (issue #247) derives its ordered registry from THIS single source and the
 * two can never drift. Do not reorder without updating the ledger's expectations.
 */
export const STAGE_ORDER: FeatureDevelopmentStageName[] = [
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
    specification: { require_spec: true, require_spec_signoff: true },
    review: { require_review: true },
    checks: { block_on_failure: true },
    documentation_sync: { require_canonical_sync: true },
  };

export function featureDevelopmentPolicyPath(projectRoot: string): string {
  return join(projectRoot, PATHS.WORKFLOWS_DIR, 'feature-development.yaml');
}

/**
 * The `checks.rule_compliance.mode` a project has EXPLICITLY committed in its own
 * `feature-development.yaml` (issue #319), or undefined when there is no file or it
 * does not set the field. Deliberately reads the raw on-disk file, NOT the merged
 * policy — the merged policy injects the framework default (`strict`), so reading it
 * would flip strict on universally rather than honouring an explicit team decision.
 * Best-effort: a missing or unparseable file yields undefined.
 */
export function readProjectRuleComplianceModeOverride(projectRoot: string): string | undefined {
  const path = featureDevelopmentPolicyPath(projectRoot);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = YAML.parse(readFileSync(path, 'utf8')) as RawFeatureDevelopmentPolicy | null;
    const mode = parsed?.stages?.checks?.rule_compliance?.mode;
    return typeof mode === 'string' ? mode : undefined;
  } catch {
    return undefined;
  }
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
          'Auto-resolved decisions must be surfaced for confirmation per process.intake_decisions.confirm_auto_resolutions; never bypass the user silently.',
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
          'Spec sign-off (issue #102): on graduated/full lanes the spec must carry behaviour, acceptance criteria (AC-n, given/when/then, proof_type), and human-confirmed invariants (INV-n), and must be frozen before development. Freeze requires no open questions, no critical spec-review defects, and a confirmed invariant set. A mid-build goal change or a work-vs-spec contradiction surfaces via the Decision Pause Contract (spec.change / spec.contradiction) and is never resolved silently.',
          'Freeze the spec before writing code on graduated/full lanes: run `npx paqad-ai spec freeze <spec-file> --signed-off-by <name> --confirm-invariants` and resolve every printed blocker (missing ACs/invariants, open questions) before development. It writes the frozen spec into the active feature bundle (`specification.json`) that development builds against and the spec-change guard checks for drift.',
        ],
        required_inputs: ['approved spec boundary'],
        strictness: {
          require_spec: true,
          require_spec_signoff: true,
        },
        escalation: {
          missing_spec: 'stop',
          missing_spec_signoff: 'stop',
        },
        artifacts: ['specification', 'frozen feature-spec'],
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
          "Record the review with `paqad-ai review record` (issue #402). The review stage's artifact is the bundle's rigid review.json — a hand-written notes file is rejected, and nothing may be written into the feature bundle directory.",
        ],
        required_inputs: ['code diff', 'verification summary'],
        strictness: {
          require_review: true,
        },
        escalation: {
          review_findings: 'stop',
        },
        artifacts: ['review.json'],
        checks: null,
      },
      checks: {
        read: [],
        instructions: [
          'Run the project command checks after implementation and before finalizing the feature.',
          'Run them deterministically with `npx paqad-ai checks run`: it executes the mapped format/test/build commands, blocks (exits non-zero) on any red, and persists a structured report the completion gate reads so success is proven, not assumed. A red result is `Needs your attention` — fix it before finalizing.',
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
          'After documentation_sync, ask the user whether to open a PR (yes / draft / no) via a delivery.open_pr Decision Packet — unless process.pr already pins it.',
          'Render branch / commit / PR text from the delivery-policy process: block (docs/instructions/workflows/delivery-policy.yaml), resolve the host/ticket provider from config, and link back to the ticket if one is present.',
          'Run the CI gate per process.ci: wait_for_green polls checks until green (timeout_minutes), applies on_red on failure, and transitions the ticket on green. A red build surfaces via a delivery.ci_red Decision Packet when on_red needs a human call.',
          "Run the whole chain deterministically with `npx paqad-ai deliver`: it renders branch/commit/PR text, opens the PR after the delivery.open_pr pause, waits for CI (wait_for_green / on_red), and on green posts paqad's rendered verification evidence to the PR. If you deliver by hand instead, post the evidence yourself so the proof still lands: `npx paqad-ai evidence --output /tmp/paqad-evidence.md && gh pr comment --body-file /tmp/paqad-evidence.md`.",
          'Graceful degradation: if a required provider (host/tracker MCP) is not connected, do what is possible (branch/commit always run), skip the provider-bound steps, and re-surface the connect nudge — do not hard stop.',
          'MCP / git / remote failures (auth, conflicts, branch protection) stop with actionable remediation — never silently fall back to a local-only commit.',
        ],
        required_inputs: ['merged change', 'delivery-policy process block'],
        strictness: {},
        escalation: {
          remote_failure: 'stop',
          ci_red: 'ask',
        },
        artifacts: ['branch', 'commit', 'pull request', 'CI gate result'],
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
    return { policy: injectAnalyticsStageInstructions(defaults, projectRoot), warnings: [] };
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
    policy: injectAnalyticsStageInstructions(merged, projectRoot),
    warnings: commandWarnings,
  };
}

/**
 * Analytics v2 (issue #279): when the flag is on AND the classify-time gate resolved to
 * `instrument`, append analytics instructions to the planning, specification, and development
 * stages so the model reads the tracking plan first and instruments the change. OFF, or any
 * non-`instrument` sidecar (dormant / not_applicable / off / absent), leaves the policy
 * untouched — INV-1 keeps a non-analytics run silent.
 */
function injectAnalyticsStageInstructions(
  policy: FeatureDevelopmentPolicy,
  projectRoot: string,
): FeatureDevelopmentPolicy {
  let flagOn: boolean;
  try {
    flagOn = resolveFrameworkConfig(projectRoot).features.analytics_instrumentation;
    /* v8 ignore next 3 -- defensive: a malformed config never breaks policy loading */
  } catch {
    flagOn = false;
  }
  if (!flagOn) {
    return policy;
  }
  const decision = readAnalyticsDecision(projectRoot);
  if (decision?.status !== 'instrument') {
    return policy;
  }

  const provider = decision.providerDisplay ?? 'the detected provider';
  const extend = (
    stage: FeatureDevelopmentStagePolicy,
    line: string,
  ): FeatureDevelopmentStagePolicy => ({
    ...stage,
    instructions: [...stage.instructions, line],
  });

  return {
    ...policy,
    stages: {
      ...policy.stages,
      planning: extend(
        policy.stages.planning,
        `Analytics (${provider}) is on: read the module's \`analytics/index.md\` tracking plan before planning, and plan which events this change instruments — reuse an existing event before coining a new one.`,
      ),
      specification: extend(
        policy.stages.specification,
        'Analytics is on: for each user-facing behavior, declare the event(s) to track (name + provider). A brand-new event must go through the Decision Pause (`analytics.new_event`) before it lands.',
      ),
      development: extend(
        policy.stages.development,
        `Analytics is on: instrument the planned events using ${provider} and the project's naming convention, and document each at \`docs/modules/{module}/analytics/{feature}/{event}.md\`.`,
      ),
    },
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
      // Preserve the rules-as-scripts gate config through the merge (issue #319).
      // The old merge rebuilt only `checks` and silently dropped `rule_compliance`
      // when a project supplied its own feature-development.yaml — so the strictness
      // a team declared in the workflow file never reached the resolver. Field-merge
      // it (project fields win over the default) so the yaml knob is a real input.
      ...(defaultStage.rule_compliance || rawStage.rule_compliance
        ? {
            rule_compliance: {
              ...defaultStage.rule_compliance,
              ...(rawStage.rule_compliance ?? {}),
            } as FeatureDevelopmentRuleCompliancePolicy,
          }
        : {}),
    };
  }

  const merged: FeatureDevelopmentPolicy = {
    schema_version: '1',
    merge_mode: 'append',
    stages,
  };

  // Issue #108 — a project override of the loop round caps wins; the lane
  // defaults apply otherwise (resolved at the loop, not stored here).
  const rounds = sanitizeRounds(raw.rounds);
  if (rounds) {
    merged.rounds = rounds;
  }

  return merged;
}

function sanitizeRounds(
  raw: FeatureDevelopmentRoundsPolicy | undefined,
): FeatureDevelopmentRoundsPolicy | undefined {
  if (!raw) {
    return undefined;
  }
  const sanitized: FeatureDevelopmentRoundsPolicy = {};
  for (const lane of ['fast', 'graduated', 'full'] as const) {
    const value = raw[lane];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      sanitized[lane] = Math.floor(value);
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
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

export const RESERVED_WORKFLOW_POLICY_FILES = [
  'feature-development.yaml',
  'delivery-policy.yaml',
] as const;

export function isReservedWorkflowPolicyFile(fileName: string): boolean {
  return RESERVED_WORKFLOW_POLICY_FILES.includes(
    fileName as (typeof RESERVED_WORKFLOW_POLICY_FILES)[number],
  );
}

export function renderDefaultFeatureDevelopmentPolicyYaml(): string {
  return `# Feature Development Stage Policy
# This file customizes how the built-in feature-development workflow behaves in this project.
# The framework still owns routing, phase order, and mandatory safety stages.
#
# Enforcement tiers (issue #368) — an escalation is honoured on one of two tiers, and
# this contract never claims script enforcement it does not have:
#   - SCRIPT-ENFORCED (deterministic): checks.block_on_failure and the mandatory-stage
#     completeness gate. \`paqad-ai checks run\` exits non-zero on any red command and the
#     completion backstop reads its report; a feature-dev change with no report reads
#     Inconclusive, never a vacuous pass.
#   - AGENT-RAISED -> DECISION-PAUSE-ENFORCED: review.escalation.review_findings and
#     documentation_sync.escalation.stale_docs need model judgment to raise, so no script
#     detects them; once raised as a \`stop\`, the Decision-Pause gate holds edits until the
#     packet resolves. Not a false "a script proves this" promise.
schema_version: "1"
merge_mode: append

# Issue #108 — bounded build-check-fix loop round caps, per lane. Each value is
# the most build-check-fix rounds the loop runs before stopping with one honest
# "I couldn't get this fully clean" report. Omit a lane to use the framework
# default (fast 2, graduated 3, full 5). Raise for the heaviest work.
# rounds:
#   fast: 2
#   graduated: 3
#   full: 5

stages:
  ticket_intake:
    read:
      - docs/instructions/**
      - .paqad/decisions/resolved/**
    instructions:
      - When a ticket provider MCP is configured and the request references a ticket, fetch it and ground the refinement in repo rules, stack, design-system, and prior resolved decisions.
      - Detect implicit choices the ticket leaves open and resolve them priors-first (matching index.json fingerprints), then rules-second (rules/stack/design-system), then ask the user.
      - Auto-resolved decisions must be surfaced for confirmation per process.intake_decisions.confirm_auto_resolutions; never bypass the user silently.
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
      - "Spec sign-off (issue #102): on graduated/full lanes the spec must carry behaviour, acceptance criteria (AC-n, given/when/then, proof_type), and human-confirmed invariants (INV-n), and must be frozen before development. Freeze requires no open questions, no critical spec-review defects, and a confirmed invariant set. A mid-build goal change or a work-vs-spec contradiction surfaces via the Decision Pause Contract (spec.change / spec.contradiction) and is never resolved silently."
      - "Freeze the spec before writing code on graduated/full lanes: run \`npx paqad-ai spec freeze <spec-file> --signed-off-by <name> --confirm-invariants\` and resolve every printed blocker (missing ACs/invariants, open questions) before development. It writes the frozen spec into the active feature bundle (\`specification.json\`) that development builds against and the spec-change guard checks for drift."
    required_inputs:
      - approved spec boundary
    strictness:
      require_spec: true
      require_spec_signoff: true
    escalation:
      missing_spec: stop
      missing_spec_signoff: stop
    artifacts:
      - specification
      - frozen feature-spec

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
      - "Run them deterministically with \`npx paqad-ai checks run\`: it executes the mapped format/test/build commands, blocks (exits non-zero) on any red, and persists a structured report the completion gate reads so success is proven, not assumed. A red result is \`Needs your attention\` — fix it before finalizing."
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
      - After documentation_sync, ask the user whether to open a PR (yes / draft / no) via a delivery.open_pr Decision Packet — unless process.pr already pins it.
      - Render branch / commit / PR text from the delivery-policy process block (docs/instructions/workflows/delivery-policy.yaml), resolve the host/ticket provider from config, and link back to the ticket if one is present.
      - "Run the CI gate per process.ci: wait_for_green polls checks until green (timeout_minutes), applies on_red on failure, and transitions the ticket on green. A red build surfaces via a delivery.ci_red Decision Packet when on_red needs a human call."
      - "Run the whole chain deterministically with \`npx paqad-ai deliver\`: it renders branch/commit/PR text, opens the PR after the delivery.open_pr pause, waits for CI (wait_for_green / on_red), and on green posts paqad's rendered verification evidence to the PR. If you deliver by hand instead, post the evidence yourself so the proof still lands: \`npx paqad-ai evidence --output /tmp/paqad-evidence.md && gh pr comment --body-file /tmp/paqad-evidence.md\`."
      - "Graceful degradation: if a required provider (host/tracker MCP) is not connected, do what is possible (branch/commit always run), skip the provider-bound steps, and re-surface the connect nudge — do not hard stop."
      - MCP / git / remote failures (auth, conflicts, branch protection) stop with actionable remediation — never silently fall back to a local-only commit.
    required_inputs:
      - merged change
      - delivery-policy process block
    escalation:
      remote_failure: stop
      ci_red: ask
    artifacts:
      - branch
      - commit
      - pull request
      - CI gate result
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
