import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { AdapterFactory } from '@/adapters/factory.js';
import { ChunkIndexManager } from '@/context/chunk-index.js';
import { PATHS, REGISTRIES } from '@/core/constants/paths.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { describeOptionalEngine, ENGINE_INSTALL_NETWORK_HINT } from '@/core/optional-package.js';
import { getDefaultEmbeddingModel } from '@/core/project-intelligence.js';
import { SCHEMA_VERSION_UPDATE_HINT } from '@/core/errors/schema-version-error.js';
import { checkSchemaCompatibility, readSchemaMarkerSync } from '@/core/schema-version.js';
import { getProfileDomain, readProjectProfile } from '@/core/project-profile.js';
import { visualEvidenceReadiness } from '@/visual-evidence/readiness.js';
import { isFrameworkDisabledForRoot } from '@/core/framework-enabled.js';
import { getSecretPermissionWarning } from '@/rag/secrets.js';
import { describeFrameworkLink } from '@/health/plugin-install.js';
import { describeClaudeInstall } from '@/install/plugin-migration.js';
import { RagService } from '@/rag/service.js';
import { FileVectorIndex } from '@/rag/vector-index.js';
import { getLegacyCapabilities, getPrimaryStack } from '@/core/stack-profile.js';
import { getServersForStack } from '@/mcp/server-registry.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { SkillCacheManager } from '@/skills/cache-manager.js';
import { getPackTestRunners } from '@/packs/project-packs.js';
import { parseTestOutput } from '@/test-output/index.js';
import { TEST_OUTPUT_SMOKE_FIXTURES } from '@/test-output/fixtures.js';
import { deriveHealthTier } from '@/planning/module-health.js';
import { isCompiledRulesStale } from '@/planning/rule-compiler.js';
import { buildFeatureSpec } from '@/spec/feature-spec-builder.js';
import { expertsActive, readPipelineConfig, standingBudgetSum } from '@/spec-pipeline/config.js';
import { resolveEffectiveConfig } from '@/cli/commands/config.js';
import { EXPERT_ROLES } from '@/spec-pipeline/experts/roster.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { checkSpecShape, PARITY_CORPUS } from '@/spec-pipeline/parser-parity.js';
import type {
  HealthCheckResult,
  HealthEfficiencySummary,
  HealthReport,
  HealthCheckStatus,
} from '@/core/types/health.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import { SchemaValidator } from '@/validators/validator.js';
import {
  inspectProviderEntryBootstrapPointer,
  inspectProviderEntryFallbackClause,
} from './provider-entry-contract.js';

const STALENESS_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

const SENTINEL_DIR = '.paqad/.agent-entry-loaded.d';

export interface HealthCheckerOptions {
  managedSettingsPaths?: string[];
}

export class HealthChecker {
  private readonly validator = new SchemaValidator();

  constructor(private readonly options: HealthCheckerOptions = {}) {}

  async run(projectRoot: string): Promise<HealthReport> {
    const profile = this.readProfile(projectRoot);
    const modules = this.detectModules(projectRoot);
    const checks: HealthCheckResult[] = [
      this.checkFrameworkArtifacts(projectRoot),
      this.checkProfile(profile),
      this.checkDetectionReport(projectRoot),
      this.checkOnboardingManifest(projectRoot),
      this.checkDecisionWorkspace(projectRoot),
      this.checkStackSnapshot(projectRoot),
      this.checkStackDrift(projectRoot),
      this.checkModuleHealthLedger(projectRoot),
      this.checkInstructionCopies(projectRoot, profile),
      this.checkIndexesCurrent(projectRoot),
      this.checkAdapterConfig(projectRoot),
      this.checkCodexHooks(projectRoot),
      this.checkGateFailClosed(projectRoot),
      this.checkProviderEntryBootstrapPointer(projectRoot),
      this.checkProviderEntryFallbackClause(projectRoot),
      this.checkStackCommands(profile),
      this.checkTestRunnerParallel(profile),
      ...(await this.checkStructuredTestOutput(projectRoot, profile)),
      this.checkStableFrameworkPaths(projectRoot),
      this.checkTrackedSentinels(projectRoot),
      this.checkFrameworkInstall(),
      this.checkClaudeInstall(projectRoot),
      this.checkSchemaVersion(projectRoot),
      this.checkBrokenScaffold(projectRoot),
      this.checkUiDocs(projectRoot, modules),
      this.checkApiDocs(projectRoot, modules),
      this.checkIntegrationDocs(projectRoot, modules),
      this.checkErrorCatalog(projectRoot, modules),
      this.checkMcp(projectRoot, profile),
      this.checkSkillCache(projectRoot),
      this.checkContextHitRate(projectRoot, profile),
      this.checkLeanRuleFootprint(projectRoot),
      await this.checkCompiledRulesCurrent(projectRoot),
      this.checkClassificationOverrideRate(projectRoot),
      ...(await this.checkRag(projectRoot, profile)),
      this.checkSpecPipeline(projectRoot),
      this.checkSpecPipelineSettings(projectRoot),
      ...this.checkExpertRoster(projectRoot),
      ...this.checkVisualEvidence(projectRoot),
    ];

    const overallStatus = deriveOverallStatus(checks);

    return {
      overall_status: overallStatus,
      checks,
      efficiency: await this.buildEfficiencySummary(projectRoot),
    };
  }

  private readProfile(projectRoot: string): ProjectProfile | null {
    return readProjectProfile(projectRoot);
  }

  private detectModules(projectRoot: string): string[] {
    const modulesRoot = join(projectRoot, 'docs/modules');
    if (!existsSync(modulesRoot)) {
      return [];
    }

    return readdirSync(modulesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  private checkFrameworkArtifacts(projectRoot: string): HealthCheckResult {
    const required = [PATHS.PROJECT_PROFILE, PATHS.FRAMEWORK_PATH];
    const missing = required.filter((relative) => !existsSync(join(projectRoot, relative)));

    return missing.length === 0
      ? pass('Framework artifacts exist', 'Framework artifacts are present')
      : fail(
          'Framework artifacts exist',
          `Missing framework artifacts: ${missing.join(', ')}`,
          'Re-run onboarding to regenerate the missing framework artifacts.',
        );
  }

  private isPathIgnored(projectRoot: string, relPath: string, directory = false): boolean {
    const target = relPath.replace(/\/$/, '');
    const probe = directory ? `${target}/` : target;
    try {
      execFileSync('git', ['check-ignore', '-q', '--', probe], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      return true;
    } catch (error) {
      if ((error as { status?: number }).status === 1) {
        return false;
      }
    }

    const probes: Array<[string, string]> = [
      [join(projectRoot, '.gitignore'), target],
      [join(projectRoot, '.paqad', '.gitignore'), target.replace(/^\.paqad\//, '')],
    ];
    for (const [file, needle] of probes) {
      if (existsSync(file) && readFileSync(file, 'utf8').includes(needle)) {
        return true;
      }
    }
    return false;
  }

  private checkProfile(profile: ProjectProfile | null): HealthCheckResult {
    if (profile === null) {
      return fail(
        'Profile is valid',
        'Project profile is missing or unreadable',
        'Regenerate the project profile.',
      );
    }

    const validation = this.validator.validate('project-profile', profile);
    return validation.valid
      ? pass('Profile is valid', 'Project profile schema is valid')
      : fail(
          'Profile is valid',
          validation.errors.map((error) => error.message).join('; '),
          'Fix the invalid project profile fields.',
        );
  }

  private checkDetectionReport(projectRoot: string): HealthCheckResult {
    return this.checkJsonArtifact({
      projectRoot,
      relativePath: PATHS.DETECTION_REPORT,
      name: 'Detection report is valid',
      schemaId: 'detection-report',
      missingRemediation:
        'Run `paqad-ai join` to regenerate the detection report (a per-machine artifact).',
      invalidRemediation: 'Fix or regenerate the detection report JSON.',
    });
  }

  private checkOnboardingManifest(projectRoot: string): HealthCheckResult {
    return this.checkJsonArtifact({
      projectRoot,
      relativePath: PATHS.ONBOARDING_MANIFEST,
      name: 'Onboarding manifest is valid',
      schemaId: 'onboarding-manifest',
      missingRemediation: 'Re-run onboarding to regenerate the onboarding manifest.',
      invalidRemediation: 'Fix or regenerate the onboarding manifest JSON.',
    });
  }

  private checkStackSnapshot(projectRoot: string): HealthCheckResult {
    const path = join(projectRoot, PATHS.STACK_SNAPSHOT);
    if (!existsSync(path)) {
      return fail(
        'Stack snapshot present',
        'Stack snapshot is missing',
        'Run `paqad-ai join` (or onboarding/refresh) to regenerate the stack snapshot.',
      );
    }

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        toolchains?: unknown;
        packages?: unknown;
        profile?: {
          frameworks?: unknown;
        };
      };
      const valid =
        Array.isArray(parsed.toolchains) &&
        Array.isArray(parsed.packages) &&
        Array.isArray(parsed.profile?.frameworks);
      return valid
        ? pass('Stack snapshot present', 'Stack snapshot is present and readable')
        : fail(
            'Stack snapshot present',
            'Stack snapshot JSON is missing required sections',
            'Run refresh to regenerate the stack snapshot.',
          );
    } catch {
      return fail(
        'Stack snapshot present',
        'Stack snapshot JSON is unreadable',
        'Run refresh to regenerate the stack snapshot.',
      );
    }
  }

  private checkStackDrift(projectRoot: string): HealthCheckResult {
    const path = join(projectRoot, PATHS.STACK_DRIFT);
    if (!existsSync(path)) {
      return fail(
        'Stack drift report present',
        'Stack drift report is missing',
        'Run `paqad-ai join` (or onboarding/refresh) to regenerate the stack drift report.',
      );
    }

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        status?: unknown;
        generated_at?: unknown;
      };
      const valid = typeof parsed.status === 'string' && typeof parsed.generated_at === 'string';
      return valid
        ? pass('Stack drift report present', 'Stack drift report is present and readable')
        : fail(
            'Stack drift report present',
            'Stack drift report JSON is missing required fields',
            'Run refresh to regenerate the stack drift report.',
          );
    } catch {
      return fail(
        'Stack drift report present',
        'Stack drift report JSON is unreadable',
        'Run refresh to regenerate the stack drift report.',
      );
    }
  }

  private checkDecisionWorkspace(projectRoot: string): HealthCheckResult {
    const required = [
      PATHS.DECISIONS_PENDING_DIR,
      PATHS.DECISIONS_RESOLVED_DIR,
      PATHS.DECISIONS_EXPIRED_DIR,
      PATHS.DECISIONS_INDEX,
    ];
    const missing = required.filter((relativePath) => !existsSync(join(projectRoot, relativePath)));

    return missing.length === 0
      ? pass('Decision workspace ready', 'Decision storage directories and index are present')
      : warn(
          'Decision workspace ready',
          `Missing decision artifacts: ${missing.join(', ')}`,
          'Run onboarding or refresh to regenerate the decision workspace.',
        );
  }

  private checkModuleHealthLedger(projectRoot: string): HealthCheckResult {
    const root = join(projectRoot, PATHS.PLANNING_MODULE_HEALTH_DIR);
    if (!existsSync(root)) {
      return pass(
        'Module health ledger valid',
        'No module health profiles yet — created on demand as modules accrue evidence',
      );
    }

    const files = walk(root).filter((file) => file.endsWith('.json'));
    const issues: string[] = [];

    for (const file of files) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
          module?: unknown;
          tier?: unknown;
          metrics?: unknown;
          updated_at?: unknown;
        };
        if (
          typeof parsed.module !== 'string' ||
          typeof parsed.tier !== 'string' ||
          typeof parsed.metrics !== 'object' ||
          parsed.metrics === null ||
          typeof parsed.updated_at !== 'string'
        ) {
          issues.push(`${relativeTo(projectRoot, file)} missing required fields`);
          continue;
        }
        const expectedTier = deriveHealthTier(parsed.metrics);
        if (parsed.tier !== expectedTier) {
          issues.push(
            `${relativeTo(projectRoot, file)} tier is ${parsed.tier}; expected ${expectedTier}`,
          );
        }
      } catch {
        issues.push(`${relativeTo(projectRoot, file)} is unreadable JSON`);
      }
    }

    return issues.length === 0
      ? pass('Module health ledger valid', 'Module health profiles are valid and tier-consistent')
      : fail(
          'Module health ledger valid',
          issues.join('; '),
          'Repair module health profiles or run module-health sync with current evidence.',
        );
  }

  private checkInstructionCopies(
    projectRoot: string,
    profile: ProjectProfile | null,
  ): HealthCheckResult {
    const rulesRoot = join(projectRoot, PATHS.RULES_DIR);
    const stack = profile === null ? null : getPrimaryStack(profile);
    const toolsRoot =
      stack === null || profile === null || getProfileDomain(profile) !== 'coding'
        ? null
        : join(projectRoot, PATHS.TOOLS_DIR, stack);

    const missing: string[] = [];
    if (!existsSync(rulesRoot)) {
      missing.push(PATHS.RULES_DIR);
    }
    if (toolsRoot !== null && !existsSync(toolsRoot)) {
      missing.push(join(PATHS.TOOLS_DIR, stack ?? 'unknown'));
    }

    return missing.length === 0
      ? pass('Instruction copies exist', 'Copied rules and tools are present')
      : fail(
          'Instruction copies exist',
          `Missing copied instruction artifacts: ${missing.join(', ')}`,
          'Re-run onboarding to restore the copied instruction bundles.',
        );
  }

  private checkIndexesCurrent(projectRoot: string): HealthCheckResult {
    const missing = REGISTRIES.filter(
      (registry) => !existsSync(join(projectRoot, PATHS.REGISTRIES_DIR, registry)),
    );
    const statusPath = join(projectRoot, '.paqad/indexes/registry-status.json');

    if (missing.length > 0 || !existsSync(statusPath)) {
      return warn(
        'Indexes are current',
        'Registry scaffold has not been generated yet',
        'Run the documentation workflow to generate registries.',
      );
    }

    const stale = isStale(statSync(statusPath).mtimeMs);
    return stale
      ? warn('Indexes are current', 'Registries are stale', 'Run the documentation workflow again.')
      : pass('Indexes are current', 'Registries are present and current');
  }

  private checkAdapterConfig(projectRoot: string): HealthCheckResult {
    const configs = ADAPTER_TYPES.map((type) => AdapterFactory.create(type).getConfigPath());
    const existing = configs.filter((config) => existsSync(join(projectRoot, config)));

    return existing.length > 0
      ? pass('Adapter config is present', 'Adapter config files are present')
      : fail(
          'Adapter config is present',
          'No adapter config files were found',
          'Regenerate the adapter configuration.',
        );
  }

  private checkCodexHooks(projectRoot: string): HealthCheckResult {
    const name = 'Codex hooks wired';
    if (!existsSync(join(projectRoot, '.codex'))) {
      return pass(name, 'No .codex/ directory — not a Codex project, nothing to check.');
    }
    const trustStep =
      'Re-run onboarding with the codex-cli adapter, then open Codex in the project, run /hooks, and approve paqad\u2019s hooks.';
    const hooksPath = join(projectRoot, '.codex', 'hooks.json');
    if (!existsSync(hooksPath)) {
      return warn(
        name,
        'A .codex/ project has no .codex/hooks.json — paqad hooks are not wired.',
        trustStep,
      );
    }
    let hooks: Record<string, unknown>;
    try {
      const parsed = JSON.parse(readFileSync(hooksPath, 'utf8')) as { hooks?: unknown };
      hooks =
        parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)
          ? (parsed.hooks as Record<string, unknown>)
          : {};
    } catch {
      return warn(
        name,
        '.codex/hooks.json is unreadable JSON.',
        'Re-run onboarding to regenerate .codex/hooks.json.',
      );
    }
    const required: ReadonlyArray<readonly [string, string]> = [
      ['PreToolUse', 'agent-entry-gate.mjs'],
      ['UserPromptSubmit', 'agent-entry-prompt-gate.mjs'],
      ['SessionStart', 'agent-entry-session-start.mjs'],
      ['Stop', 'verification-completion.mjs'],
    ];
    const missing = required
      .filter(([event, script]) => !JSON.stringify(hooks[event] ?? []).includes(script))
      .map(([event]) => event);
    if (missing.length > 0) {
      return warn(
        name,
        `.codex/hooks.json is missing paqad hooks for: ${missing.join(', ')}.`,
        trustStep,
      );
    }
    return pass(
      name,
      'All four Codex events carry paqad hooks. If a gate never fires, run /hooks in Codex and approve them (project hooks load only when the .codex/ layer is trusted).',
    );
  }

  private checkGateFailClosed(projectRoot: string): HealthCheckResult {
    const name = 'Edit gates fail closed';
    const settingsPath = join(projectRoot, '.claude', 'settings.json');
    if (!existsSync(settingsPath)) {
      return pass(name, 'No .claude/settings.json — not a Claude Code project, nothing to check.');
    }
    let preTool: Array<{ hooks?: Array<{ command?: unknown; onFailure?: unknown }> }>;
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
        hooks?: { PreToolUse?: unknown };
      };
      preTool = Array.isArray(parsed.hooks?.PreToolUse)
        ? (parsed.hooks!.PreToolUse as typeof preTool)
        : [];
    } catch {
      return warn(
        name,
        '.claude/settings.json is unreadable JSON.',
        'Re-run onboarding to regenerate .claude/settings.json.',
      );
    }
    const gates: ReadonlyArray<readonly [string, (cmd: string) => boolean]> = [
      ['agent-entry-gate', (cmd) => cmd.includes('agent-entry-gate.mjs')],
      ['decision-pause-gate', (cmd) => cmd.includes('decision-pause-gate.mjs')],
      [
        'capability-gate (pre-mutation)',
        (cmd) => cmd.includes('capability-gate.mjs') && cmd.includes('pre-mutation'),
      ],
    ];
    const missing: string[] = [];
    for (const [label, matches] of gates) {
      let found = false;
      let hasOnFailure = false;
      for (const group of preTool) {
        for (const hook of group.hooks ?? []) {
          if (typeof hook.command === 'string' && matches(hook.command)) {
            found = true;
            if (hook.onFailure !== undefined) {
              hasOnFailure = true;
            }
          }
        }
      }
      if (found && !hasOnFailure) {
        missing.push(label);
      }
    }
    if (missing.length > 0) {
      return warn(
        name,
        `These Claude edit gates are missing onFailure (an install onboarded before the edit gates failed closed): ${missing.join(', ')}.`,
        'Re-run onboarding to regenerate .claude/settings.json with fail-closed edit gates.',
      );
    }
    return pass(name, 'The Claude edit gates render onFailure: "block" with a timeout.');
  }

  private checkProviderEntryBootstrapPointer(projectRoot: string): HealthCheckResult {
    const result = inspectProviderEntryBootstrapPointer(projectRoot);
    const label = 'Entry files point to the framework bootstrap';

    if (result.status === 'pass') {
      return pass(label, result.detail);
    }

    if (result.status === 'warning') {
      return warn(label, result.detail, result.remediation);
    }

    return fail(label, result.detail, result.remediation);
  }

  private checkProviderEntryFallbackClause(projectRoot: string): HealthCheckResult {
    const result = inspectProviderEntryFallbackClause(projectRoot);
    const label = 'Entry files carry the graceful-degradation fallback clause';

    if (result.status === 'pass') {
      return pass(label, result.detail);
    }

    if (result.status === 'warning') {
      return warn(label, result.detail, result.remediation);
    }

    return fail(label, result.detail, result.remediation);
  }

  private checkStackCommands(profile: ProjectProfile | null): HealthCheckResult {
    if (profile === null) {
      return fail(
        'Stack commands configured',
        'Project profile is missing',
        'Restore a valid project profile.',
      );
    }

    if (!profile.commands || typeof profile.commands !== 'object') {
      return fail(
        'Stack commands configured',
        'Project commands are missing from the profile',
        'Restore the commands block in the project profile.',
      );
    }

    const missing = Object.entries(profile.commands)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key);

    return missing.length === 0
      ? pass('Stack commands configured', 'Required stack commands are populated')
      : fail(
          'Stack commands configured',
          `Missing command definitions: ${missing.join(', ')}`,
          'Populate the missing command entries in the project profile.',
        );
  }

  private checkTestRunnerParallel(profile: ProjectProfile | null): HealthCheckResult {
    const name = 'Test runner parallel mode';
    const testing = profile?.testing;
    if (!testing) {
      return pass(
        name,
        'No parallel-test decision recorded yet; it is derived on the next `paqad-ai checks run`.',
      );
    }
    if (testing.parallel === 'native' || testing.parallel === 'available') {
      return pass(
        name,
        `The suite runs in parallel (${testing.parallel}) via ${testing.runner_id}.`,
      );
    }
    const reason = testing.reason ?? testing.parallel;
    let suggestion = `Recorded ${testing.parallel} for ${testing.runner_id}: ${reason}.`;
    if (testing.parallel === 'unavailable' && reason.endsWith('-missing')) {
      const pkg = reason.replace(/-missing$/, '');
      suggestion += ` Add ${pkg} as a dev dependency to run the suite in parallel.`;
    }
    return warn(name, `The suite runs sequentially (${testing.parallel}).`, suggestion);
  }

  private async checkStructuredTestOutput(
    projectRoot: string,
    profile: ProjectProfile | null,
  ): Promise<HealthCheckResult[]> {
    const frameworks = profile?.stack_profile?.frameworks ?? [];
    if (frameworks.length === 0) {
      return [
        pass(
          'Structured test output ready',
          'No coding stack profile is active, so structured test-output checks are not required',
        ),
      ];
    }

    const runners = getPackTestRunners(frameworks, projectRoot);
    if (runners.length === 0) {
      return [
        warn(
          'Structured test output ready',
          `No test runners are declared for the active frameworks: ${frameworks.join(', ')}`,
          'Add test_runners metadata for the active stack packs.',
        ),
      ];
    }

    for (const runner of runners) {
      const fixture = TEST_OUTPUT_SMOKE_FIXTURES[runner.structured_format];
      if (!fixture) {
        return [
          fail(
            'Structured test output ready',
            `No smoke fixture is available for runner "${runner.runner_id}" (${runner.structured_format})`,
            'Add a parser smoke fixture for the runner format.',
          ),
        ];
      }

      try {
        await parseTestOutput({
          runner,
          cwd: projectRoot,
          stdout: fixture,
        });
      } catch (error) {
        return [
          fail(
            'Structured test output ready',
            `Runner "${runner.runner_id}" failed parser smoke validation: ${error instanceof Error ? error.message : String(error)}`,
            'Fix the parser, fixture, or runner declaration before relying on structured test output.',
          ),
        ];
      }
    }

    return [
      pass(
        'Structured test output ready',
        `Structured test parsing is ready for ${runners.map((runner) => runner.runner_id).join(', ')}`,
      ),
    ];
  }

  private checkTrackedSentinels(projectRoot: string): HealthCheckResult {
    const name = 'Session sentinels untracked';
    let tracked: string;
    try {
      tracked = execFileSync('git', ['ls-files', '--', SENTINEL_DIR], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return pass(name, 'Not a git repository, nothing to check');
    }
    const count = tracked.split('\n').filter((line) => line.trim().length > 0).length;
    return count === 0
      ? pass(name, `git tracks nothing under ${SENTINEL_DIR}`)
      : warn(
          name,
          `git tracks ${count} per-session file(s) under ${SENTINEL_DIR}, so every session dirties the tree`,
          `Run \`git rm -r --cached ${SENTINEL_DIR}\` and commit the change.`,
        );
  }

  private checkStableFrameworkPaths(projectRoot: string): HealthCheckResult {
    if (isFrameworkDisabledForRoot(projectRoot)) {
      return pass(
        'Stable framework paths only',
        'paqad is disabled (vanilla mode) — gates, hooks, and the verification backstop are a no-op. Re-enable with `paqad-ai enable`.',
      );
    }

    const frameworkPath = join(projectRoot, PATHS.FRAMEWORK_PATH);
    if (!existsSync(frameworkPath)) {
      return fail(
        'Stable framework paths only',
        'Framework path file is missing',
        'Re-run onboarding to write the framework path.',
      );
    }

    const value = readFileSync(frameworkPath, 'utf8').trim();
    const unstable =
      value.includes('npx') || value.includes('npm-global') || value.includes('.npm/_npx');

    return unstable
      ? fail(
          'Stable framework paths only',
          'Framework path points to an ephemeral install location',
          'Reinstall the framework to a stable user-level path and re-run onboarding.',
        )
      : pass('Stable framework paths only', 'Framework path is stable');
  }

  private checkClaudeInstall(projectRoot: string): HealthCheckResult {
    const line = describeClaudeInstall(undefined, projectRoot, process.env, {
      managedSettingsPaths: this.options.managedSettingsPaths,
    });
    return line.level === 'warning'
      ? warn('Claude Code install', line.detail, line.remediation ?? '')
      : pass('Claude Code install', line.detail);
  }

  private checkFrameworkInstall(): HealthCheckResult {
    const name = 'Framework install';
    const info = describeFrameworkLink();

    if (info.copy === 'directory') {
      return pass(name, `Framework home is a directory at ${info.home}.`);
    }
    if (info.linkTarget === null) {
      return warn(
        name,
        `Framework link ${info.home} is missing.`,
        'Restore it with `ln -sfn "$(npm root -g)/paqad-ai/runtime" ~/.paqad-ai/current` (npm copy), or start a Claude Code session with the paqad plugin installed, to re-point it.',
      );
    }
    if (!info.targetExists) {
      return warn(
        name,
        `Framework link ${info.home} points at a missing target (${info.linkTarget}).`,
        'Restore it with `ln -sfn "$(npm root -g)/paqad-ai/runtime" ~/.paqad-ai/current` (npm copy), or start a Claude Code session with the paqad plugin installed, to re-point the link.',
      );
    }
    const copyLabel = info.copy === 'unknown' ? 'framework' : info.copy;
    const version = info.version === null ? '' : ` (v${info.version})`;
    return pass(
      name,
      `Framework link points at the ${copyLabel} copy${version} at ${info.linkTarget}.`,
    );
  }

  private checkSchemaVersion(projectRoot: string): HealthCheckResult {
    const name = 'Schema version';
    const marker = readSchemaMarkerSync(projectRoot);
    if (!marker || checkSchemaCompatibility(marker) !== 'future') {
      return pass(name, 'The .paqad/ layout matches this paqad version.');
    }
    return warn(
      name,
      `The .paqad/ layout was written by a newer paqad (schema ${marker.paqad_schema_version}).`,
      SCHEMA_VERSION_UPDATE_HINT,
    );
  }

  private checkBrokenScaffold(projectRoot: string): HealthCheckResult {
    const broken = walk(projectRoot).filter(
      (path) => path.endsWith('.partial') || path.endsWith('.tmp'),
    );
    return broken.length === 0
      ? pass('No broken scaffold state', 'No partial scaffold artifacts detected')
      : fail(
          'No broken scaffold state',
          `Partial scaffold artifacts detected: ${broken.join(', ')}`,
          'Remove the partial files and re-run onboarding or update.',
        );
  }

  private checkUiDocs(projectRoot: string, modules: string[]): HealthCheckResult {
    if (!this.documentationHasRun(projectRoot) || modules.length === 0) {
      return pass('UI docs present', 'UI docs are checked after documentation generation');
    }

    const missing = modules.filter(
      (moduleName) =>
        !existsSync(join(projectRoot, 'docs/modules', moduleName, 'ui/screens.md')) ||
        !existsSync(join(projectRoot, 'docs/modules', moduleName, 'ui/components.md')) ||
        !existsSync(join(projectRoot, 'docs/modules', moduleName, 'ui/states.md')),
    );

    return missing.length === 0
      ? pass('UI docs present', 'UI docs are present for all modules with UI docs')
      : fail(
          'UI docs present',
          `Missing UI docs for: ${missing.join(', ')}`,
          'Add the missing UI documentation files.',
        );
  }

  private checkApiDocs(projectRoot: string, modules: string[]): HealthCheckResult {
    if (!this.documentationHasRun(projectRoot) || modules.length === 0) {
      return pass('API docs present', 'API docs are checked after documentation generation');
    }

    const missing = modules.filter(
      (moduleName) =>
        !existsSync(join(projectRoot, 'docs/modules', moduleName, 'api/endpoints.md')) ||
        !existsSync(join(projectRoot, 'docs/modules', moduleName, 'api/schemas.md')) ||
        !existsSync(join(projectRoot, 'docs/modules', moduleName, 'api/error-codes.md')),
    );

    return missing.length === 0
      ? pass('API docs present', 'API docs are present for all modules with APIs')
      : fail(
          'API docs present',
          `Missing API docs for: ${missing.join(', ')}`,
          'Add the missing API documentation files.',
        );
  }

  private checkIntegrationDocs(projectRoot: string, modules: string[]): HealthCheckResult {
    if (!this.documentationHasRun(projectRoot) || modules.length === 0) {
      return pass(
        'Integration docs present',
        'Integration docs are checked after documentation generation',
      );
    }

    const missing = modules.filter(
      (moduleName) =>
        !existsSync(join(projectRoot, 'docs/modules', moduleName, 'integration/events.md')) ||
        !existsSync(join(projectRoot, 'docs/modules', moduleName, 'integration/contracts.md')),
    );

    return missing.length === 0
      ? pass('Integration docs present', 'Integration docs are present for all modules')
      : fail(
          'Integration docs present',
          `Missing integration docs for: ${missing.join(', ')}`,
          'Add the missing integration documentation files.',
        );
  }

  private checkErrorCatalog(projectRoot: string, modules: string[]): HealthCheckResult {
    if (!this.documentationHasRun(projectRoot) || modules.length === 0) {
      return pass(
        'Error catalog present',
        'Error catalogs are checked after documentation generation',
      );
    }

    const missing = modules.filter(
      (moduleName) =>
        !existsSync(join(projectRoot, 'docs/modules', moduleName, 'error-catalog.md')),
    );

    return missing.length === 0
      ? pass('Error catalog present', 'Error catalogs are present for all modules')
      : fail(
          'Error catalog present',
          `Missing error catalogs for: ${missing.join(', ')}`,
          'Add the missing module error catalogs.',
        );
  }

  private checkMcp(projectRoot: string, profile: ProjectProfile | null): HealthCheckResult {
    if (profile === null) {
      return info(
        MCP_CHECK_NAME,
        'Project profile is unavailable, so no MCP servers can be recommended for this stack.',
      );
    }

    const recommended = getServersForStack(getPrimaryStack(profile), getLegacyCapabilities(profile))
      .filter((server) => server.name !== 'figma')
      .map((server) => server.name);
    const found = readMcpServerNames(
      join(projectRoot, AdapterFactory.create('claude-code').getMcpPath()),
    );

    return info(
      MCP_CHECK_NAME,
      `Recommended for this stack: ${listOrNone(recommended)}.` +
        (found === null ? '' : ` Found in .mcp.json: ${listOrNone(found)}.`),
    );
  }

  private checkSkillCache(projectRoot: string): HealthCheckResult {
    const cacheDir = join(projectRoot, PATHS.SKILL_CACHE_DIR);
    if (!existsSync(cacheDir)) {
      return warn(
        'Skill cache healthy',
        'Skill cache directory is missing',
        'Run skill-cache-manager.sh --clear-all to reset cache',
      );
    }

    const corrupt = readdirSync(cacheDir)
      .filter((entry) => entry.endsWith('.json'))
      .filter((entry) => {
        try {
          JSON.parse(readFileSync(join(cacheDir, entry), 'utf8'));
          return false;
        } catch {
          return true;
        }
      });

    return corrupt.length === 0
      ? pass('Skill cache healthy', 'Skill cache directory is healthy')
      : warn(
          'Skill cache healthy',
          `Corrupt cache files detected: ${corrupt.join(', ')}`,
          'Run skill-cache-manager.sh --clear-all to reset cache',
        );
  }

  private checkContextHitRate(
    projectRoot: string,
    profile: ProjectProfile | null,
  ): HealthCheckResult {
    const path = join(projectRoot, PATHS.CONTEXT_HIT_LOG);
    if (!existsSync(path) || profile === null) {
      return pass('Context hit rate acceptable', 'No recent context logs yet');
    }

    try {
      const entry = JSON.parse(readFileSync(path, 'utf8')) as { hit_rate?: number };
      const hitRate = entry.hit_rate ?? 0;
      const target = profile.efficiency.context_hit_rate_target ?? 0.7;
      return hitRate >= target
        ? pass('Context hit rate acceptable', 'Context hit rate meets the configured target')
        : warn(
            'Context hit rate acceptable',
            'Context hit rate is below the configured target',
            'Reduce unnecessary context loading or improve context selection.',
          );
    } catch {
      return warn(
        'Context hit rate acceptable',
        'Context hit log is unreadable',
        'Regenerate the context hit log with the tracking hook.',
      );
    }
  }

  private async buildEfficiencySummary(projectRoot: string): Promise<HealthEfficiencySummary> {
    const path = join(projectRoot, PATHS.CONTEXT_HIT_LOG);
    let contextHitRate = 0;
    let skillCacheHitRate: number;

    if (existsSync(path)) {
      try {
        const entry = JSON.parse(readFileSync(path, 'utf8')) as { hit_rate?: number };
        contextHitRate = entry.hit_rate ?? 0;
      } catch {
        contextHitRate = 0;
      }
    }

    try {
      skillCacheHitRate = (
        await new SkillCacheManager(join(projectRoot, PATHS.SKILL_CACHE_DIR)).getStats()
      ).hit_rate;
    } catch {
      skillCacheHitRate = 0;
    }

    return {
      context_hit_rate: contextHitRate,
      skill_cache_hit_rate: skillCacheHitRate,
      mcp_usage_rate: 0,
    };
  }

  private checkLeanRuleFootprint(projectRoot: string): HealthCheckResult {
    const name = 'Lean rule footprint acceptable';
    const rulesRoot = join(projectRoot, PATHS.RULES_DIR);
    if (!existsSync(rulesRoot)) {
      return pass(name, 'No rules directory to load — nothing to slim');
    }

    const fullRulesBytes = walk(rulesRoot)
      .filter((file) => file.endsWith('.md'))
      .reduce((sum, file) => sum + statSync(file).size, 0);

    const artifactPath = join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT);
    if (!existsSync(artifactPath)) {
      return pass(
        name,
        'Lean rule artifact not generated yet — full rule load is the fallback until the next refresh',
      );
    }

    const residentBytes = statSync(artifactPath).size;
    const pct = fullRulesBytes > 0 ? Math.round((residentBytes / fullRulesBytes) * 100) : 0;
    const detail = `Resident rule context is ${residentBytes} bytes vs ${fullRulesBytes} bytes for the full rule set (${pct}% of full)`;

    return residentBytes < fullRulesBytes || fullRulesBytes === 0
      ? pass(name, detail)
      : warn(
          name,
          `${detail} — lean loading is not reducing the resident footprint`,
          'Ensure lean_rules is on and re-run `paqad-ai rag refresh-context` to recompose the lean artifact.',
        );
  }

  private async checkCompiledRulesCurrent(projectRoot: string): Promise<HealthCheckResult> {
    const name = 'Compiled rules are current';
    return (await isCompiledRulesStale(projectRoot))
      ? fail(
          name,
          'The compiled rule store is out of date with docs/instructions/rules/, so the session context can serve rules that have drifted from the authored rules.',
          'Run `paqad-ai rag refresh-context` to recompile the rule store from docs/instructions/rules/.',
        )
      : pass(name, 'Compiled rule store matches the authored rules');
  }

  private checkSpecPipeline(projectRoot: string): HealthCheckResult {
    const name = 'Spec pipeline is healthy';
    for (const fixture of PARITY_CORPUS) {
      if (!checkSpecShape(fixture.markdown).ok) {
        return fail(
          name,
          `Parser-parity fixture "${fixture.name}" no longer passes the S4 shape check.`,
          'A freeze-parser change broke S4 parity — update the shared corpus and the S4 check together.',
        );
      }
      const spec = buildFeatureSpec({
        spec_id: 'S-doctor',
        spec_file: 'spec.md',
        spec_markdown: fixture.markdown,
      });
      if (spec.acceptance_criteria.length === 0 || spec.behaviour.length === 0) {
        return fail(
          name,
          `Parser-parity fixture "${fixture.name}" is no longer ingested by the freeze parser.`,
          'The freeze parser and the S4 shape check have drifted — reconcile them (FR-10.2).',
        );
      }
    }
    const config = readPipelineConfig(projectRoot);
    if (config.final_review === 'strict' && !config.enabled) {
      return warn(
        name,
        'spec_pipeline_final_review is required but spec_pipeline_enabled is off — a required gate on a disabled pipeline never runs.',
        'Enable the pipeline (spec_pipeline_enabled=true) or relax spec_pipeline_final_review.',
      );
    }
    return pass(name, 'Parser-parity corpus holds and the enforcement config is coherent.');
  }

  private checkSpecPipelineSettings(projectRoot: string): HealthCheckResult {
    const config = readPipelineConfig(projectRoot);
    const from = specPipelineSources(projectRoot);
    const onOff = (on: boolean): string => (on ? 'on' : 'off');
    const values =
      `spec pipeline ${onOff(config.enabled)} (${from.spec_pipeline_enabled}), ` +
      `experts ${onOff(config.experts_enabled)} (${from.spec_pipeline_experts_enabled}), ` +
      `adoption ${config.adoption} (${from.spec_pipeline_adoption}).`;
    if (!config.enabled) {
      return pass(
        'Spec pipeline settings',
        `${values} The pipeline is off, so specs are written by hand and no experts run.`,
      );
    }
    const kTokens = (n: number): string => `${Math.round(n / 1000)}k`;
    const cost = expertsActive(config)
      ? ` The ${config.standing_experts.length} standing experts carry about ` +
        `${kTokens(standingBudgetSum(config))} tokens of budget per spec ` +
        `(ceiling ${kTokens(config.token_ceiling)}).`
      : '';
    return pass(
      'Spec pipeline settings',
      `${values} It runs on the graduated and full lanes; the fast lane never runs it.${cost} ` +
        'To switch off: spec_pipeline_enabled=false, spec_pipeline_experts_enabled=false or ' +
        'spec_pipeline_adoption=warn in .paqad/configs/.config.* or .paqad/.config.',
    );
  }

  private checkVisualEvidence(projectRoot: string): HealthCheckResult[] {
    const name = 'Visual evidence is ready';
    const config = resolveFrameworkConfig(projectRoot);
    if (!config.features.visual_evidence) {
      return [pass(name, 'Visual evidence is off (default); nothing to check.')];
    }

    const results: HealthCheckResult[] = visualEvidenceReadiness(projectRoot).map((problem) =>
      warn(name, problem.detail, problem.remediation),
    );

    if (results.length === 0) {
      results.push(pass(name, 'Visual evidence is on and every prerequisite is in place.'));
    }
    return results;
  }

  private checkExpertRoster(projectRoot: string): HealthCheckResult[] {
    const name = 'Expert roster config is coherent';
    const config = readPipelineConfig(projectRoot);
    const results: HealthCheckResult[] = [];
    const from = specPipelineSources(projectRoot);

    if (
      config.experts_enabled &&
      !config.enabled &&
      from.spec_pipeline_experts_enabled !== 'default'
    ) {
      results.push(
        warn(
          name,
          'spec_pipeline_experts_enabled is on but spec_pipeline_enabled is off — the expert roster never runs while the pipeline itself is off.',
          'Enable the pipeline (spec_pipeline_enabled=true), or turn the experts flag off.',
        ),
      );
    } else if (expertsActive(config) && config.clarification === 'off') {
      results.push(
        warn(
          name,
          'spec_pipeline_experts_enabled is on but spec_pipeline_clarification is off — experts can surface questions, but the question round is disabled so they are dropped.',
          'Set spec_pipeline_clarification to warn or strict, or turn the experts flag off.',
        ),
      );
    } else {
      results.push(
        pass(
          name,
          expertsActive(config)
            ? 'Expert roster is enabled and its config is coherent.'
            : 'Expert roster is off; nothing to enforce.',
        ),
      );
    }

    if (
      config.adoption === 'strict' &&
      !config.enabled &&
      from.spec_pipeline_adoption !== 'default'
    ) {
      results.push(
        warn(
          'Spec pipeline adoption is coherent',
          'adoption is strict but the pipeline is off; the setting does nothing',
          'Enable spec_pipeline_enabled=true, or set spec_pipeline_adoption=warn.',
        ),
      );
    }

    for (const role of config.standing_experts_dropped) {
      results.push(
        warn(
          'Standing experts are all expert roles',
          `spec_pipeline_standing_experts names "${role}", which is not an expert; it is ignored`,
          'Remove it from spec_pipeline_standing_experts, or name a role in the expert roster.',
        ),
      );
    }

    if (config.experts_enabled) {
      const lensDir = join(
        getRuntimeRoot(),
        'base',
        'skills',
        'expert-notes',
        'references',
        'lenses',
      );
      const missing = EXPERT_ROLES.filter((role) => !existsSync(join(lensDir, `${role}.md`)));
      if (missing.length > 0) {
        results.push(
          fail(
            'Expert lens files are shipped',
            `the expert roster is on but these roles ship no lens: ${missing.join(', ')}`,
            'Add the missing lens file(s) under runtime/base/skills/expert-notes/references/lenses/.',
          ),
        );
      }
      const standingSum = standingBudgetSum(config);
      if (config.token_ceiling < standingSum + 6000) {
        results.push(
          warn(
            'Spec pipeline token ceiling fits the experts',
            `expert slices will be clamped on most runs (the standing experts need ${standingSum} and one on-call expert about 6000); raise spec_pipeline_token_ceiling to at least ${standingSum + 6000} or accept clamped briefs`,
            `Raise spec_pipeline_token_ceiling to at least ${standingSum + 6000}.`,
          ),
        );
      }
    }

    return results;
  }

  private checkClassificationOverrideRate(projectRoot: string): HealthCheckResult {
    const path = join(projectRoot, PATHS.AGENCY_CACHE_DIR, 'classification-history.json');
    if (!existsSync(path)) {
      return pass(
        'Classification override rate acceptable',
        'No classification history recorded yet',
      );
    }

    try {
      const entries = JSON.parse(readFileSync(path, 'utf8')) as Array<{
        high_override_rate?: boolean;
      }>;
      const sample = entries.slice(-50);
      const ratio =
        sample.length === 0
          ? 0
          : sample.filter((entry) => entry.high_override_rate).length / sample.length;
      return ratio > 0.3
        ? warn(
            'Classification override rate acceptable',
            `High override rate detected across recent classifications (${Math.round(ratio * 100)}%)`,
            'Review pre-classification signals and reduce deterministic/LLM disagreement.',
          )
        : pass(
            'Classification override rate acceptable',
            'Classification override rate is within acceptable bounds',
          );
    } catch {
      return warn(
        'Classification override rate acceptable',
        'Classification history is unreadable',
        'Regenerate classification history by re-running recent classification flows.',
      );
    }
  }

  private documentationHasRun(projectRoot: string): boolean {
    return existsSync(join(projectRoot, PATHS.DOC_PROGRESS));
  }

  private async checkRag(
    projectRoot: string,
    profile: ProjectProfile | null,
  ): Promise<HealthCheckResult[]> {
    if (profile === null) {
      return [];
    }

    const intelligence = profile.intelligence;
    const results: HealthCheckResult[] = [];
    if (!intelligence.rag_enabled) {
      results.push(pass('RAG index present', 'RAG is disabled'));
      results.push(pass('RAG provider matches profile', 'RAG is disabled'));
      results.push(pass('RAG chunk index present', 'RAG is disabled'));
      results.push(pass('RAG chunk index current', 'RAG is disabled'));
      results.push(pass('RAG vector payload consistent', 'RAG is disabled'));
      results.push(pass('RAG retrieval ready', 'RAG is disabled'));
      results.push(pass('RAG model cache present', 'RAG is disabled'));
      results.push(pass('RAG vector gitignore present', 'RAG is disabled'));
      results.push(pass('RAG secrets gitignore present', 'RAG is disabled'));
      results.push(pass('RAG secret permissions acceptable', 'RAG is disabled'));
      return results;
    }

    const service = new RagService(projectRoot);
    const status = await service.getStatus();

    results.push(
      status.index_present
        ? pass('RAG index present', 'Vector index files are present')
        : warn('RAG index present', 'Vector index files are missing', 'Run `paqad-ai rag init`.'),
    );

    results.push(
      status.valid
        ? pass('RAG provider matches profile', 'Stored RAG provider and model match the profile')
        : warn(
            'RAG provider matches profile',
            status.reason ?? 'Stored RAG metadata does not match the profile',
            'Run `paqad-ai rag rebuild` after changing provider or model.',
          ),
    );

    const chunkIndexManager = new ChunkIndexManager(projectRoot);
    const chunkIndex = await chunkIndexManager.load();
    results.push(
      chunkIndex
        ? pass('RAG chunk index present', 'Chunk index is present')
        : warn(
            'RAG chunk index present',
            'Chunk index is missing',
            'Run `paqad-ai rag rebuild` to regenerate the chunk index and vectors.',
          ),
    );

    if (!chunkIndex) {
      results.push(
        warn(
          'RAG chunk index current',
          'Chunk index freshness could not be verified because the chunk index is missing',
          'Run `paqad-ai rag rebuild` to regenerate the chunk index.',
        ),
      );
    } else {
      const stale = await chunkIndexManager.isStale(chunkIndex);
      results.push(
        stale.stale
          ? warn(
              'RAG chunk index current',
              `Chunk index is stale for ${stale.changedFiles.length} file(s)`,
              'Run `paqad-ai rag rebuild` to resync the chunk index and vectors.',
            )
          : pass('RAG chunk index current', 'Chunk index matches indexed source files'),
      );
    }

    const vectorConsistency = await this.checkRagVectorPayloadConsistency(projectRoot);
    results.push(vectorConsistency.payload);
    results.push(vectorConsistency.retrievalReady);

    results.push(
      intelligence.embedding_provider === 'local'
        ? service.localModelCached(
            intelligence.embedding_model ?? getDefaultEmbeddingModel('local'),
          )
          ? pass('RAG model cache present', 'Local embedding model cache is present')
          : warn(
              'RAG model cache present',
              'Local embedding model cache is missing',
              'Run `paqad-ai rag rebuild` to download and cache the local model.',
            )
        : pass('RAG model cache present', 'Local model cache is not required for this provider'),
    );

    results.push(
      this.isPathIgnored(projectRoot, PATHS.VECTORS_DIR, true)
        ? pass('RAG vector gitignore present', 'Vector index path is gitignored')
        : warn(
            'RAG vector gitignore present',
            `Vector index path is not gitignored: ${PATHS.VECTORS_DIR}`,
            'Re-run `paqad-ai onboard` to refresh the managed `.paqad/.gitignore`.',
          ),
    );
    results.push(
      this.isPathIgnored(projectRoot, PATHS.SECRETS_ENV)
        ? pass('RAG secrets gitignore present', 'Secrets file path is gitignored')
        : warn(
            'RAG secrets gitignore present',
            `Secrets file path is not gitignored: ${PATHS.SECRETS_ENV}`,
            'Re-run `paqad-ai onboard` to refresh the managed `.paqad/.gitignore`.',
          ),
    );

    const permissionWarning = getSecretPermissionWarning(projectRoot);
    results.push(
      permissionWarning === null
        ? pass('RAG secret permissions acceptable', 'Secrets file permissions are acceptable')
        : warn(
            'RAG secret permissions acceptable',
            permissionWarning,
            'Restrict `.paqad/secrets.env` to owner-only access.',
          ),
    );

    const engine = describeOptionalEngine();
    if (engine.state === 'ready') {
      results.push(pass('RAG engine installed', 'The embedding engine is installed'));
    } else if (engine.state === 'installing') {
      results.push(
        warn(
          'RAG engine installed',
          'not ready: installing in the background; retrieval uses text search until it is ready',
          'Re-run `paqad-ai doctor` shortly to confirm it finished.',
        ),
      );
    } else if (engine.state === 'install failed') {
      results.push(
        warn(
          'RAG engine installed',
          `The embedding engine install failed: ${engine.detail ?? 'unknown error'}`,
          engine.hint ?? ENGINE_INSTALL_NETWORK_HINT,
        ),
      );
    } else {
      results.push(
        warn(
          'RAG engine installed',
          'The embedding engine is not installed; retrieval uses text search',
          'It installs automatically on first use inside Claude Code; otherwise run `paqad-ai rag rebuild`.',
        ),
      );
    }

    return results;
  }

  private async checkRagVectorPayloadConsistency(projectRoot: string): Promise<{
    payload: HealthCheckResult;
    retrievalReady: HealthCheckResult;
  }> {
    const vectorIndex = new FileVectorIndex();
    const payload = await vectorIndex.load(projectRoot);
    const meta = await vectorIndex.loadMeta(projectRoot);

    if (!payload || !meta) {
      return {
        payload: warn(
          'RAG vector payload consistent',
          'Vector payload or metadata is missing',
          'Run `paqad-ai rag rebuild` to regenerate the vector index.',
        ),
        retrievalReady: warn(
          'RAG retrieval ready',
          'Retrieval is not ready because the vector index is incomplete',
          'Run `paqad-ai rag rebuild` to regenerate the vector index.',
        ),
      };
    }

    const vectorLengths = new Set(payload.items.map((item) => item.vector.length));
    const dimensionsMatch = vectorLengths.size <= 1 && vectorLengths.has(payload.dimensions);
    const chunkCountMatches = payload.items.length === meta.chunk_count;

    const payloadCheck =
      payload.items.length === 0
        ? warn(
            'RAG vector payload consistent',
            'Vector index is empty',
            'Run `paqad-ai rag rebuild` after confirming eligible source files are present.',
          )
        : dimensionsMatch && chunkCountMatches
          ? pass(
              'RAG vector payload consistent',
              'Vector payload dimensions and chunk counts are internally consistent',
            )
          : warn(
              'RAG vector payload consistent',
              'Vector payload dimensions or chunk counts do not match metadata',
              'Run `paqad-ai rag rebuild` to regenerate the vector index.',
            );

    const retrievalReady =
      payload.items.length > 0 &&
      dimensionsMatch &&
      chunkCountMatches &&
      meta.embedding_dimensions > 0
        ? pass('RAG retrieval ready', 'Vector index is populated and structurally queryable')
        : warn(
            'RAG retrieval ready',
            'Vector index is present but not structurally ready for reliable retrieval',
            'Run `paqad-ai rag rebuild` to regenerate the vector index.',
          );

    return { payload: payloadCheck, retrievalReady };
  }

  private checkJsonArtifact(input: {
    projectRoot: string;
    relativePath: string;
    name: string;
    schemaId: string;
    missingRemediation: string;
    invalidRemediation: string;
  }): HealthCheckResult {
    const path = join(input.projectRoot, input.relativePath);
    if (!existsSync(path)) {
      return fail(input.name, `${input.relativePath} is missing`, input.missingRemediation);
    }

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      const validation = this.validator.validate(input.schemaId, parsed);
      return validation.valid
        ? pass(input.name, `${input.relativePath} is present and valid`)
        : fail(
            input.name,
            validation.errors.map((error) => error.message).join('; '),
            input.invalidRemediation,
          );
    } catch {
      return fail(input.name, `${input.relativePath} is unreadable`, input.invalidRemediation);
    }
  }
}

type SpecPipelineSwitchKey =
  'spec_pipeline_enabled' | 'spec_pipeline_experts_enabled' | 'spec_pipeline_adoption';

function specPipelineSources(projectRoot: string): Record<SpecPipelineSwitchKey, string> {
  const knobs = resolveEffectiveConfig(projectRoot);
  const sourceOf = (key: string): string => {
    const surface = knobs.find((knob) => knob.key === key)!.surface;
    if (surface.startsWith('env:')) return surface.slice('env:'.length);
    if (surface.startsWith('local ')) return surface.slice('local '.length);
    if (surface.startsWith('team ')) return `.paqad/${surface.slice('team '.length)}`;
    return surface;
  };
  return {
    spec_pipeline_enabled: sourceOf('spec_pipeline_enabled'),
    spec_pipeline_experts_enabled: sourceOf('spec_pipeline_experts_enabled'),
    spec_pipeline_adoption: sourceOf('spec_pipeline_adoption'),
  };
}

const MCP_CHECK_NAME = 'MCP servers (recommended)';

function readMcpServerNames(path: string): string[] | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const servers = isPlainObject(parsed) ? parsed.mcpServers : undefined;
    return isPlainObject(servers) ? Object.keys(servers) : [];
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listOrNone(names: string[]): string {
  return names.length === 0 ? 'none' : names.join(', ');
}

function pass(name: string, detail: string): HealthCheckResult {
  return { name, status: 'pass', detail };
}

function fail(name: string, detail: string, remediation: string): HealthCheckResult {
  return { name, status: 'fail', detail, remediation };
}

function info(name: string, detail: string): HealthCheckResult {
  return { name, status: 'info', detail };
}

function warn(name: string, detail: string, remediation: string): HealthCheckResult {
  return { name, status: 'warning', detail, remediation };
}

export function deriveOverallStatus(checks: HealthCheckResult[]): HealthCheckStatus {
  if (checks.some((check) => check.status === 'fail')) {
    return 'fail';
  }

  if (checks.some((check) => check.status === 'warning')) {
    return 'warning';
  }

  return 'pass';
}

function isStale(timestampMs: number): boolean {
  return Date.now() - timestampMs > STALENESS_WINDOW_MS;
}

function walk(root: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(path));
      continue;
    }

    results.push(path);
  }

  return results;
}

function relativeTo(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, '/');
}
