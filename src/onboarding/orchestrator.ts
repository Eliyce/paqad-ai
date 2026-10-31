import { accessSync, constants as fsConstants, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AdapterFactory, type GeneratedFile } from '@/adapters/index.js';
import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { PATHS } from '@/core/constants/paths.js';
import { FrameworkError, ValidationError } from '@/core/errors/index.js';
import {
  DEFAULT_FRAMEWORK_CONFIG,
  detectFlippedFrameworkValues,
  readConfigsDir,
  reconcileConfigOverrides,
  setGroupConfigValue,
  syncGroupConfigs,
  writeConfigExample,
  writeConfigsReadme,
  writeFrameworkOverridesToConfig,
} from '@/core/framework-config.js';
import { appendPlanningAudit } from '@/planning/audit.js';
import { isFrameworkEnabled } from '@/core/framework-enabled.js';
import { toPosixPath } from '@/core/path-utils.js';
import { defaultIntelligenceConfig } from '@/core/project-intelligence.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { nodePackageManager } from '@/checks/prerequisites.js';
import type { AdapterType } from '@/core/types/adapter.js';
import type { ActiveCapability, Capability, Stack } from '@/core/types/domain.js';
import { getPrimaryStack } from '@/core/stack-profile.js';
import type { OnboardingOutput, OnboardingPreviewResult } from '@/core/types/onboarding.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { cleanupLegacyMcpFiles } from '@/mcp/cleanup.js';
import { McpConfigManager } from '@/mcp/config-manager.js';
import { checkAndMigrateSchema } from '@/core/schema-version.js';
import { Detector } from '@/detection/detector.js';
import { VERSION } from '@/index.js';
import { StackSnapshotCache } from '@/introspection/cache.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import { selectTestRunner } from '@/checks/test-runner.js';
import { deriveTestingForProfile } from '@/checks/testing-record.js';
import { Resolver } from '@/resolver/resolver.js';
import { writeStackArtifacts } from '@/stack-docs/generator.js';
import { SchemaValidator } from '@/validators/validator.js';
import { compileRuleScripts, isRuleScriptMapStale } from '@/rule-scripts/compile.js';
import {
  compileRules,
  DecisionStore,
  isCompiledRulesStale,
  writeCompiledRules,
} from '@/planning/index.js';

import { writeRuleContext } from '@/context/rule-context.js';
import { buildCodeKnowledgeIndex } from '@/code-knowledge/builder.js';
import { validateCodeKnowledgeIndex } from '@/code-knowledge/schema.js';
import { writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { bootstrapFramework } from '@/install/bootstrap.js';

import {
  deleteOnboardingCheckpoint,
  readOnboardingCheckpoint,
  writeOnboardingCheckpoint,
} from './checkpoint.js';
import { type EntryStub, wireEntryStubs } from './entry-stub-writer.js';
import { planGeneratedFiles, writeGeneratedFiles } from './file-writer.js';
import { removeObsoleteContractDocs } from './obsolete-cleanup.js';
import { writeGitignore } from './gitignore-writer.js';
import { writeWorktreeInclude } from './worktree-include-writer.js';
import { installGitHooks } from '@/feature-evidence/git-hooks.js';
import { runPendingEvidenceMigration } from '@/feature-evidence/migrate.js';
import {
  readExistingOnboardingManifest,
  writeDetectionReport,
  writeFrameworkMetadata,
  writeOnboardingManifest,
  writeProjectProfile,
} from './manifest-writer.js';
import { migrateLegacyDecisionIds } from './decision-id-migration.js';
import { generateDeliveryPolicy } from './delivery-policy-generator.js';
import { generateFeatureDevelopmentPolicy } from './feature-policy-generator.js';
import { resolveSelections } from './prompts.js';
import {
  applyRagSelection,
  enableRagDuringOnboarding,
  RAG_ENGINE_INSTALLING_LINE,
  ragEngineInstallingInBackground,
  resolveRagSelection,
  type RagSelection,
} from './rag-onboarding.js';
import { discoverModules } from './registry-generator.js';
import { generateReferenceGuides } from './reference-generator.js';
import { generateProjectRules } from './rule-generator.js';

export interface OnboardingOptions {
  projectRoot: string;
  runtimeRoot?: string;
  adapters?: AdapterType[];
  profileOverrides?: Partial<ProjectProfile>;
  selections?: {
    providers?: AdapterType[];
    domain?: 'coding' | 'content';
    stack_profile?: ProjectProfile['stack_profile'];
    stack?: Stack;
    capabilities?: Capability[];
    rag?: RagSelection;
  };
  onPhase1Complete?: (result: OnboardingOutput) => void;
  forceOverwrite?: boolean;
  workspacePolicy?: {
    project_creation_disabled?: boolean;
  };
}

export class OnboardingOrchestrator {
  async run(options: OnboardingOptions): Promise<OnboardingOutput> {
    if (options.workspacePolicy?.project_creation_disabled === true) {
      throw new FrameworkError(
        'Project creation is disabled by workspace policy; onboarding will not run.',
        { code: 'PROJECT_CREATION_DISABLED' },
      );
    }

    const firstOnboarding = readExistingOnboardingManifest(options.projectRoot) === null;

    await checkAndMigrateSchema(options.projectRoot, VERSION);
    runPendingEvidenceMigration(options.projectRoot);

    const detector = new Detector();
    const detection = await detector.detect(options.projectRoot);
    const introspector = new StackIntrospector();
    const previousSnapshot = await new StackSnapshotCache().read(options.projectRoot);
    const liveSnapshot = await introspector.snapshot(options.projectRoot);
    const selections = await resolveSelections(detection, liveSnapshot, options.selections);
    const runtimeRoot = options.runtimeRoot ?? getRuntimeRoot();
    const resolver = new Resolver({ runtimeRoot });
    const resolved = await resolver.resolve(selections);
    const adapters = options.adapters ?? selections.providers ?? ['claude-code'];
    const existingProfile = readProjectProfile(options.projectRoot);
    const profile = buildProjectProfile(
      selections,
      liveSnapshot,
      mergeProfileOverrides(existingProfile, options.profileOverrides),
      options.projectRoot,
    );
    profile.intelligence = applyRagSelection(profile.intelligence, undefined);
    const validator = new SchemaValidator();
    const validation = validator.validate('project-profile', profile);
    const modules = await discoverModules(options.projectRoot);

    if (!validation.valid) {
      throw new Error(validation.errors.map((error) => error.message).join('; '));
    }

    const generatedFiles: GeneratedFile[] = [];
    const entryFilePaths = new Set<string>();
    const entryStubs: EntryStub[] = [];
    let recommendMcp = false;

    for (const adapterType of adapters) {
      const adapter = AdapterFactory.create(adapterType);
      const configPath = adapter.getConfigPath();
      entryFilePaths.add(configPath);
      const configFiles = await adapter.generateConfig({
        frameworkPath: PATHS.FRAMEWORK_PATH,
        rulesPath: PATHS.RULES_DIR,
        projectRoot: options.projectRoot,
      });
      const entryFile = configFiles.find((file) => file.path === configPath);
      if (entryFile) {
        entryStubs.push({ path: configPath, content: entryFile.content });
      }
      generatedFiles.push(...configFiles);

      if (adapter.capabilities.hooks) {
        generatedFiles.push(...(await adapter.installHooks(resolved.hooks)));
      }

      recommendMcp ||= adapter.capabilities.mcp;

      if (adapter.capabilities.caching) {
        generatedFiles.push(...(await adapter.configureCaching(profile)));
      }

      if (adapter.capabilities.memory) {
        generatedFiles.push(...(await adapter.configureMemory(profile)));
      }
    }

    if (recommendMcp) {
      generatedFiles.push({ ...new McpConfigManager().generate(profile), autoUpdate: true });
    }
    generatedFiles.push(...(await generateProjectRules(resolved.rules)));
    generatedFiles.push(...generateFeatureDevelopmentPolicy(selections.domain));
    generatedFiles.push(...generateDeliveryPolicy(selections.domain));
    generatedFiles.push(
      ...(await generateReferenceGuides(runtimeRoot, {
        domain: selections.domain,
        stack_profile: selections.stack_profile,
      })),
    );

    const completed = new Set(readOnboardingCheckpoint(options.projectRoot) ?? []);
    const filesToWrite = generatedFiles
      .map((file) =>
        !options.forceOverwrite && entryFilePaths.has(file.path)
          ? { ...file, autoUpdate: false }
          : file,
      )
      .filter((file) => !completed.has(toPosixPath(file.path)));

    const onboardingWarnings: string[] = [];
    const unmapped = unmappedCommands(profile.commands);
    if (unmapped.length > 0) {
      onboardingWarnings.push(
        `Commands left unmapped in .paqad/project-profile.yaml (no matching script found): ${unmapped.join(', ')}. Add them there if the project has them.`,
      );
    }
    let revertedFrameworkValues: string[];
    let writeResult: ReturnType<typeof writeGeneratedFiles>;
    let drift: Awaited<ReturnType<typeof writeStackArtifacts>>;
    try {
      writeResult = writeGeneratedFiles(options.projectRoot, filesToWrite, {
        forceOverwrite: options.forceOverwrite,
      });
      if (!options.forceOverwrite && isFrameworkEnabled(profile)) {
        writeResult.written.push(...wireEntryStubs(options.projectRoot, entryStubs).wired);
      }
      writeOnboardingCheckpoint(options.projectRoot, [...completed, ...writeResult.written]);
      drift = await writeStackArtifacts(
        options.projectRoot,
        { ...liveSnapshot, profile: profile.stack_profile ?? liveSnapshot.profile },
        previousSnapshot,
        { writeHumanDocs: false },
      );
      revertedFrameworkValues = detectFlippedFrameworkValues(options.projectRoot);
      writeProjectProfile(options.projectRoot, profile);
      syncGroupConfigs(options.projectRoot);
      writeConfigsReadme(options.projectRoot);
      writeConfigExample(options.projectRoot);
      if (options.profileOverrides) {
        writeFrameworkOverridesToConfig(options.projectRoot, options.profileOverrides);
      }
      for (const file of reconcileConfigOverrides(options.projectRoot)) {
        onboardingWarnings.push(
          `Pruned obsolete config key(s) from ${file.path}: ${file.removed.join(', ')}.`,
        );
      }
      for (const collision of readConfigsDir(options.projectRoot).collisions) {
        onboardingWarnings.push(
          `Config key "${collision.key}" is set in multiple .paqad/configs/ files; the last filename wins — keep it in one file.`,
        );
      }
      if (adapters.includes('claude-code')) {
        onboardingWarnings.push(
          ...new ClaudeCodeAdapter().syncTeamSetup(options.projectRoot).notes,
        );
      }
      writeGitignore(options.projectRoot);
      writeWorktreeInclude(options.projectRoot);
      installGitHooks(options.projectRoot);
      writeDetectionReport(options.projectRoot, detection);
      writeFrameworkMetadata(options.projectRoot, VERSION);
    } catch (error) {
      throw translateDiskFullError(error);
    }
    cleanupLegacyMcpFiles(options.projectRoot);
    bootstrapFramework(options.projectRoot);
    try {
      const codeIndex = await buildCodeKnowledgeIndex(options.projectRoot);
      if (validateCodeKnowledgeIndex(codeIndex).valid) {
        writeCodeKnowledgeIndex(options.projectRoot, codeIndex);
      }
    } catch {}
    new DecisionStore(options.projectRoot).initialize();
    for (const migration of migrateLegacyDecisionIds(options.projectRoot)) {
      onboardingWarnings.push(
        `Migrated legacy decision id ${migration.from} → ${migration.to} in ${migration.dir}.`,
      );
    }
    removeObsoleteContractDocs(options.projectRoot);
    try {
      if (isRuleScriptMapStale(options.projectRoot)) {
        compileRuleScripts(options.projectRoot);
      }
    } catch (error) {
      onboardingWarnings.push(
        `Rule-script map compilation failed during onboarding: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    let compiledRulesPath = join(options.projectRoot, PATHS.COMPILED_RULES);
    try {
      if (await isCompiledRulesStale(options.projectRoot)) {
        const compiledRules = await compileRules(options.projectRoot);
        compiledRulesPath = await writeCompiledRules(options.projectRoot, compiledRules);
      }
    } catch (error) {
      onboardingWarnings.push(
        `Planning rule compilation failed during onboarding: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    try {
      await writeRuleContext(options.projectRoot);
    } catch (error) {
      onboardingWarnings.push(
        `Rule context generation failed during onboarding: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    const manifestPath = writeOnboardingManifest(options.projectRoot, {
      adapter: adapters[0],
      project_root: toPosixPath(options.projectRoot),
      profile,
      detected: detection,
      repository: detection.repository,
      generated_at: new Date().toISOString(),
      generated_artifacts: generatedFiles.map((file) => ({
        path: toPosixPath(file.path),
        auto_update: file.autoUpdate,
        executable: file.executable,
      })),
      planning_artifacts: {
        compiled_rules_path: toPosixPath(compiledRulesPath),
        module_health_initialized: [],
      },
    });

    deleteOnboardingCheckpoint(options.projectRoot);

    if (firstOnboarding) {
      appendPlanningAudit(options.projectRoot, 'INFO', 'project.onboarded', {
        project_id: profile.project.id,
        wizard_version: VERSION,
        steps_completed: writeResult.written.length,
      });
    }

    const phase1Output: OnboardingOutput = {
      adapter: adapters[0],
      decision_pause_supported_adapters: adapters,
      generated_files: writeResult.written.map(toPosixPath),
      detected_modules: modules,
      runtime_root: toPosixPath(runtimeRoot),
      manifest_path: toPosixPath(manifestPath),
      warnings: [...onboardingWarnings],
      kept_files: writeResult.skipped,
      drift_review_targets: drift.review_targets,
      reverted_framework_values: revertedFrameworkValues,
    };

    options.onPhase1Complete?.(phase1Output);

    const ragSelection = await resolveRagSelection(selections.domain, options.selections?.rag);
    if (ragSelection) {
      profile.intelligence = applyRagSelection(profile.intelligence, ragSelection);
      writeProjectProfile(options.projectRoot, profile);
      persistRagConfig(options.projectRoot, profile.intelligence);
    }

    if (ragSelection?.enabled && ragSelection.provider) {
      if (ragEngineInstallingInBackground(options.projectRoot, ragSelection)) {
        onboardingWarnings.push(RAG_ENGINE_INSTALLING_LINE);
      } else {
        try {
          await enableRagDuringOnboarding(options.projectRoot, ragSelection);
        } catch (error) {
          profile.intelligence = applyRagSelection(profile.intelligence, { enabled: false });
          writeProjectProfile(options.projectRoot, profile);
          setGroupConfigValue(options.projectRoot, 'rag', 'rag_enabled', 'false');
          onboardingWarnings.push(
            `RAG was turned off: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      }
    }

    return {
      ...phase1Output,
      warnings: [...onboardingWarnings],
    };
  }

  async preview(options: OnboardingOptions): Promise<OnboardingPreviewResult> {
    this.assertReadableDirectory(options.projectRoot);

    const { files, warnings } = await this.collectGeneratedFiles(options);
    const entries = planGeneratedFiles(options.projectRoot, files);

    return { entries, warnings };
  }

  private assertReadableDirectory(projectRoot: string): void {
    let isDirectory: boolean;
    try {
      accessSync(projectRoot, fsConstants.R_OK);
      isDirectory = statSync(projectRoot).isDirectory();
    } catch (error) {
      throw new ValidationError(`Onboarding preview cannot read project path: ${projectRoot}`, {
        projectRoot,
        reason: error instanceof Error ? error.message : 'unreadable path',
      });
    }

    if (!isDirectory) {
      throw new ValidationError(
        `Onboarding preview requires a directory, but path is not one: ${projectRoot}`,
        { projectRoot },
      );
    }
  }

  private async collectGeneratedFiles(
    options: OnboardingOptions,
  ): Promise<{ files: GeneratedFile[]; warnings: string[] }> {
    const warnings: string[] = [];

    const detector = new Detector();
    const detection = await detector.detect(options.projectRoot, { persist: false });
    const introspector = new StackIntrospector();
    const liveSnapshot = await introspector.snapshot(options.projectRoot, { persist: false });
    const selections = await resolveSelections(detection, liveSnapshot, options.selections);
    const runtimeRoot = options.runtimeRoot ?? getRuntimeRoot();
    const resolver = new Resolver({ runtimeRoot });
    const resolved = await resolver.resolve(selections);
    const adapters = options.adapters ?? selections.providers ?? ['claude-code'];
    const profile = buildProjectProfile(
      selections,
      liveSnapshot,
      options.profileOverrides,
      options.projectRoot,
    );
    profile.intelligence = applyRagSelection(profile.intelligence, undefined);
    const validator = new SchemaValidator();
    const validation = validator.validate('project-profile', profile);
    if (!validation.valid) {
      throw new ValidationError(validation.errors.map((error) => error.message).join('; '), {
        projectRoot: options.projectRoot,
      });
    }

    const files: GeneratedFile[] = [];
    let recommendMcp = false;

    for (const adapterType of adapters) {
      const adapter = AdapterFactory.create(adapterType);
      files.push(
        ...(await adapter.generateConfig({
          frameworkPath: PATHS.FRAMEWORK_PATH,
          rulesPath: PATHS.RULES_DIR,
          projectRoot: options.projectRoot,
        })),
      );

      if (adapter.capabilities.hooks) {
        files.push(...(await adapter.installHooks(resolved.hooks)));
      }

      recommendMcp ||= adapter.capabilities.mcp;

      if (adapter.capabilities.caching) {
        files.push(...(await adapter.configureCaching(profile)));
      }

      if (adapter.capabilities.memory) {
        files.push(...(await adapter.configureMemory(profile)));
      }
    }

    if (recommendMcp) {
      files.push({ ...new McpConfigManager().generate(profile), autoUpdate: true });
    }
    files.push(...(await generateProjectRules(resolved.rules)));
    files.push(...generateFeatureDevelopmentPolicy(selections.domain));
    files.push(
      ...(await generateReferenceGuides(runtimeRoot, {
        domain: selections.domain,
        stack_profile: selections.stack_profile,
      })),
    );

    return { files, warnings };
  }
}

function translateDiskFullError(error: unknown): unknown {
  if ((error as NodeJS.ErrnoException | null)?.code === 'ENOSPC') {
    return new FrameworkError('Not enough disk space — free up space and retry.', {
      code: 'DISK_FULL',
      cause: error,
      retryable: true,
    });
  }
  return error;
}

function mergeProfileOverrides(
  existing: ProjectProfile | null,
  explicit: Partial<ProjectProfile> | undefined,
): Partial<ProjectProfile> | undefined {
  if (!existing && !explicit) {
    return undefined;
  }
  return { ...(existing ?? {}), ...(explicit ?? {}) };
}

function persistRagConfig(projectRoot: string, intelligence: ProjectProfile['intelligence']): void {
  setGroupConfigValue(projectRoot, 'rag', 'rag_enabled', String(intelligence.rag_enabled));
  if (intelligence.embedding_provider) {
    setGroupConfigValue(
      projectRoot,
      'rag',
      'rag_embedding_provider',
      intelligence.embedding_provider,
    );
  }
  if (intelligence.embedding_model) {
    setGroupConfigValue(projectRoot, 'rag', 'rag_embedding_model', intelligence.embedding_model);
  }
}

function buildProjectProfile(
  selections: {
    domain: 'coding' | 'content';
    stack_profile: ProjectProfile['stack_profile'];
    providers?: AdapterType[];
  },
  snapshot: Awaited<ReturnType<StackIntrospector['snapshot']>>,
  overrides: Partial<ProjectProfile> | undefined,
  projectRoot: string,
): ProjectProfile {
  const stackProfile = selections.stack_profile ?? snapshot.profile;
  const defaultCommands = buildDefaultCommands(stackProfile, projectRoot);
  const derivedTesting =
    selections.domain === 'coding'
      ? deriveTestingForProfile({
          stackProfile,
          commands: defaultCommands,
          projectRoot,
          now: new Date().toISOString(),
        })
      : { commands: defaultCommands, testing: undefined };
  return {
    project: {
      name: overrides?.project?.name ?? 'paqad project',
      id: overrides?.project?.id ?? 'paqad-project',
      description: overrides?.project?.description ?? 'Generated by paqad-ai',
    },
    active_capabilities: deriveActiveCapabilities(selections.domain, stackProfile),
    stack_profile: selections.domain === 'coding' ? stackProfile : undefined,
    commands: overrides?.commands ?? derivedTesting.commands,
    ...(overrides?.testing
      ? { testing: overrides.testing }
      : derivedTesting.testing && !overrides?.commands
        ? { testing: derivedTesting.testing }
        : {}),
    strictness: overrides?.strictness ?? {
      full_lane_default: false,
      require_adversarial_review: true,
      block_on_stale_docs: true,
      require_db_review_for_migrations: true,
    },
    compliance_packs: overrides?.compliance_packs ?? [],
    features: overrides?.features ?? {
      spec_only_mode: false,
      market_research: false,
      design_research: false,
      team_agents: true,
      analytics_instrumentation: false,
      site_map: false,
      lean_rules: true,
      feature_report: true,
      metrics_enabled: true,
      visual_evidence: false,
      checks_parallel: true,
      checks_max_processes: 0,
    },
    enterprise: overrides?.enterprise ?? {
      enabled: false,
      evidence_ledger: false,
      ai_bom: false,
      compliance_citations: false,
    },
    paqad: overrides?.paqad ?? { enabled: true },
    mcp: overrides?.mcp ?? { servers: [] },
    model_routing: overrides?.model_routing ?? {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
    research: overrides?.research ?? { depth: 'standard' },
    intelligence: overrides?.intelligence ?? defaultIntelligenceConfig(),
    efficiency: overrides?.efficiency ?? DEFAULT_FRAMEWORK_CONFIG.efficiency,
    escalation: overrides?.escalation ?? {
      destructive_operations: 'block',
      risky_migrations: 'warn',
      security_findings: 'block',
      db_row_threshold: 10000,
    },
    custom: overrides?.custom ?? {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
      decisions: {
        ask_threshold: 'strict',
        max_screens_per_task: 3,
        idle_timeout_minutes: 30,
      },
    },
  };
}

function buildDefaultCommands(
  stackProfile: NonNullable<ProjectProfile['stack_profile']>,
  projectRoot: string,
): ProjectProfile['commands'] {
  const stack = getPrimaryStack({
    active_capabilities: ['content', 'coding', 'security'],
    stack_profile: stackProfile,
  });
  const usingCompose = stackProfile.traits.includes('compose');

  if (stack === 'laravel') {
    const testTool = resolveLaravelTestTool(stackProfile.traits);
    const usingSail = stackProfile.traits.includes('sail');
    return applyStructuredTestCommandPreference(
      {
        install: usingSail
          ? 'vendor/bin/sail composer install'
          : usingCompose
            ? 'docker compose exec <php-service> composer install'
            : 'composer install',
        dev: usingSail
          ? 'vendor/bin/sail up -d'
          : usingCompose
            ? 'docker compose up -d'
            : 'php artisan serve',
        test: testTool.command,
        test_single: testTool.single,
        lint: usingSail
          ? 'vendor/bin/sail php ./vendor/bin/pint'
          : usingCompose
            ? 'docker compose exec <php-service> ./vendor/bin/pint'
            : './vendor/bin/pint',
        format: usingSail
          ? 'vendor/bin/sail php ./vendor/bin/pint'
          : usingCompose
            ? 'docker compose exec <php-service> ./vendor/bin/pint'
            : './vendor/bin/pint',
        migrate: usingSail
          ? 'vendor/bin/sail artisan migrate'
          : usingCompose
            ? 'docker compose exec <php-service> php artisan migrate'
            : 'php artisan migrate',
        build: usingSail
          ? 'vendor/bin/sail npm run build'
          : usingCompose
            ? 'docker compose exec <node-service> pnpm build'
            : 'pnpm build',
      },
      stackProfile,
      projectRoot,
    );
  }

  if (stack === 'flutter') {
    return applyStructuredTestCommandPreference(
      {
        install: usingCompose
          ? 'docker compose exec <flutter-service> flutter pub get'
          : 'flutter pub get',
        dev: usingCompose ? 'docker compose up -d' : 'flutter run',
        test: usingCompose ? 'docker compose exec <flutter-service> flutter test' : 'flutter test',
        test_single: usingCompose
          ? 'docker compose exec <flutter-service> flutter test test/<path_or_file>.dart'
          : 'flutter test test/<path_or_file>.dart',
        lint: usingCompose
          ? 'docker compose exec <flutter-service> flutter analyze'
          : 'flutter analyze',
        format: usingCompose
          ? 'docker compose exec <flutter-service> dart format --set-exit-if-changed .'
          : 'dart format --set-exit-if-changed .',
        migrate: 'echo "configure migrate command"',
        build: usingCompose
          ? 'docker compose exec <flutter-service> flutter build <target>'
          : 'flutter build <target>',
      },
      stackProfile,
      projectRoot,
    );
  }

  if (
    stack === 'react' ||
    stack === 'vue' ||
    stack === 'express' ||
    stack === 'node-cli' ||
    stack === 'node-library' ||
    stack === 'node-service' ||
    stack === 'angular' ||
    stack === 'svelte' ||
    stack === 'astro'
  ) {
    return applyStructuredTestCommandPreference(
      buildNodeCommands(usingCompose, projectRoot),
      stackProfile,
      projectRoot,
    );
  }

  if (stack === 'django') {
    return applyStructuredTestCommandPreference(
      buildPythonCommands(usingCompose, {
        dev: 'python manage.py runserver',
        migrate: 'python manage.py migrate',
      }),
      stackProfile,
      projectRoot,
    );
  }

  if (stack === 'fastapi') {
    return applyStructuredTestCommandPreference(
      buildPythonCommands(usingCompose, {
        dev: 'uvicorn app.main:app --reload',
        migrate: 'echo "configure migrate command"',
      }),
      stackProfile,
      projectRoot,
    );
  }

  if (stack === 'rails') {
    return applyStructuredTestCommandPreference(
      buildRubyCommands(usingCompose),
      stackProfile,
      projectRoot,
    );
  }

  if (stack === 'spring-boot') {
    return applyStructuredTestCommandPreference(
      buildJvmCommands(stackProfile, usingCompose),
      stackProfile,
      projectRoot,
    );
  }

  if (stack === 'go-web') {
    return applyStructuredTestCommandPreference(
      buildGoCommands(usingCompose),
      stackProfile,
      projectRoot,
    );
  }

  if (stack === 'rust-web') {
    return applyStructuredTestCommandPreference(
      buildRustCommands(usingCompose),
      stackProfile,
      projectRoot,
    );
  }

  return applyStructuredTestCommandPreference(
    buildNodeCommands(false, projectRoot),
    stackProfile,
    projectRoot,
  );
}

function buildNodeCommands(usingCompose: boolean, projectRoot: string): ProjectProfile['commands'] {
  const manager = nodePackageManager(projectRoot);
  const scripts = packageScripts(projectRoot);
  const exec = (command: string) =>
    usingCompose ? `docker compose exec <node-service> ${command}` : command;
  const run = (name: string) =>
    manager === 'npm' && name !== 'test' ? `npm run ${name}` : `${manager} ${name}`;
  const has = (name: string) => (scripts === null ? name !== 'migrate' : scripts.has(name));
  const mapped = (name: string) => (has(name) ? exec(run(name)) : '');
  const single = manager === 'yarn' ? 'yarn test <pattern>' : `${manager} test -- <pattern>`;

  return {
    install: exec(`${manager} install`),
    dev: usingCompose ? 'docker compose up -d' : mapped('dev'),
    test: mapped('test'),
    test_single: has('test') ? exec(single) : '',
    lint: mapped('lint'),
    format: mapped('format'),
    migrate: mapped('migrate'),
    build: mapped('build'),
  };
}

function packageScripts(projectRoot: string): Set<string> | null {
  const manifestPath = join(projectRoot, 'package.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { scripts?: unknown };
    const scripts = manifest.scripts;
    return typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)
      ? new Set(Object.keys(scripts))
      : new Set();
  } catch {
    return null;
  }
}

function unmappedCommands(commands: ProjectProfile['commands']): string[] {
  return Object.entries(commands)
    .filter(([, command]) => command.trim().length === 0)
    .map(([name]) => name);
}

function applyStructuredTestCommandPreference(
  commands: ProjectProfile['commands'],
  stackProfile: NonNullable<ProjectProfile['stack_profile']>,
  projectRoot?: string,
): ProjectProfile['commands'] {
  if (commands.test.trim().length === 0) {
    return commands;
  }
  const runner = selectPreferredStructuredRunner(stackProfile, commands.test, projectRoot);
  if (!runner) {
    return commands;
  }

  return {
    ...commands,
    test: buildStructuredTestCommand(commands.test, runner),
    test_single: buildStructuredTestCommand(commands.test_single, runner),
  };
}

function selectPreferredStructuredRunner(
  stackProfile: NonNullable<ProjectProfile['stack_profile']>,
  testCommand: string,
  projectRoot?: string,
) {
  return selectTestRunner(stackProfile, testCommand, projectRoot);
}

function buildStructuredTestCommand(
  baseCommand: string,
  runner: { structured_flags?: string; output_source?: string; output_path_pattern?: string },
): string {
  const structuredFlags = runner.structured_flags?.trim();
  let command = structuredFlags ? appendRunnerFlags(baseCommand, structuredFlags) : baseCommand;
  const outputDir =
    runner.output_source === 'file' && runner.output_path_pattern
      ? resolveStructuredOutputDirectory(runner.output_path_pattern)
      : null;

  if (outputDir && outputDir !== '.' && outputDir !== '') {
    command = `mkdir -p ${outputDir} && ${command}`;
  }

  return command;
}

function resolveStructuredOutputDirectory(outputPathPattern: string): string | null {
  if (/[*?[{\]]/u.test(outputPathPattern)) {
    return null;
  }

  const outputDir = dirname(outputPathPattern);
  return outputDir === '.' || outputDir === '' ? null : outputDir;
}

function appendRunnerFlags(baseCommand: string, structuredFlags: string): string {
  const pnpmSeparator = /(\bpnpm\s+test)\s+--(?=\s|$)/u;
  if (pnpmSeparator.test(baseCommand)) {
    return `${baseCommand.replace(pnpmSeparator, '$1')} ${structuredFlags}`;
  }

  const separator = /\b(?:npm|yarn)\s+test$/u.test(baseCommand) ? ' --' : '';
  return `${baseCommand}${separator} ${structuredFlags}`;
}

function deriveActiveCapabilities(
  domain: 'coding' | 'content',
  stackProfile?: ProjectProfile['stack_profile'],
): ActiveCapability[] {
  const codingFrameworks =
    stackProfile?.frameworks.filter((framework) => framework !== 'short-video') ?? [];

  if (domain === 'coding' || codingFrameworks.length > 0) {
    return ['content', 'coding', 'security'];
  }

  return ['content'];
}

function resolveLaravelTestTool(traits: string[]): { command: string; single: string } {
  if (traits.includes('sail')) {
    return {
      command: 'vendor/bin/sail test',
      single: 'vendor/bin/sail test --filter="<pattern>"',
    };
  }

  if (traits.includes('compose')) {
    return {
      command: 'docker compose exec <php-service> php artisan test',
      single: 'docker compose exec <php-service> php artisan test --filter="<pattern>"',
    };
  }

  return {
    command: 'php artisan test',
    single: 'php artisan test --filter="<pattern>"',
  };
}

function buildPythonCommands(
  usingCompose: boolean,
  input: {
    dev: string;
    migrate: string;
  },
): ProjectProfile['commands'] {
  const exec = (command: string) =>
    usingCompose ? `docker compose exec <python-service> ${command}` : command;

  return {
    install: exec('pip install -r requirements.txt'),
    dev: usingCompose ? 'docker compose up -d' : input.dev,
    test: exec('pytest'),
    test_single: exec('pytest -k "<pattern>"'),
    lint: exec('ruff check .'),
    format: exec('ruff format .'),
    migrate: exec(input.migrate),
    build: exec('python -m compileall .'),
  };
}

function buildRubyCommands(usingCompose: boolean): ProjectProfile['commands'] {
  const exec = (command: string) =>
    usingCompose ? `docker compose exec <ruby-service> ${command}` : command;

  return {
    install: exec('bundle install'),
    dev: usingCompose ? 'docker compose up -d' : 'bin/dev',
    test: exec('bundle exec rspec'),
    test_single: exec('bundle exec rspec <path_or_file>'),
    lint: exec('bundle exec rubocop'),
    format: exec('bundle exec rubocop -A'),
    migrate: exec('bin/rails db:migrate'),
    build: exec('bin/rails assets:precompile'),
  };
}

function buildJvmCommands(
  stackProfile: NonNullable<ProjectProfile['stack_profile']>,
  usingCompose: boolean,
): ProjectProfile['commands'] {
  const packageManager =
    stackProfile.toolchains.find((toolchain) => toolchain.ecosystem === 'jvm')?.package_manager ??
    'gradle';
  const exec = (command: string) =>
    usingCompose ? `docker compose exec <jvm-service> ${command}` : command;

  if (packageManager === 'maven') {
    return {
      install: exec('./mvnw dependency:resolve'),
      dev: usingCompose ? 'docker compose up -d' : './mvnw spring-boot:run',
      test: exec('./mvnw test'),
      test_single: exec('./mvnw -Dtest=<pattern> test'),
      lint: exec('./mvnw verify'),
      format: exec('./mvnw spotless:apply'),
      migrate: 'echo "configure migrate command"',
      build: exec('./mvnw package'),
    };
  }

  return {
    install: exec('./gradlew dependencies'),
    dev: usingCompose ? 'docker compose up -d' : './gradlew bootRun',
    test: exec('./gradlew test'),
    test_single: exec('./gradlew test --tests "*<pattern>*"'),
    lint: exec('./gradlew check'),
    format: exec('./gradlew spotlessApply'),
    migrate: 'echo "configure migrate command"',
    build: exec('./gradlew build'),
  };
}

function buildGoCommands(usingCompose: boolean): ProjectProfile['commands'] {
  const exec = (command: string) =>
    usingCompose ? `docker compose exec <go-service> ${command}` : command;

  return {
    install: exec('go mod download'),
    dev: usingCompose ? 'docker compose up -d' : 'go run ./...',
    test: exec('go test ./...'),
    test_single: exec('go test ./... -run "<pattern>"'),
    lint: exec('go vet ./...'),
    format: exec('gofmt -w .'),
    migrate: 'echo "configure migrate command"',
    build: exec('go build ./...'),
  };
}

function buildRustCommands(usingCompose: boolean): ProjectProfile['commands'] {
  const exec = (command: string) =>
    usingCompose ? `docker compose exec <rust-service> ${command}` : command;

  return {
    install: exec('cargo fetch'),
    dev: usingCompose ? 'docker compose up -d' : 'cargo run',
    test: exec('cargo test'),
    test_single: exec('cargo test "<pattern>"'),
    lint: exec('cargo clippy --all-targets --all-features -- -D warnings'),
    format: exec('cargo fmt --check'),
    migrate: 'echo "configure migrate command"',
    build: exec('cargo build'),
  };
}
