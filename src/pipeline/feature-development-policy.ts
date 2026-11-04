import { readAnalyticsDecision } from '@/analytics/gate.js';
import { PATHS } from '@/core/constants/paths.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { invalidFileMessage, readTeamYamlFile } from '@/core/team-config.js';
import { WORKFLOW_POLICY_STAGES } from '@/core/team-config-schema.js';
import type {
  FeatureDevelopmentChecksPolicy,
  FeatureDevelopmentLogicalCommand,
  FeatureDevelopmentPolicy,
  FeatureDevelopmentPolicyLoadResult,
  FeatureDevelopmentStageName,
  FeatureDevelopmentStagePolicy,
  ResolvedFeatureDevelopmentCheckCommand,
} from '@/core/types/feature-development-policy.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

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

const SPEC_REVIEW_ENFORCEMENT_INSTRUCTION =
  'Spec-review enforcement: SCRIPT-ENFORCED. `paqad-ai spec freeze` runs the ' +
  'spec-quality review itself and refuses to freeze while a critical defect is open, so ' +
  'never run `compliance review` by hand to satisfy the clause above. Major and minor ' +
  "findings never block. The defect summary is folded into the bundle's specification.json " +
  'and no .paqad/compliance/<slug>/spec-review.json is written by this workflow. Author the ' +
  'spec markdown inside the project: a path resolving outside the project root is rejected.';

const SPEC_PIPELINE_INSTRUCTION =
  'Spec pipeline: when `spec_pipeline_enabled` is on, produce the spec through ' +
  '`paqad-ai spec pipeline` (start, experts when enabled, questions, task, craft, finish) and ' +
  'freeze it with `paqad-ai spec freeze <spec.md> --from-pipeline`. The pipeline grounds the ' +
  "request in the project's own docs, brings in the domain experts the request needs, asks the " +
  'owner one batch of plain-language questions only when something is genuinely undecided, and ' +
  'writes the spec in the format the freeze accepts. Under spec_pipeline_adoption=strict a ' +
  'hand-written spec is refused at freeze (exit: `--manual --reason`); under warn it freezes and ' +
  'the record says pipeline.produced=false. The pipeline, its experts and strict adoption are on ' +
  'by default on the graduated and full lanes; a fast-lane change never runs the ' +
  'pipeline and freezes a hand-written spec. ' +
  'At the questions step, run `paqad-ai spec pipeline round` and ask the owner every pending question for this change in one round: the expert disagreements the chief ruled pick, the enrichment, expert and chief questions, the deferred module-attribution question, the fix proof method and the visual-evidence readiness pause. When the round prints an opener (The experts agreed on N points after merging overlaps, with the merged claims in a details list), start with it. Show a module choice that was applied automatically as a choice already made that the owner can change. Ask up to 4 questions per call, back to back with nothing in between, and resolve each packet with `paqad-ai decision resolve`. Development starts only after every packet in the round is resolved.';

const REUSE_PLANNING_INSTRUCTION =
  'Reuse before you build: consult the Existing surface section (and `paqad-ai index ' +
  'query <name>`) for existing helpers; follow the solution-architect procedure — Reuse / ' +
  'Extend / Build-new, and record a rejection rationale for every Build-new.';

const DIFF_MINIMIZER_PLANNING_INSTRUCTION =
  'On graduated and full lanes: run the diff-minimizer skill over the implementation ' +
  'sequence before compiling the plan; drop steps it classifies over-build or record why ' +
  'they stay. Run existing-doc-checker before creating any new doc or registry artifact.';

const REVIEW_DIGEST_INSTRUCTION =
  'Review digest: before writing review findings, run `paqad-ai review ' +
  'digest` and read `.paqad/session/review-digest.md`. Each finding must either reference a ' +
  'digest row or be explicitly marked judgment-only. Confirm or contest every deterministic ' +
  'finding — an unaddressed deterministic finding is itself a review finding, and the review ' +
  'gate fails when a deterministic high-severity row is never cited by file:line.';

export const REVIEW_DIGEST_REFRESH_INSTRUCTION =
  'Just before `paqad-ai review record`, run `paqad-ai review digest` again so edits made by ' +
  'documentation sync while you worked are included. If that digest run fails, do not record ' +
  'the review; return blocked with the digest error.';

export const FULL_SUITE_INSTRUCTION =
  "For a full-suite run, use `paqad-ai checks run`, not the project's full test command, so " +
  'the green result is recorded and reused. For the inner loop, run only the tests for the ' +
  'files you changed (for vitest: `vitest related <files>` or the file paths).';

export const OUT_OF_SCOPE_FINDINGS_INSTRUCTION =
  'Out-of-scope findings: when you find a real problem the change will not fix (a bug next ' +
  'to the change, a shortcut you had to take, a limit you chose to keep), record it with ' +
  '`paqad-ai debt add` instead of fixing it or leaving it in chat. A review finding you ' +
  'mark as deferred must name its TD id.';

const CROSS_MODULE_IMPACT_PLANNING_INSTRUCTION =
  'On graduated and full lanes touching more than one module: run ' +
  'cross-module-impact-scanner; surface breaking / silent-shift rows as Decision Packets ' +
  '(existing categories).';

export function reusePlanningInstructions(
  lane: 'fast' | 'graduated' | 'full',
  options: { multiModule?: boolean } = {},
): string[] {
  const instructions = [REUSE_PLANNING_INSTRUCTION];
  if (lane === 'graduated' || lane === 'full') {
    instructions.push(DIFF_MINIMIZER_PLANNING_INSTRUCTION);
    if (options.multiModule === true) {
      instructions.push(CROSS_MODULE_IMPACT_PLANNING_INSTRUCTION);
    }
  }
  return instructions;
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
        read: ['docs/instructions/stack/**', 'docs/instructions/design-system/**'],
        instructions: [
          'Review the canonical module and instruction docs before planning the change.',
          'Rules-as-scripts: invoke rule-script-reconciler at planning entry. RS-* drift (rules edited without script regen, manual map edits, failing fixtures) surfaces via the Decision Pause Contract. Resolve per escalation.rule_scripts_stale before planning continues.',
          ...reusePlanningInstructions('full', { multiModule: true }),
        ],
        required_inputs: ['active request', 'canonical docs'],
        strictness: {
          require_docs_context: true,
          require_rule_scripts_synced: true,
        },
        escalation: {
          missing_docs_context: 'warn',
          attribution_pending: 'defer',
          rule_scripts_stale: 'ask',
          rule_scripts_missing: 'warn',
        },
        artifacts: ['implementation sequence'],
        checks: null,
      },
      specification: {
        read: [],
        instructions: [
          'Spec sign-off: on graduated/full lanes the spec must carry behaviour, acceptance criteria (AC-n, given/when/then, proof_type), and human-confirmed invariants (INV-n), and must be frozen before development. Freeze requires no open questions, no critical spec-review defects, and a confirmed invariant set. A mid-build goal change or a work-vs-spec contradiction surfaces via the Decision Pause Contract (spec.change / spec.contradiction) and is never resolved silently.',
          SPEC_REVIEW_ENFORCEMENT_INSTRUCTION,
          SPEC_PIPELINE_INSTRUCTION,
          'Freeze the spec before writing code on graduated/full lanes: run `paqad-ai spec freeze <spec-file> --signed-off-by <name> --confirm-invariants` and resolve every printed blocker (missing ACs/invariants, open questions) before development. It writes the frozen spec into the active feature bundle (`specification.json`) that development builds against and the spec-change guard checks for drift.',
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
          FULL_SUITE_INSTRUCTION,
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
          REVIEW_DIGEST_INSTRUCTION,
          REVIEW_DIGEST_REFRESH_INSTRUCTION,
          OUT_OF_SCOPE_FINDINGS_INSTRUCTION,
          "Record the review with `paqad-ai review record`. The review stage's artifact is the bundle's rigid review.json — a hand-written notes file is rejected, and nothing may be written into the feature bundle directory.",
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
          'Run them deterministically with `paqad-ai checks run`: it executes the mapped format/test/build commands, blocks (exits non-zero) on any red, and persists a structured report the completion gate reads so success is proven, not assumed. A red result is `Needs your attention` — fix it before finalizing.',
          'Before `paqad-ai checks run`, run `paqad-ai checks plan`. If it prints `test: sequential (unknown)`, run the test-runner-discovery skill and record its result with `paqad-ai checks record-runner <file>` before running the checks. Never ask the developer to add a parallel flag or install a package; a missing prerequisite is reported and the sequential command is used.',
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
          OUT_OF_SCOPE_FINDINGS_INSTRUCTION,
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
          "Deliver only through paqad: paqad-ai deliver commit for each commit, and paqad-ai deliver to push and open the PR. Both follow the team's rules in .paqad/configs/git-workflow/. Never run git commit, git push or gh pr create yourself for a change paqad is delivering.",
          "You supply the meaning: the ticket, the branch type when paqad asks for it, and a summary written for a person who doesn't read code. Say what changes for the user or the business, in plain words, with no file names, function names or code symbols. paqad builds the branch name, commit message and PR title from the team's templates.",
          "If the team's PR template has no placeholders, fill in each of its sections yourself and pass it with --body-file.",
          'When paqad prints a ticket move, make it with your tracker tool, then record it with paqad-ai deliver ticket-done <id>, or --failed / --skipped with the reason.',
          'Run the CI gate per process.ci: wait_for_green polls checks until green (timeout_minutes), applies on_red on failure, and queues the ticket move on green. A red build surfaces via a delivery.ci_red Decision Packet when on_red needs a human call.',
          'Graceful degradation: if a required provider (host/tracker MCP) is not connected, do what is possible (branch/commit always run), skip the provider-bound steps, and re-surface the connect nudge — do not hard stop.',
          'MCP / git / remote failures (auth, conflicts, branch protection) stop with actionable remediation — never silently fall back to a local-only commit.',
        ],
        required_inputs: ['merged change', 'git-workflow files'],
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

const WORKFLOW_FILE = 'feature-development/workflow.yaml';
const CHECKS_FILE = 'feature-development/checks.yaml';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function readTeamPolicyFile(
  projectRoot: string,
  file: typeof WORKFLOW_FILE | typeof CHECKS_FILE,
  warnings: string[],
): Record<string, unknown> {
  const { document, error } = readTeamYamlFile(projectRoot, file);
  if (error !== undefined) {
    warnings.push(invalidFileMessage(file, error));
    return {};
  }
  const data: unknown = document?.toJS();
  return isRecord(data) ? data : {};
}

function applyTeamChecks(
  base: FeatureDevelopmentChecksPolicy,
  raw: Record<string, unknown>,
  warnings: string[],
): FeatureDevelopmentChecksPolicy {
  const next: FeatureDevelopmentChecksPolicy = { ...base };
  const commands = isRecord(raw.commands) ? raw.commands : {};
  if (commands.from_project_profile !== undefined) {
    const names = stringList(commands.from_project_profile) as FeatureDevelopmentLogicalCommand[];
    next.commands = names;
    next.use_project_profile_commands = names.length > 0;
  }
  if (isRecord(commands.extra)) {
    next.shell_commands = appendUnique(
      base.shell_commands,
      stringList(Object.values(commands.extra)),
    );
  }
  if (raw.on_failure === 'warn' || raw.on_failure === 'block') {
    next.block_on_failure = raw.on_failure === 'block';
  } else if (raw.on_failure !== undefined) {
    warnings.push(
      `${CHECKS_FILE}: on_failure has an invalid value ${String(raw.on_failure)}, so paqad uses the default block. It must be one of: block, warn.`,
    );
  }
  return next;
}

export function loadFeatureDevelopmentPolicy(
  projectRoot: string,
  profile: Pick<ProjectProfile, 'commands'> | null = null,
): FeatureDevelopmentPolicyLoadResult {
  const warnings: string[] = [];
  const policy = defaultFeatureDevelopmentPolicy();
  const workflow = readTeamPolicyFile(projectRoot, WORKFLOW_FILE, warnings);
  const teamStages = isRecord(workflow.stages) ? workflow.stages : {};
  for (const stageName of WORKFLOW_POLICY_STAGES) {
    const team = isRecord(teamStages[stageName]) ? teamStages[stageName] : {};
    const stage = policy.stages[stageName];
    stage.read = appendUnique(stage.read, stringList(team.read));
    stage.instructions = appendUnique(stage.instructions, stringList(team.instructions));
  }
  const planning = isRecord(teamStages.planning) ? teamStages.planning : {};
  const attribution = planning.module_attribution;
  if (attribution === 'defer' || attribution === 'stop') {
    policy.stages.planning.escalation.attribution_pending = attribution;
  } else if (attribution !== undefined) {
    warnings.push(
      `${WORKFLOW_FILE}: stages.planning.module_attribution has an invalid value ${String(attribution)}, so paqad uses the default defer. It must be one of: defer, stop.`,
    );
  }
  const checks = policy.stages.checks.checks;
  if (checks !== null) {
    policy.stages.checks.checks = applyTeamChecks(
      checks,
      readTeamPolicyFile(projectRoot, CHECKS_FILE, warnings),
      warnings,
    );
  }
  const commandWarnings =
    profile === null ? [] : validateRequiredCommands(policy.stages.checks.checks, profile);
  return {
    policy: injectAnalyticsStageInstructions(policy, projectRoot),
    warnings: [...warnings, ...commandWarnings],
  };
}

export function moduleAttributionMode(policy: FeatureDevelopmentPolicy): string {
  return policy.stages.planning.escalation.attribution_pending ?? 'defer';
}

function injectAnalyticsStageInstructions(
  policy: FeatureDevelopmentPolicy,
  projectRoot: string,
): FeatureDevelopmentPolicy {
  let flagOn: boolean;
  try {
    flagOn = resolveFrameworkConfig(projectRoot).features.analytics_instrumentation;
    /* v8 ignore start -- defensive: a malformed config never breaks policy loading */
  } catch {
    flagOn = false;
  }
  /* v8 ignore stop */
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
      if (typeof resolved === 'string' && resolved.trim().length === 0) {
        warnings.push(`${logicalCommand} is not mapped in the profile; skipped`);
        continue;
      }
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

function appendUnique(base: string[], additions: string[] | undefined): string[] {
  return Array.from(new Set([...base, ...(additions ?? [])]));
}

function validateRequiredCommands(
  checks: FeatureDevelopmentChecksPolicy | null,
  profile: Pick<ProjectProfile, 'commands'>,
): string[] {
  const resolved = resolveFeatureDevelopmentCheckCommands(checks, profile);
  return resolved.warnings;
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
