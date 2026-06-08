import {
  accessSync,
  constants as fsConstants,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { AdapterFactory, type GeneratedFile } from '@/adapters/index.js';
import { PATHS } from '@/core/constants/paths.js';
import { ValidationError } from '@/core/errors/index.js';
import { toPosixPath } from '@/core/path-utils.js';
import { defaultIntelligenceConfig } from '@/core/project-intelligence.js';
import type { AdapterType } from '@/core/types/adapter.js';
import type { ActiveCapability, Capability, Stack } from '@/core/types/domain.js';
import { getPrimaryStack } from '@/core/stack-profile.js';
import type { OnboardingOutput, OnboardingPreviewResult } from '@/core/types/onboarding.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { checkAndMigrateSchema } from '@/core/schema-version.js';
import { Detector } from '@/detection/detector.js';
import { VERSION } from '@/index.js';
import { StackSnapshotCache } from '@/introspection/cache.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import { getPackTestRunners } from '@/packs/project-packs.js';
import { Resolver } from '@/resolver/resolver.js';
import { writeStackArtifacts } from '@/stack-docs/generator.js';
import { SchemaValidator } from '@/validators/validator.js';
import {
  compileRules,
  DecisionStore,
  initializeModuleHealth,
  isCompiledRulesStale,
  writeCompiledRules,
} from '@/planning/index.js';

import { bootstrapFramework } from '@/install/bootstrap.js';

import { writeDecisionPauseContractDocument } from './decision-pause-contract-writer.js';
import { planGeneratedFiles, writeGeneratedFiles } from './file-writer.js';
import { writeGitignore } from './gitignore-writer.js';
import {
  writeDetectionReport,
  writeFrameworkMetadata,
  writeOnboardingManifest,
  writeProjectProfile,
} from './manifest-writer.js';
import { generateFeatureDevelopmentPolicy } from './feature-policy-generator.js';
import { resolveSelections } from './prompts.js';
import {
  applyRagSelection,
  enableRagDuringOnboarding,
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
    /**
     * Programmatic escape hatch for non-CLI callers. The CLI intentionally does not expose a
     * direct `--domain` override because domain selection is inferred from stack choice.
     */
    domain?: 'coding' | 'content';
    stack_profile?: ProjectProfile['stack_profile'];
    stack?: Stack;
    capabilities?: Capability[];
    rag?: RagSelection;
  };
  /**
   * Invoked after the project is fully written to disk and before the optional RAG phase runs.
   * Lets the CLI print the success banner while RAG (which may prompt or hang) executes after.
   * Invariant: by the time this fires, every core `.paqad/**` artifact already exists. See #62.
   */
  onPhase1Complete?: (result: OnboardingOutput) => void;
}

const NEXT_STEPS_MD = [
  '## Required: Create Documentation Foundation',
  '',
  'Before starting feature work, prompt your AI agent with:',
  '',
  '```text',
  'create documentation',
  '```',
  '',
  'This generates:',
  '- `docs/instructions/**`',
  '- `docs/instructions/rules/module-map.yml`',
  '',
  'Review `docs/instructions/rules/module-map.yml` first. Confirm that module and feature names use business language, then prompt your AI agent with:',
  '',
  '```text',
  'create module documentation',
  '```',
  '',
  'That second prompt generates `docs/modules/**` from the reviewed module map.',
  '',
  '## Optional: Give your rules teeth (rules-as-scripts)',
  '',
  'To enforce `docs/instructions/rules/**` with deterministic checks instead of relying on the model to remember them, prompt your AI agent with:',
  '',
  '```text',
  'analyze rules',
  '```',
  '',
  'Review the generated `docs/instructions/rules/rule-script-map.yml`, then:',
  '',
  '```text',
  'generate rule scripts',
  '```',
  '',
  'Scripts run during `feature-development.checks`. The dashboard shows a Rule Compliance card (unknown until the first run).',
].join('\n');

export class OnboardingOrchestrator {
  /**
   * Two-phase onboarding. Phase 1 generates and writes every core artifact deterministically,
   * with no inquirer prompts. Phase 2 is the optional RAG opt-in: it can prompt, fail, or hang
   * and the project is still fully onboarded. See issue #62 for the regression this protects.
   */
  async run(options: OnboardingOptions): Promise<OnboardingOutput> {
    // ---------- Phase 1: deterministic file writes (no RAG prompt) ----------
    // PQD-95 — reconcile the `.paqad/` schema layout before any artifact write:
    // stamp legacy projects, migrate older ones forward, and hard-stop (throw
    // SchemaVersionError) when the layout is newer than this engine understands.
    await checkAndMigrateSchema(options.projectRoot, VERSION);

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
    const profile = buildProjectProfile(
      selections,
      liveSnapshot,
      options.profileOverrides,
      options.projectRoot,
    );
    // Intelligence starts with defaults (rag_enabled: false). Phase 2 may update it.
    profile.intelligence = applyRagSelection(profile.intelligence, undefined);
    const validator = new SchemaValidator();
    const validation = validator.validate('project-profile', profile);
    const modules = await discoverModules(options.projectRoot);

    if (!validation.valid) {
      throw new Error(validation.errors.map((error) => error.message).join('; '));
    }

    const generatedFiles: GeneratedFile[] = [];

    for (const adapterType of adapters) {
      const adapter = AdapterFactory.create(adapterType);
      generatedFiles.push(
        ...(await adapter.generateConfig({
          frameworkPath: PATHS.FRAMEWORK_PATH,
          rulesPath: PATHS.RULES_DIR,
          projectRoot: options.projectRoot,
        })),
      );

      if (adapter.capabilities.hooks) {
        generatedFiles.push(...(await adapter.installHooks(resolved.hooks)));
      }

      if (adapter.capabilities.mcp) {
        generatedFiles.push(...(await adapter.installMcp(resolved.mcpConfigs, profile)));
      }

      if (adapter.capabilities.caching) {
        generatedFiles.push(...(await adapter.configureCaching(profile)));
      }

      if (adapter.capabilities.memory) {
        generatedFiles.push(...(await adapter.configureMemory(profile)));
      }
    }

    generatedFiles.push(...(await generateProjectRules(resolved.rules)));
    generatedFiles.push(...generateFeatureDevelopmentPolicy(selections.domain));
    generatedFiles.push(
      ...(await generateReferenceGuides(runtimeRoot, {
        domain: selections.domain,
        stack_profile: selections.stack_profile,
      })),
    );

    const silentUpdateSrc = join(runtimeRoot, 'hooks', 'silent-update.sh');
    try {
      const hookContent = readFileSync(silentUpdateSrc, 'utf8');
      generatedFiles.push({
        path: PATHS.HOOKS_SILENT_UPDATE,
        content: hookContent,
        autoUpdate: true,
        executable: true,
      });
    } catch {
      // Hook script not found — non-fatal, continue without it
    }

    const writeResult = writeGeneratedFiles(options.projectRoot, generatedFiles);
    const drift = await writeStackArtifacts(
      options.projectRoot,
      { ...liveSnapshot, profile: profile.stack_profile ?? liveSnapshot.profile },
      previousSnapshot,
      { writeHumanDocs: false },
    );
    const onboardingWarnings: string[] = [];
    writeProjectProfile(options.projectRoot, profile);
    writeGitignore(options.projectRoot);
    writeDetectionReport(options.projectRoot, detection);
    writeFrameworkMetadata(options.projectRoot, VERSION);
    bootstrapFramework(options.projectRoot);
    new DecisionStore(options.projectRoot).initialize();
    try {
      const wrote = writeDecisionPauseContractDocument(options.projectRoot);
      if (wrote) {
        writeResult.written.push(PATHS.DECISION_PAUSE_CONTRACT);
      }
    } catch (error) {
      onboardingWarnings.push(
        `Decision Pause Contract doc write failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    let compiledRulesPath = join(options.projectRoot, PATHS.COMPILED_RULES);
    let initializedModules: string[] = [];
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
      initializedModules = await Promise.all(
        modules.map(async (moduleName) => {
          await initializeModuleHealth(options.projectRoot, moduleName);
          return moduleName;
        }),
      );
    } catch (error) {
      onboardingWarnings.push(
        `Planning module health initialization failed during onboarding: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    try {
      const classifierConfigPath = join(options.projectRoot, '.paqad', 'classifier-config.json');
      writeFileSync(
        classifierConfigPath,
        JSON.stringify(
          {
            schema_version: 1,
            workflow_patterns: [
              {
                workflow: 'pentest-retest',
                priority: 250,
                patterns: ['pentest retest', 'pentest-retest'],
              },
              {
                workflow: 'pentest',
                priority: 240,
                patterns: ['run a pentest', 'penetration test', 'security audit'],
              },
              { workflow: 'root-cause-analysis', priority: 230, patterns: ['root cause', 'rca'] },
              {
                workflow: 'documentation-update',
                priority: 200,
                patterns: ['documentation', 'docs', 'documenation'],
              },
              { workflow: 'research', priority: 180, patterns: ['research', 'investigate'] },
              { workflow: 'cleanup', priority: 170, patterns: ['cleanup', 'clean up'] },
              { workflow: 'bug-fix', priority: 160, patterns: ['fix', 'bug'] },
              {
                workflow: 'feature-development',
                priority: 140,
                patterns: ['implement', 'build', 'add', 'feature', 'develop'],
              },
            ],
          },
          null,
          2,
        ) + '\n',
      );
      writeResult.written.push('.paqad/classifier-config.json');
    } catch (error) {
      onboardingWarnings.push(
        `Classifier config initialization failed during onboarding: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    try {
      const nextStepsPath = join(options.projectRoot, '.paqad', 'next-steps.md');
      writeFileSync(nextStepsPath, NEXT_STEPS_MD);
      writeResult.written.push('.paqad/next-steps.md');
    } catch (error) {
      onboardingWarnings.push(
        `Next-steps doc write failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    const manifestPath = writeOnboardingManifest(options.projectRoot, {
      framework_version: VERSION,
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
        module_health_initialized: initializedModules,
        classifier_config_path: '.paqad/classifier-config.json',
      },
    });

    const phase1Output: OnboardingOutput = {
      adapter: adapters[0],
      decision_pause_supported_adapters: adapters,
      generated_files: writeResult.written.map(toPosixPath),
      detected_modules: modules,
      runtime_root: toPosixPath(runtimeRoot),
      manifest_path: toPosixPath(manifestPath),
      warnings: [...writeResult.skipped, ...drift.review_targets, ...onboardingWarnings],
    };

    // Phase 1 is complete and durable on disk. Signal success before the optional RAG phase
    // so the CLI banner prints even if the RAG prompt or build hangs.
    options.onPhase1Complete?.(phase1Output);

    // ---------- Phase 2: optional RAG opt-in (may prompt; cannot drop phase 1 state) ----------
    const ragSelection = await resolveRagSelection(selections.domain, options.selections?.rag);
    if (ragSelection) {
      profile.intelligence = applyRagSelection(profile.intelligence, ragSelection);
      writeProjectProfile(options.projectRoot, profile);
    }

    if (ragSelection?.enabled && ragSelection.provider) {
      try {
        await enableRagDuringOnboarding(options.projectRoot, ragSelection);
      } catch (error) {
        profile.intelligence = applyRagSelection(profile.intelligence, { enabled: false });
        writeProjectProfile(options.projectRoot, profile);
        onboardingWarnings.push(
          `RAG setup failed during onboarding: ${error instanceof Error ? error.message : 'unknown error'}. Onboarding completed with RAG disabled.`,
        );
      }
    }

    return {
      ...phase1Output,
      warnings: [...writeResult.skipped, ...drift.review_targets, ...onboardingWarnings],
    };
  }

  /**
   * Read-only preview of onboarding (PQD-103). Runs the same deterministic file-planning
   * pipeline as Phase 1 of {@link run} — detector, introspector, resolver, adapter loop, rule
   * generator, reference guides, hook script read — collecting `GeneratedFile[]` in memory, then
   * classifies each target with {@link planGeneratedFiles} instead of writing it.
   *
   * Nothing is written to disk: no `writeFileSync`, no `bootstrapFramework`, no
   * `DecisionStore.initialize`, and crucially no `checkAndMigrateSchema` (which would migrate
   * the `.paqad/` layout). The caller (the desktop UI) uses the returned tree to render a
   * "this is what will be created / overwritten / skipped" confirmation panel before committing.
   *
   * @throws {ValidationError} if `projectRoot` is missing, unreadable, or not a directory. No
   *   partial {@link OnboardingPreviewResult} is returned in that case.
   */
  async preview(options: OnboardingOptions): Promise<OnboardingPreviewResult> {
    this.assertReadableDirectory(options.projectRoot);

    const { files, warnings } = await this.collectGeneratedFiles(options);
    const entries = planGeneratedFiles(options.projectRoot, files);

    return { entries, warnings };
  }

  /**
   * Validate that a path exists, is readable, and is a directory. Throws a stable
   * {@link ValidationError} (code `VALIDATION_ERROR`) otherwise — the consumer distinguishes
   * this from a generic failure to show the right copy.
   */
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

  /**
   * Build the in-memory `GeneratedFile[]` list exactly as Phase 1 of {@link run} does, with no
   * side effects. Kept separate from `run` so `run`'s write path stays untouched (PQD-103
   * additive-only safeguard). Returns any non-fatal warnings collected while planning.
   */
  private async collectGeneratedFiles(
    options: OnboardingOptions,
  ): Promise<{ files: GeneratedFile[]; warnings: string[] }> {
    const warnings: string[] = [];

    // Read-only preview: detect + snapshot without persisting anything to `.paqad/`.
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

      if (adapter.capabilities.mcp) {
        files.push(...(await adapter.installMcp(resolved.mcpConfigs, profile)));
      }

      if (adapter.capabilities.caching) {
        files.push(...(await adapter.configureCaching(profile)));
      }

      if (adapter.capabilities.memory) {
        files.push(...(await adapter.configureMemory(profile)));
      }
    }

    files.push(...(await generateProjectRules(resolved.rules)));
    files.push(...generateFeatureDevelopmentPolicy(selections.domain));
    files.push(
      ...(await generateReferenceGuides(runtimeRoot, {
        domain: selections.domain,
        stack_profile: selections.stack_profile,
      })),
    );

    const silentUpdateSrc = join(runtimeRoot, 'hooks', 'silent-update.sh');
    try {
      const hookContent = readFileSync(silentUpdateSrc, 'utf8');
      files.push({
        path: PATHS.HOOKS_SILENT_UPDATE,
        content: hookContent,
        autoUpdate: true,
        executable: true,
      });
    } catch {
      warnings.push('Silent-update hook script not found in runtime; preview omits it.');
    }

    return { files, warnings };
  }
}

function buildProjectProfile(
  selections: {
    domain: 'coding' | 'content';
    stack_profile: ProjectProfile['stack_profile'];
    providers?: AdapterType[];
  },
  snapshot: Awaited<ReturnType<StackIntrospector['snapshot']>>,
  overrides?: Partial<ProjectProfile>,
  projectRoot?: string,
): ProjectProfile {
  const stackProfile = selections.stack_profile ?? snapshot.profile;
  const defaultCommands = buildDefaultCommands(stackProfile, projectRoot);
  return {
    project: {
      name: overrides?.project?.name ?? 'paqad project',
      id: overrides?.project?.id ?? 'paqad-project',
      description: overrides?.project?.description ?? 'Generated by paqad-ai',
    },
    active_capabilities: deriveActiveCapabilities(selections.domain, stackProfile),
    stack_profile: selections.domain === 'coding' ? stackProfile : undefined,
    commands: overrides?.commands ?? defaultCommands,
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
      supply_chain_governance: false,
      ai_governance: false,
    },
    mcp: overrides?.mcp ?? { servers: [] },
    model_routing: overrides?.model_routing ?? {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
    research: overrides?.research ?? { depth: 'standard' },
    intelligence: overrides?.intelligence ?? defaultIntelligenceConfig(),
    efficiency: overrides?.efficiency ?? {
      context_hit_rate_target: 0.7,
      skill_caching: true,
      differential_refresh: true,
      mcp_first: true,
    },
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
        ask_threshold: 'balanced',
        max_screens_per_task: 3,
        idle_timeout_minutes: 30,
      },
    },
  };
}

function buildDefaultCommands(
  stackProfile: NonNullable<ProjectProfile['stack_profile']>,
  projectRoot?: string,
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
      {
        install: usingCompose ? 'docker compose exec <node-service> pnpm install' : 'pnpm install',
        dev: usingCompose ? 'docker compose up -d' : 'pnpm dev',
        test: usingCompose ? 'docker compose exec <node-service> pnpm test' : 'pnpm test',
        test_single: usingCompose
          ? 'docker compose exec <node-service> pnpm test -- <pattern>'
          : 'pnpm test -- <pattern>',
        lint: usingCompose ? 'docker compose exec <node-service> pnpm lint' : 'pnpm lint',
        format: usingCompose ? 'docker compose exec <node-service> pnpm format' : 'pnpm format',
        migrate: 'echo "configure migrate command"',
        build: usingCompose ? 'docker compose exec <node-service> pnpm build' : 'pnpm build',
      },
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
    {
      install: 'pnpm install',
      dev: 'pnpm dev',
      test: 'pnpm test',
      test_single: 'pnpm test -- <pattern>',
      lint: 'pnpm lint',
      format: 'pnpm format',
      migrate: 'echo "configure migrate command"',
      build: 'pnpm build',
    },
    stackProfile,
    projectRoot,
  );
}

function applyStructuredTestCommandPreference(
  commands: ProjectProfile['commands'],
  stackProfile: NonNullable<ProjectProfile['stack_profile']>,
  projectRoot?: string,
): ProjectProfile['commands'] {
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
  const runners = getPackTestRunners(stackProfile.frameworks, projectRoot).filter(
    (runner) => runner.structured_format !== 'none',
  );
  if (runners.length === 0) {
    return null;
  }

  const normalizedCommand = testCommand.toLowerCase();
  const exactMatch = runners.find((runner) =>
    normalizedCommand.includes(runner.runner_id.toLowerCase()),
  );
  return exactMatch ?? runners[0] ?? null;
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
  if (/\b(?:pnpm|npm|yarn)\s+test\s+--\s+/u.test(baseCommand)) {
    return `${baseCommand} ${structuredFlags}`;
  }

  if (/\b(?:pnpm|npm|yarn)\s+test$/u.test(baseCommand)) {
    return `${baseCommand} -- ${structuredFlags}`;
  }

  return `${baseCommand} ${structuredFlags}`;
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
      command: 'vendor/bin/sail artisan test',
      single: 'vendor/bin/sail artisan test --filter="<pattern>"',
    };
  }

  if (traits.includes('pest')) {
    return {
      command: './vendor/bin/pest',
      single: './vendor/bin/pest --filter="<pattern>"',
    };
  }

  if (traits.includes('phpunit')) {
    return {
      command: './vendor/bin/phpunit',
      single: './vendor/bin/phpunit --filter="<pattern>"',
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
