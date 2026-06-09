import type { PhaseExecutor } from './phase.interface.js';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveFeatureDevelopmentCheckCommands,
  summarizeFeatureDevelopmentStage,
} from '@/pipeline/feature-development-policy.js';
import { engineLog } from '@/core/logger-registry.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { getPackTestRunners } from '@/packs/project-packs.js';
import { parseTestOutput } from '@/test-output/index.js';
import { syncModuleHealthFromVerification } from '@/planning/module-health-updater.js';
import { VerificationGateRunner } from '@/verification/gate-runner.js';
import { buildVerificationEvidence, writeVerificationEvidence } from '@/verification/evidence.js';
import { runMutationGate } from '@/mutation/index.js';
import { runQualityRatchetGate } from '@/quality-ratchet/index.js';
import { readTraceabilityMap } from '@/traceability/index.js';
import { DecisionStore } from '@/planning/decision-store.js';
import type { VerificationContext } from '@/core/types/verification.js';
import {
  detectStaleDocTargets,
  isCodeFile,
  isDocumentationFile,
  isTestFile,
  loadChangeEvidence,
} from '@/pipeline/change-evidence.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import type { ResolvedFeatureDevelopmentCheckCommand } from '@/core/types/feature-development-policy.js';
import { execaCommand } from 'execa';
import fg from 'fast-glob';
import { rm } from 'node:fs/promises';

import { createFailResult, createPassResult } from './shared.js';

export class VerificationPhase implements PhaseExecutor {
  readonly phase = 'verification-gates' as const;
  private readonly gateRunner = new VerificationGateRunner();

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    const profile = readProjectProfile(context.project_root);
    const stage = context.feature_policy?.stages.checks ?? null;
    const resolved = resolveFeatureDevelopmentCheckCommands(stage?.checks ?? null, profile);
    const stageSummary = summarizeFeatureDevelopmentStage(context.feature_policy, 'checks');

    if (resolved.warnings.length > 0 && stage?.checks?.block_on_failure) {
      return createFailResult(
        this.phase,
        `Verification blocked (${resolved.warnings.join(' ')})`,
        context,
      );
    }

    const commandSummary =
      resolved.commands.length > 0
        ? `commands: ${resolved.commands.map((command) => command.command).join('; ')}`
        : 'no configured commands';
    const verificationContext =
      context.verification_context ??
      (await buildDefaultVerificationContext(context, profile, resolved.commands));
    context.verification_context = verificationContext;
    const baseline = context.verification_baseline_results ?? [];
    const startedAt = new Date().toISOString();
    const { results, delta_payload } = await this.gateRunner.runWithDelta(
      verificationContext,
      baseline,
    );
    const completedAt = new Date().toISOString();
    context.verification_results = results;
    await writeVerificationEvidenceArtifact({
      projectRoot: context.project_root,
      verificationContext,
      results,
      startedAt,
      completedAt,
    });
    await syncModuleHealthFromVerification({
      projectRoot: context.project_root,
      verificationContext,
      results,
    });
    const failing = results.find((result) => !result.passed);
    const deltaSummary = `delta outcomes:${delta_payload.delta.changed_gate_outcomes.length}, evidence:${delta_payload.delta.changed_evidence.length}, actions:${delta_payload.delta.changed_recommended_actions.length}`;
    if (failing) {
      return createFailResult(
        this.phase,
        `Verification blocked (${failing.gate}: ${failing.detail}; ${deltaSummary}; ${commandSummary})`,
        context,
      );
    }

    return createPassResult(
      this.phase,
      stageSummary === null
        ? `Verification gates passed (${deltaSummary}; ${commandSummary})`
        : `Verification gates passed (${stageSummary}; ${deltaSummary}; ${commandSummary})`,
      context,
    );
  }
}

async function buildDefaultVerificationContext(
  context: Parameters<PhaseExecutor['execute']>[0],
  profile: ReturnType<typeof readProjectProfile>,
  commands: ResolvedFeatureDevelopmentCheckCommand[],
): Promise<VerificationContext> {
  const changeEvidence = await loadChangeEvidence(context.project_root);
  const changedFiles = changeEvidence.files;
  const staleDocTargets = await detectStaleDocTargets(context.project_root, changedFiles);
  const modules = context.classification.affected_modules;
  const commandResults = await runVerificationCommands(context.project_root, profile, commands);

  // Issue #105 — plant mutants in the changed code only once the suite is
  // already green, so survivors mean "a wrong implementation would pass," not
  // "the build is broken." Never throws; failures surface as a skipped result.
  const mutationResult = await runMutationGate({
    projectRoot: context.project_root,
    changedFiles,
    lane: context.lane,
    stackProfile: profile?.stack_profile ?? null,
    testsGreen: commandResults.test_commands_passed,
  });

  // Issue #110 — the quality ratchet. Consumes #109's reachability/orphan output
  // for the dead-code measure (one solver, two uses) and compares the four
  // measures against the recorded baseline. Never throws; a missing baseline is
  // captured rather than failed, so day one is not an impossible clean-up.
  const qualityRatchetResult = await runQualityRatchetGate({
    projectRoot: context.project_root,
    changedFiles,
    lane: context.lane,
    stackProfile: profile?.stack_profile ?? null,
    deadCodeFiles: await readDeadCodeFiles(context.project_root),
    decisionStore: new DecisionStore(context.project_root),
  });

  return {
    project_root: context.project_root,
    verification_origin: 'provider-workflow',
    verification_stage: 'provider-completion',
    modules,
    changed_files: changedFiles,
    changed_files_source: changeEvidence.source,
    code_changed: changedFiles.some((filePath) => isCodeFile(filePath)),
    test_files_changed: changedFiles.some((filePath) => isTestFile(filePath)),
    documentation_files_changed: changedFiles.some((filePath) => isDocumentationFile(filePath)),
    stale_doc_targets: staleDocTargets,
    requirements_complete: true,
    story_quality_passed: true,
    ac_test_mapping_passed: true,
    spec_review_passed: true,
    architecture_compliant: true,
    code_tests_lint_passed: commandResults.all_passed,
    implementation_review_passed: true,
    behavioral_correctness_passed: commandResults.test_commands_passed,
    database_quality_passed: true,
    structured_test_results: commandResults.structured_test_results,
    mutation_result: mutationResult,
    quality_ratchet_result: qualityRatchetResult,
    lane: context.lane,
    expected_ui_modules: [],
    expected_api_modules: [],
    expected_integration_modules: [],
    expected_error_catalog_modules: [],
    registry_refreshed_at: new Date().toISOString(),
    glossary_updated: true,
  };
}

/**
 * Issue #110 — read the dead/orphan file set from #109's traceability map. We
 * consume the reachability solver's output (`role: 'orphan'` backward links),
 * never re-scanning for dead code. Returns null when the map is unavailable or
 * its orphan flagging was suppressed (no known anchors), so the dead-code
 * measure records blocked rather than flagging a whole tree by mistake.
 */
async function readDeadCodeFiles(projectRoot: string): Promise<string[] | null> {
  const map = await readTraceabilityMap(projectRoot);
  if (map === null || !map.anchors_known) {
    return null;
  }
  return map.backward.filter((link) => link.role === 'orphan').map((link) => link.file);
}

interface VerificationCommandRunResult {
  all_passed: boolean;
  test_commands_passed: boolean;
  structured_test_results: StructuredTestResult[] | undefined;
}

async function runVerificationCommands(
  projectRoot: string,
  profile: ReturnType<typeof readProjectProfile>,
  commands: ResolvedFeatureDevelopmentCheckCommand[],
): Promise<VerificationCommandRunResult> {
  if (profile?.stack_profile === undefined || commands.length === 0) {
    return {
      all_passed: true,
      test_commands_passed: true,
      structured_test_results: undefined,
    };
  }

  const runners = getPackTestRunners(profile.stack_profile.frameworks, projectRoot);
  const structuredResults: StructuredTestResult[] = [];
  let allPassed = true;
  let hasTestCommand = false;
  let testCommandsPassed = true;

  for (const command of commands) {
    if (!shouldExecuteVerificationCommand(projectRoot, command.command)) {
      continue;
    }

    const runner = selectRunnerForCommand(command, runners);
    if (command.logical_command === 'test') {
      hasTestCommand = true;
      if (runner && runner.output_source === 'file') {
        await clearPriorStructuredOutputs(projectRoot, runner.output_path_pattern);
      }
    }

    const result = await execaCommand(command.command, {
      cwd: projectRoot,
      reject: false,
      shell: true,
    });

    if (result.exitCode !== 0) {
      allPassed = false;
      if (command.logical_command === 'test') {
        testCommandsPassed = false;
      }
    }

    if (command.logical_command === 'test' && runner) {
      const structuredResult = await parseTestOutput({
        runner,
        cwd: projectRoot,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      structuredResults.push(structuredResult);
    }
  }

  return {
    all_passed: allPassed,
    test_commands_passed: hasTestCommand ? testCommandsPassed : allPassed,
    structured_test_results: structuredResults.length > 0 ? structuredResults : undefined,
  };
}

function shouldExecuteVerificationCommand(projectRoot: string, command: string): boolean {
  const normalized = command.trim().toLowerCase();

  if (normalized.length === 0) {
    return false;
  }

  if (
    normalized.startsWith('node ') ||
    normalized.startsWith('bash ') ||
    normalized.startsWith('sh ')
  ) {
    return true;
  }

  if (/^(pnpm|npm|yarn)\b/u.test(normalized)) {
    return existsSync(join(projectRoot, 'package.json'));
  }

  if (/^(php|composer|vendor\/bin\/sail)\b/u.test(normalized)) {
    return (
      existsSync(join(projectRoot, 'composer.json')) || existsSync(join(projectRoot, 'artisan'))
    );
  }

  if (/^go\s+/u.test(normalized)) {
    return existsSync(join(projectRoot, 'go.mod'));
  }

  if (/^cargo\s+/u.test(normalized)) {
    return existsSync(join(projectRoot, 'Cargo.toml'));
  }

  if (/^flutter\s+/u.test(normalized)) {
    return existsSync(join(projectRoot, 'pubspec.yaml'));
  }

  if (/^(bundle|rspec|rake)\b/u.test(normalized)) {
    return existsSync(join(projectRoot, 'Gemfile'));
  }

  if (/^dotnet\s+/u.test(normalized)) {
    return readdirSync(projectRoot).some(
      (entry) => entry.endsWith('.sln') || entry.endsWith('.csproj'),
    );
  }

  return true;
}

function selectRunnerForCommand(
  command: ResolvedFeatureDevelopmentCheckCommand,
  runners: ReturnType<typeof getPackTestRunners>,
) {
  if (command.logical_command !== 'test' || runners.length === 0) {
    return null;
  }

  const normalizedCommand = command.command.toLowerCase();
  const exactMatch = runners.find((runner) =>
    normalizedCommand.includes(runner.runner_id.toLowerCase()),
  );
  return exactMatch ?? runners[0] ?? null;
}

async function clearPriorStructuredOutputs(
  projectRoot: string,
  outputPathPattern: string | undefined,
): Promise<void> {
  if (!outputPathPattern) {
    return;
  }

  const matches = await fg(outputPathPattern, {
    cwd: projectRoot,
    absolute: true,
    onlyFiles: true,
  });

  await Promise.all(matches.map((path) => rm(path, { force: true })));
}

interface WriteEvidenceArtifactInput {
  projectRoot: string;
  verificationContext: VerificationContext;
  results: Awaited<ReturnType<VerificationGateRunner['run']>>;
  startedAt: string;
  completedAt: string;
}

async function writeVerificationEvidenceArtifact(input: WriteEvidenceArtifactInput): Promise<void> {
  const evidence = buildVerificationEvidence({
    results: input.results,
    context: {
      structured_test_results: input.verificationContext.structured_test_results,
      mutation_result: input.verificationContext.mutation_result,
    },
    run_id: `verification-${input.startedAt}`,
    started_at: input.startedAt,
    completed_at: input.completedAt,
  });

  try {
    await writeVerificationEvidence(evidence, { project_root: input.projectRoot });
  } catch (error) {
    // Evidence file is a side-channel artifact; never fail the verification phase
    // because of an I/O issue here. Surface a single warning and continue.
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: could not write verification-evidence.json (${message})`);
  }
}
