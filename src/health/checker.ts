import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { AdapterFactory } from '@/adapters/factory.js';
import { ChunkIndexManager } from '@/context/chunk-index.js';
import { PATHS, REGISTRIES } from '@/core/constants/paths.js';
import { getProfileDomain, readProjectProfile } from '@/core/project-profile.js';
import { isFrameworkDisabledForRoot } from '@/core/framework-enabled.js';
import { getSecretPermissionWarning } from '@/rag/secrets.js';
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

export class HealthChecker {
  private readonly validator = new SchemaValidator();

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
      this.checkProviderEntryBootstrapPointer(projectRoot),
      this.checkProviderEntryFallbackClause(projectRoot),
      this.checkStackCommands(profile),
      ...(await this.checkStructuredTestOutput(projectRoot, profile)),
      this.checkStableFrameworkPaths(projectRoot),
      this.checkBrokenScaffold(projectRoot),
      this.checkUiDocs(projectRoot, modules),
      this.checkApiDocs(projectRoot, modules),
      this.checkIntegrationDocs(projectRoot, modules),
      this.checkErrorCatalog(projectRoot, modules),
      this.checkMcp(projectRoot, profile),
      this.checkSkillCache(projectRoot),
      this.checkContextHitRate(projectRoot, profile),
      this.checkClassificationOverrideRate(projectRoot),
      ...(await this.checkRag(projectRoot, profile)),
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
    // `framework-version.txt` is intentionally NOT required: it is per-machine,
    // git-ignored, local-only state (the silent-update hook recreates it on
    // first session). A teammate who clones an onboarded repo without re-running
    // onboarding has the committed boot pointer + profile but not the local
    // version file, and that is a healthy state, not a missing artifact.
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

  /**
   * Whether `relPath` (relative to the project root, e.g. `.paqad/vectors/`) is
   * git-ignored. Asks git, which honours the project root `.gitignore`, paqad's
   * nested `.paqad/.gitignore`, and any global excludes alike. Falls back to a
   * textual scan of both ignore files when git is unavailable or the project is
   * not a git repository (e.g. a freshly scaffolded test fixture), so the check
   * is meaningful before `git init`.
   */
  private isPathIgnored(projectRoot: string, relPath: string): boolean {
    const target = relPath.replace(/\/$/, '');
    try {
      execFileSync('git', ['check-ignore', '-q', '--', target], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      return true; // exit 0 — git resolved the path as ignored.
    } catch (error) {
      // exit 1 — git ran and the path is NOT ignored. Any other status (128 for
      // "not a git repo", or git missing) drops to the textual fallback below.
      if ((error as { status?: number }).status === 1) {
        return false;
      }
    }

    // Fallback: the root `.gitignore` carries the full path; the nested
    // `.paqad/.gitignore` carries it relative to `.paqad/`.
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
      missingRemediation: 'Re-run onboarding to regenerate the detection report.',
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
        'Run onboarding or refresh to regenerate the stack snapshot.',
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
        'Run onboarding or refresh to regenerate the stack drift report.',
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
    // DECISIONS_AUDIT_LOG is intentionally NOT required: it is git-ignored,
    // write-only telemetry with no production reader, so a clean clone (which
    // never carries it) is healthy without it. Requiring it produced a spurious
    // "Missing decision artifacts" warning on every fresh checkout.
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
      // Profiles are created on demand as modules accrue evidence; an absent
      // directory on a fresh/quiet project is expected, not a problem.
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

  private checkStableFrameworkPaths(projectRoot: string): HealthCheckResult {
    // Issue #220 — a deliberate disable is a healthy state, not a fault. The
    // profile flag (`paqad.enabled: false`) or `PAQAD_DISABLED` is the
    // disambiguator: when set, report "disabled (vanilla mode)" as a pass so
    // doctor never reads it as broken. When absent, the checks below treat a
    // missing/ephemeral install as the fault it is — that is how a deliberate
    // disable is distinguished from an accidental uninstall.
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
      return warn(
        'MCP servers configured',
        'Project profile is unavailable, MCP expectations could not be derived',
        'Restore the project profile, then configure stack-appropriate MCP servers.',
      );
    }

    const candidates = ADAPTER_TYPES.map((type) => AdapterFactory.create(type))
      .filter((adapter) => adapter.capabilities.mcp)
      .map((adapter) => adapter.getMcpPath());
    const existing = candidates.filter((candidate) => existsSync(join(projectRoot, candidate)));
    const expectedServers = getServersForStack(
      getPrimaryStack(profile),
      getLegacyCapabilities(profile),
    )
      .filter((server) => server.name !== 'figma')
      .map((server) => server.name);

    if (existing.length === 0) {
      return warn(
        'MCP servers configured',
        'No MCP configuration files were found',
        'Configure MCP servers in project profile for improved efficiency',
      );
    }

    const configured = new Set<string>();
    for (const path of existing) {
      try {
        const parsed = JSON.parse(readFileSync(join(projectRoot, path), 'utf8')) as {
          mcpServers?: Record<string, unknown>;
        };
        Object.keys(parsed.mcpServers ?? {}).forEach((server) => configured.add(server));
      } catch {
        continue;
      }
    }
    const missingExpected = expectedServers.filter((server) => !configured.has(server));

    return missingExpected.length === 0
      ? pass('MCP servers configured', 'Stack-appropriate MCP servers are configured')
      : warn(
          'MCP servers configured',
          `Missing recommended MCP servers: ${missingExpected.join(', ')}`,
          'Configure MCP servers in project profile for improved efficiency',
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
        ? service.localModelCached(intelligence.embedding_model)
          ? pass('RAG model cache present', 'Local embedding model cache is present')
          : warn(
              'RAG model cache present',
              'Local embedding model cache is missing',
              'Run `paqad-ai rag rebuild` to download and cache the local model.',
            )
        : pass('RAG model cache present', 'Local model cache is not required for this provider'),
    );

    results.push(
      this.isPathIgnored(projectRoot, PATHS.VECTORS_DIR)
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

function pass(name: string, detail: string): HealthCheckResult {
  return { name, status: 'pass', detail };
}

function fail(name: string, detail: string, remediation: string): HealthCheckResult {
  return { name, status: 'fail', detail, remediation };
}

function warn(name: string, detail: string, remediation: string): HealthCheckResult {
  return { name, status: 'warning', detail, remediation };
}

function deriveOverallStatus(checks: HealthCheckResult[]): HealthCheckStatus {
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
