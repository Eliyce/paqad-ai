import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AdapterFactory, type GeneratedFile } from '@/adapters/index.js';
import { PATHS } from '@/core/constants/paths.js';
import { FrameworkError, ValidationError } from '@/core/errors/index.js';
import {
  DEFAULT_FRAMEWORK_CONFIG,
  detectFlippedFrameworkValues,
  readConfigsDir,
  reconcileConfigOverrides,
  setConfigValue,
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
import { compileRuleScripts } from '@/rule-scripts/compile.js';
import {
  compileRules,
  DecisionStore,
  isCompiledRulesStale,
  writeCompiledRules,
} from '@/planning/index.js';

import { writeRuleContext } from '@/context/rule-context.js';
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
import {
  readExistingOnboardingManifest,
  writeDetectionReport,
  writeFrameworkMetadata,
  writeOnboardingManifest,
  writeProjectProfile,
} from './manifest-writer.js';
import { generateDeliveryPolicy } from './delivery-policy-generator.js';
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
  /**
   * PQD-424 (AC2) — when `true`, regenerate every artifact even if it already exists, including
   * the external-agent entry files (`CLAUDE.md`, `AGENTS.md`, …) that are otherwise left untouched
   * on a re-run. Defaults to `false`: existing files are not overwritten without this explicit opt-in.
   */
  forceOverwrite?: boolean;
  /**
   * PQD-424 — workspace governance applied before any disk write. When
   * `project_creation_disabled` is `true`, `run()` refuses cleanly (throws a `FrameworkError`
   * coded `PROJECT_CREATION_DISABLED`) without touching the filesystem.
   */
  workspacePolicy?: {
    project_creation_disabled?: boolean;
  };
}

export class OnboardingOrchestrator {
  /**
   * Two-phase onboarding. Phase 1 generates and writes every core artifact deterministically,
   * with no inquirer prompts. Phase 2 is the optional RAG opt-in: it can prompt, fail, or hang
   * and the project is still fully onboarded. See issue #62 for the regression this protects.
   */
  async run(options: OnboardingOptions): Promise<OnboardingOutput> {
    // PQD-424 (AC: policy) — refuse cleanly, before any disk write, when the
    // workspace bans project creation. No `.paqad/` artifact is produced.
    if (options.workspacePolicy?.project_creation_disabled === true) {
      throw new FrameworkError(
        'Project creation is disabled by workspace policy; onboarding will not run.',
        { code: 'PROJECT_CREATION_DISABLED' },
      );
    }

    // PQD-424 (AC: corrupted registry) — if a manifest already exists but is not
    // parseable, block adoption cleanly rather than silently clobbering it. A
    // `null` result means this is a first-time onboarding (used below to decide
    // whether to emit the one-shot `project.onboarded` audit event).
    const firstOnboarding = readExistingOnboardingManifest(options.projectRoot) === null;

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
    // Config-preservation: a re-onboard is a refresh, not a reset. Read the
    // existing profile and carry every user-set section forward (enterprise,
    // intelligence/RAG, paqad.enabled, escalation, model_routing, …) so onboarding
    // only refreshes detection-derived fields (active_capabilities, stack_profile)
    // and adds newly-introduced sections. Explicit caller overrides still win.
    // See docs/instructions/rules/coding/config-visibility.md.
    const existingProfile = readProjectProfile(options.projectRoot);
    const profile = buildProjectProfile(
      selections,
      liveSnapshot,
      mergeProfileOverrides(existingProfile, options.profileOverrides),
      options.projectRoot,
    );
    // Phase 1 keeps whatever RAG state the existing profile had (normalized);
    // Phase 2 may update it after the opt-in prompt. On a first onboard the
    // existing profile is absent, so this is the default (rag_enabled: false).
    profile.intelligence = applyRagSelection(profile.intelligence, undefined);
    const validator = new SchemaValidator();
    const validation = validator.validate('project-profile', profile);
    const modules = await discoverModules(options.projectRoot);

    if (!validation.valid) {
      throw new Error(validation.errors.map((error) => error.message).join('; '));
    }

    const generatedFiles: GeneratedFile[] = [];
    // PQD-424 (AC2) — the external-agent entry files (each adapter's prose config:
    // CLAUDE.md, AGENTS.md, GEMINI.md, .junie/AGENTS.md, …) are opt-in: written on
    // a fresh run but never silently overwritten on a re-run unless the caller
    // passes `forceOverwrite`. Tracked by path here and demoted to skip-if-present
    // below — without touching the adapter's `autoUpdate` flag, so the manifest
    // policy and `paqad-ai update`'s entry-file refresh stay exactly as before.
    const entryFilePaths = new Set<string>();
    // Issue #242 — the lean entry-stub body each provider renders, kept so a
    // pre-existing (Boost-authored) entry file can be wired with the bootstrap
    // contract as a managed block after the main write batch.
    const entryStubs: EntryStub[] = [];

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
    generatedFiles.push(...generateDeliveryPolicy(selections.domain));
    generatedFiles.push(
      ...(await generateReferenceGuides(runtimeRoot, {
        domain: selections.domain,
        stack_profile: selections.stack_profile,
      })),
    );

    // AC3 (resume) — skip any file a prior interrupted run already wrote, so this
    // call produces only the unwritten remainder. Empty/absent checkpoint ⇒ full run.
    const completed = new Set(readOnboardingCheckpoint(options.projectRoot) ?? []);
    const filesToWrite = generatedFiles
      .map((file) =>
        !options.forceOverwrite && entryFilePaths.has(file.path)
          ? { ...file, autoUpdate: false }
          : file,
      )
      .filter((file) => !completed.has(toPosixPath(file.path)));

    const onboardingWarnings: string[] = [];
    // The no-migration safety net result (non-default framework values a legacy
    // fat profile carried that the strip reverted). Assigned in the write batch
    // below (the catch always rethrows, so it is definitely set by the return),
    // surfaced as a dedicated, prominently-printed field.
    let revertedFrameworkValues: string[];
    let writeResult: ReturnType<typeof writeGeneratedFiles>;
    let drift: Awaited<ReturnType<typeof writeStackArtifacts>>;
    // AC (disk-full) — translate a raw ENOSPC from any core write into a clean,
    // user-facing FrameworkError instead of leaking a Node errno object.
    try {
      writeResult = writeGeneratedFiles(options.projectRoot, filesToWrite, {
        forceOverwrite: options.forceOverwrite,
      });
      // Issue #242 — a pre-existing provider entry file (a Boost-authored
      // CLAUDE.md/AGENTS.md, say) was demoted to skip-if-present above and left
      // unwired by the write batch. Append paqad's lean stub as a marker-fenced
      // managed block so the documented entry-file contract is established, with
      // the prior content preserved. Skipped under `forceOverwrite` (that path
      // fully regenerates the bare stub) and when paqad is disabled (#220/#229).
      // A bare stub a fresh onboard just wrote is detected as already-wired, so
      // this is a no-op there.
      if (!options.forceOverwrite && isFrameworkEnabled(profile)) {
        writeResult.written.push(...wireEntryStubs(options.projectRoot, entryStubs).wired);
      }
      // Persist progress the moment the main batch is durable, so an interrupt
      // after this point resumes with only the remainder.
      writeOnboardingCheckpoint(options.projectRoot, [...completed, ...writeResult.written]);
      drift = await writeStackArtifacts(
        options.projectRoot,
        { ...liveSnapshot, profile: profile.stack_profile ?? liveSnapshot.profile },
        previousSnapshot,
        { writeHumanDocs: false },
      );
      // The no-migration safety net: capture framework knobs a legacy fat
      // profile still carries that differ from defaults BEFORE the strip reverts
      // them, so a silent revert becomes a one-time visible notice (returned as a
      // dedicated field and printed prominently by the CLI).
      revertedFrameworkValues = detectFlippedFrameworkValues(options.projectRoot);
      writeProjectProfile(options.projectRoot, profile);
      // Framework knobs live in the `.config` layer, not the (lean) profile.
      // Write the tracked, self-documenting team config files (one per group,
      // every knob commented out at its default) plus the `configs/README`, then
      // persist only explicitly passed overrides (desktop/tests) into the
      // git-ignored `.config`. A plain CLI onboard passes none, and the group
      // files are all-commented, so every knob resolves to its code default.
      syncGroupConfigs(options.projectRoot);
      writeConfigsReadme(options.projectRoot);
      // Also write the single `.config.example` catalog — a copy-paste reference
      // listing every knob (never read at runtime). Always refreshed.
      writeConfigExample(options.projectRoot);
      if (options.profileOverrides) {
        writeFrameworkOverridesToConfig(options.projectRoot, options.profileOverrides);
      }
      // Reconcile the team/local override files against the current knob
      // registry: prune ONLY keys this version no longer knows, preserving every
      // value the team set (never reset-to-default). Surface what changed and any
      // multi-file key collision.
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
      writeGitignore(options.projectRoot);
      writeDetectionReport(options.projectRoot, detection);
      writeFrameworkMetadata(options.projectRoot, VERSION);
    } catch (error) {
      throw translateDiskFullError(error);
    }
    bootstrapFramework(options.projectRoot);
    new DecisionStore(options.projectRoot).initialize();
    // Issue #229 — the narration + decision-pause contracts are no longer copied
    // into the project's `.paqad/`. They are framework-owned content carried by
    // the install bootstrap (`AGENT-BOOTSTRAP.md`), loaded from there behind the
    // enablement check. Any stale project-level copies from a pre-#229 onboard are
    // pruned below (see `removeObsoleteContractDocs`).
    removeObsoleteContractDocs(options.projectRoot);
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
    // Issue #319 — arm the rules-as-scripts gate. Generate `rule-script-map.yml`
    // from the freshly written rule tree so the enforcement seam has a map to run
    // (without it, enforcement fast-skips and the deterministic gate is disarmed).
    // Runs after the rule tree is on disk and BEFORE the rule-context write below,
    // so the manifest correctly marks script-enforced rules. Non-fatal: a failure
    // only leaves the gate disarmed this run, never blocks onboarding.
    try {
      compileRuleScripts(options.projectRoot);
    } catch (error) {
      onboardingWarnings.push(
        `Rule-script map compilation failed during onboarding: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    // RAG buildout F4/F5 — (re)generate the rule slice of the session-context
    // artifact (always-resident manifest + full text of any rules that apply to
    // the files in play) so it tracks the rules we just (re)compiled. Generation
    // is cheap and machine-local; the seam decides whether to inject it
    // (rag_enabled). Non-fatal: a failure only means it is not refreshed this run.
    try {
      await writeRuleContext(options.projectRoot);
    } catch (error) {
      onboardingWarnings.push(
        `Rule context generation failed during onboarding: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    // Module-health profiles are no longer eagerly seeded at onboard: an all-null
    // profile per module reads identically to having none (both "unknown") and
    // only adds one file per module to the tree. They are created on demand the
    // first time real evidence maps to a module (syncModuleHealth →
    // applyEvidenceToProfile creates an unknown profile when none exists).
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

    // Phase 1 is fully durable on disk — clear the resume checkpoint so a later
    // re-run starts clean. AC3 only needs the checkpoint while phase 1 is in flight.
    deleteOnboardingCheckpoint(options.projectRoot);

    // AC (audit) — record `project.onboarded` once, on the first onboarding of
    // this project (manifest absent at entry). Re-runs are refreshes, not new
    // onboardings, so they do not append — which also keeps re-runs idempotent.
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
      warnings: [...writeResult.skipped, ...drift.review_targets, ...onboardingWarnings],
      reverted_framework_values: revertedFrameworkValues,
    };

    // Phase 1 is complete and durable on disk. Signal success before the optional RAG phase
    // so the CLI banner prints even if the RAG prompt or build hangs.
    options.onPhase1Complete?.(phase1Output);

    // ---------- Phase 2: optional RAG opt-in (may prompt; cannot drop phase 1 state) ----------
    const ragSelection = await resolveRagSelection(selections.domain, options.selections?.rag);
    if (ragSelection) {
      profile.intelligence = applyRagSelection(profile.intelligence, ragSelection);
      writeProjectProfile(options.projectRoot, profile);
      // RAG is a framework knob: persist it to `.config`, not the lean profile.
      persistRagConfig(options.projectRoot, profile.intelligence);
    }

    if (ragSelection?.enabled && ragSelection.provider) {
      try {
        await enableRagDuringOnboarding(options.projectRoot, ragSelection);
      } catch (error) {
        profile.intelligence = applyRagSelection(profile.intelligence, { enabled: false });
        writeProjectProfile(options.projectRoot, profile);
        // Reset is an explicit default-write so any earlier rag_enabled=true clears.
        setConfigValue(options.projectRoot, 'rag_enabled', 'false');
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

    return { files, warnings };
  }
}

/**
 * Translate a raw `ENOSPC` (disk full) Node error from a core onboarding write into a
 * clean, retryable {@link FrameworkError} (PQD-424). Any other error is returned unchanged
 * so the narrow disk-full catch never masks unrelated failures.
 */
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

/**
 * Section-level merge of the existing on-disk profile with caller-supplied
 * overrides, used as the base for {@link buildProjectProfile} on a re-onboard.
 * Existing user-set sections are preserved; an explicit `profileOverrides`
 * (programmatic callers, tests) wins over the existing value. Detection-derived
 * sections (`active_capabilities`, `stack_profile`) are always re-derived inside
 * `buildProjectProfile`, so carrying them here is harmless. Returns `undefined`
 * when neither source exists (a first onboard with no overrides).
 */
function mergeProfileOverrides(
  existing: ProjectProfile | null,
  explicit: Partial<ProjectProfile> | undefined,
): Partial<ProjectProfile> | undefined {
  if (!existing && !explicit) {
    return undefined;
  }
  return { ...(existing ?? {}), ...(explicit ?? {}) };
}

/** Persist the resolved RAG/intelligence selection into `.paqad/.config`. The
 *  profile YAML stays lean; RAG state is a framework knob like the rest. */
function persistRagConfig(projectRoot: string, intelligence: ProjectProfile['intelligence']): void {
  setConfigValue(projectRoot, 'rag_enabled', String(intelligence.rag_enabled));
  if (intelligence.embedding_provider) {
    setConfigValue(projectRoot, 'rag_embedding_provider', intelligence.embedding_provider);
  }
  if (intelligence.embedding_model) {
    setConfigValue(projectRoot, 'rag_embedding_model', intelligence.embedding_model);
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
      analytics_instrumentation: false,
      lean_rules: true,
    },
    // Issue #187 — emit the enterprise block at onboarding so the opt-in
    // evidence-ledger / AI-BOM / compliance-citation switches are visible and
    // toggleable in the generated profile. Defaults are all-off, which matches
    // the absent-block resolution in resolveEnterprisePolicy: a normal user pays
    // zero tokens and nothing is written under .paqad/ledger/.
    enterprise: overrides?.enterprise ?? {
      enabled: false,
      evidence_ledger: false,
      ai_bom: false,
      compliance_citations: false,
    },
    // Issue #220 / config-visibility — always materialize the global enable
    // switch so it is visible and toggleable in the generated profile, defaulting
    // ON. Absence already resolves to ON, but we write it explicitly so a team
    // never has to discover a hidden default. Preserved verbatim on re-onboard.
    paqad: overrides?.paqad ?? { enabled: true },
    mcp: overrides?.mcp ?? { servers: [] },
    model_routing: overrides?.model_routing ?? {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
    research: overrides?.research ?? { depth: 'standard' },
    intelligence: overrides?.intelligence ?? defaultIntelligenceConfig(),
    // Source from the canonical default so the in-memory profile (recorded in the
    // onboarding manifest) matches what a re-onboard's `.config` overlay feeds
    // back — otherwise the manifest's efficiency block drifts and onboarding is
    // no longer idempotent. The block is stripped from the YAML on write anyway.
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
