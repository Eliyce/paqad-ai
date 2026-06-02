import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { PATHS, REGISTRIES } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { getProfileDomain, readProjectProfile } from '@/core/project-profile.js';
import type { ClassificationResult } from '@/core/types/classification.js';
import type { DesignTokenDocArtifact, ThemeExportArtifact } from '@/core/types/design-tokens.js';
import type { DocProgressEntry } from '@/core/types/document-generation.js';
import type { Capability, Domain, Stack } from '@/core/types/domain.js';
import type { DetectionReport } from '@/core/types/health.js';
import type { StackSnapshot } from '@/core/types/introspection.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { RepositoryContext } from '@/core/types/repository.js';
import { Detector } from '@/detection/detector.js';
import { DesignTokenService, DesignTokensPlaceholderError } from '@/design-tokens/service.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import {
  writeDetectionReport,
  writeOnboardingManifest,
  writeProjectProfile,
} from '@/onboarding/manifest-writer.js';
import {
  discoverModules,
  generateModuleMapYaml,
  loadModuleMap,
  writeModuleMap,
  type ModuleMap,
} from '@/onboarding/registry-generator.js';
import { writeStackArtifacts } from '@/stack-docs/generator.js';

import { DocumentProgressTracker } from './progress-tracker.js';
import { hashSourceFiles } from './staleness.js';

export type DocumentationWorkflowMode = 'foundation' | 'module-docs';

export interface DocumentationWorkflowOptions {
  projectRoot: string;
  mode?: DocumentationWorkflowMode;
  request?: Pick<ClassificationResult, 'domain' | 'stack' | 'request_text'> & {
    output_path?: string;
  };
}

export interface DocumentationWorkflowStep {
  id: string;
  summary: string;
  generated: string[];
  skipped: string[];
}

export interface DocumentationWorkflowResult {
  generated: string[];
  skipped: string[];
  progress_path: string;
  handover_path: string;
  module_map_path: string | null;
  module_docs_pending_map_review: boolean;
  module_map_low_confidence_modules: string[];
  orphaned_module_dirs: string[];
  stack_snapshot: StackSnapshot;
  effective_routing: {
    domain: Domain;
    stack: Stack;
    capabilities: Capability[];
  };
  profile_updated: boolean;
  steps: DocumentationWorkflowStep[];
}

interface EffectiveRouting {
  domain: Domain;
  stack: Stack;
  capabilities: Capability[];
}

interface ContentDeliverableInput {
  projectRoot: string;
  requestText: string;
  outputPath: string;
  routing: EffectiveRouting;
  stackSnapshot: StackSnapshot;
  profile: ProjectProfile;
}

interface FeatureDocDefinition {
  key: string;
  outputPath: string;
  build: (input: FeatureBuilderInput) => string;
}

interface ModuleDocDefinition {
  key: string;
  outputPath: string;
  build: (input: BuilderInput) => string;
}

interface BuilderInput {
  moduleName: string;
  title: string;
  stack: Stack;
  effectiveRouting: EffectiveRouting;
  sourceFiles: string[];
  moduleFiles: string[];
  stackSnapshot: StackSnapshot;
}

interface FeatureBuilderInput extends BuilderInput {
  featureName: string;
  featureTitle: string;
  featureFiles: string[];
}

const MODULE_DOCS: ModuleDocDefinition[] = [
  { key: 'summary', outputPath: 'index/summary.md', build: buildModuleSummary },
  { key: 'schema', outputPath: 'database/schema.md', build: buildDatabaseSchemaDoc },
  { key: 'indexes', outputPath: 'database/indexes.md', build: buildDatabaseIndexesDoc },
  { key: 'queries', outputPath: 'database/queries.md', build: buildDatabaseQueriesDoc },
  { key: 'dataVolumes', outputPath: 'database/data-volumes.md', build: buildDatabaseVolumesDoc },
  { key: 'apiEndpoints', outputPath: 'api/endpoints.md', build: buildApiEndpointsDoc },
  { key: 'apiSchemas', outputPath: 'api/schemas.md', build: buildApiSchemasDoc },
  { key: 'apiErrorCodes', outputPath: 'api/error-codes.md', build: buildApiErrorCodesDoc },
  {
    key: 'integrationEvents',
    outputPath: 'integration/events.md',
    build: buildIntegrationEventsDoc,
  },
  {
    key: 'integrationContracts',
    outputPath: 'integration/contracts.md',
    build: buildIntegrationContractsDoc,
  },
  { key: 'errorCatalog', outputPath: 'error-catalog.md', build: buildErrorCatalogDoc },
  { key: 'screens', outputPath: 'ui/screens.md', build: buildScreensDoc },
  { key: 'components', outputPath: 'ui/components.md', build: buildComponentsDoc },
  { key: 'states', outputPath: 'ui/states.md', build: buildStatesDoc },
];

const FEATURE_DOCS: FeatureDocDefinition[] = [
  { key: 'business', outputPath: 'business.md', build: buildBusinessDoc },
  { key: 'technical', outputPath: 'technical.md', build: buildTechnicalDoc },
];

export class DocumentationWorkflow {
  private readonly tracker = new DocumentProgressTracker();
  private readonly detector = new Detector();
  private readonly introspector = new StackIntrospector();

  async run(options: DocumentationWorkflowOptions): Promise<DocumentationWorkflowResult> {
    const mode = options.mode ?? 'foundation';

    if (mode === 'module-docs') {
      return this.runModuleDocs(options);
    }

    return this.runFoundation(options);
  }

  private async runModuleDocs(
    options: DocumentationWorkflowOptions,
  ): Promise<DocumentationWorkflowResult> {
    const moduleMap = await loadModuleMap(options.projectRoot);
    if (moduleMap === null) {
      throw new Error(
        'I cannot find docs/instructions/rules/module-map.yml. Prompt me with create documentation first, review the generated module map, then prompt me with create module documentation.',
      );
    }

    const profile = loadProjectProfile(options.projectRoot);
    if (profile === null) {
      throw new Error('Documentation workflow requires onboarding to complete first');
    }

    const progress = await this.tracker.load(options.projectRoot);
    await this.tracker.resetGeneratingEntries(options.projectRoot, progress);

    const detection = await this.detector.detect(options.projectRoot);
    const stackSnapshot = await this.introspector.snapshot(options.projectRoot);
    const routing = resolveEffectiveRouting(profile, detection, stackSnapshot, options.request);
    await syncOnboardingState(options.projectRoot, profile, detection, routing, stackSnapshot);

    const sourceFiles = await gatherSourceFiles(
      options.projectRoot,
      routing.stack,
      stackSnapshot.repository,
    );

    const generated: string[] = [];
    const skipped: string[] = [];
    const steps: DocumentationWorkflowStep[] = [];

    const orphanedModuleDirs = await findOrphanedModuleDirs(
      options.projectRoot,
      moduleMap.modules.map((m) => m.slug),
    );

    for (const mod of moduleMap.modules) {
      const moduleName = mod.slug;
      // Fix 3: prefer authoritative source_paths from the map; fall back to slug-matching only
      // when no paths are recorded so unrelated files are never used as evidence.
      // Directory paths (e.g. app/Modules/Billing) expand to all source files under that tree.
      const moduleFiles =
        mod.source_paths.length > 0
          ? resolveSourcePaths(mod.source_paths, sourceFiles)
          : selectModuleFiles(moduleName, sourceFiles);
      const title = mod.name;
      progress.modules[moduleName] ??= {};
      const moduleGenerated: string[] = [];
      const moduleSkipped: string[] = [];

      // Fix 2: an explicitly empty features array means the user reviewed it and wants no features.
      // Only fall back to discovery when features is absent from the map (null-ish), not when it is
      // an explicit empty array.
      const features =
        mod.features.length > 0
          ? mod.features.map((f) => ({
              name: f.slug,
              files:
                f.source_paths.length > 0
                  ? resolveSourcePaths(f.source_paths, sourceFiles)
                  : selectModuleFiles(f.slug, moduleFiles),
            }))
          : [];

      for (const feature of features) {
        for (const definition of FEATURE_DOCS) {
          const path = join(
            PATHS.MODULES_DIR,
            moduleName,
            PATHS.MODULE_FEATURES_DIR,
            feature.name,
            definition.outputPath,
          );
          const progressKey = `feature:${feature.name}:${definition.key}`;
          progress.modules[moduleName][progressKey] ??= this.tracker.createEntry(
            path,
            feature.files,
          );
          await processEntry({
            projectRoot: options.projectRoot,
            entry: progress.modules[moduleName][progressKey],
            content: definition.build({
              moduleName,
              title,
              stack: routing.stack,
              effectiveRouting: routing,
              sourceFiles,
              moduleFiles,
              stackSnapshot,
              featureName: feature.name,
              featureTitle: titleize(feature.name),
              featureFiles: feature.files,
            }),
            generated: moduleGenerated,
            skipped: moduleSkipped,
          });
        }
      }

      for (const definition of MODULE_DOCS) {
        const path = join(PATHS.MODULES_DIR, moduleName, definition.outputPath);
        progress.modules[moduleName][definition.key] ??= this.tracker.createEntry(
          path,
          moduleFiles,
        );
        await processEntry({
          projectRoot: options.projectRoot,
          entry: progress.modules[moduleName][definition.key],
          content: definition.build({
            moduleName,
            title,
            stack: routing.stack,
            effectiveRouting: routing,
            sourceFiles,
            moduleFiles,
            stackSnapshot,
          }),
          generated: moduleGenerated,
          skipped: moduleSkipped,
        });
      }

      generated.push(...moduleGenerated);
      skipped.push(...moduleSkipped);
      steps.push({
        id: `module-${moduleName}`,
        summary: `Updated canonical documentation for ${mod.name}`,
        generated: moduleGenerated,
        skipped: moduleSkipped,
      });
    }

    // Update registries from the reviewed map
    const moduleSlugs = moduleMap.modules.map((m) => m.slug);
    const registryGenerated: string[] = [];
    const registrySkipped: string[] = [];
    progress.global.registries ??= {};
    for (const registry of REGISTRIES) {
      const path = join(PATHS.REGISTRIES_DIR, registry);
      progress.global.registries[registry] ??= this.tracker.createEntry(path, sourceFiles);
      progress.global.registries[registry].state = 'not_started';
      await processEntry({
        projectRoot: options.projectRoot,
        entry: progress.global.registries[registry],
        content: buildRegistryDoc(registry, moduleSlugs, routing, stackSnapshot),
        generated: registryGenerated,
        skipped: registrySkipped,
      });
    }
    generated.push(...registryGenerated);
    skipped.push(...registrySkipped);
    steps.push({
      id: 'registries',
      summary: 'Refreshed canonical registries from reviewed module map',
      generated: registryGenerated,
      skipped: registrySkipped,
    });

    // Handover summary
    progress.global.handover ??= {};
    progress.global.handover.summary ??= this.tracker.createEntry(
      join('.paqad/handover', 'product-summary.md'),
      sourceFiles,
    );
    progress.global.handover.summary.state = 'not_started';
    const handoverGenerated: string[] = [];
    const handoverSkipped: string[] = [];
    await processEntry({
      projectRoot: options.projectRoot,
      entry: progress.global.handover.summary,
      content: buildHandoverSummary(moduleSlugs, generated, routing, stackSnapshot),
      generated: handoverGenerated,
      skipped: handoverSkipped,
    });
    generated.push(...handoverGenerated);
    skipped.push(...handoverSkipped);
    steps.push({
      id: 'handover',
      summary: 'Wrote product summary handover output',
      generated: handoverGenerated,
      skipped: handoverSkipped,
    });

    progress.moduleDocStage = 'complete';
    await this.tracker.save(options.projectRoot, progress);

    return {
      generated: generated.map(toPosixPath),
      skipped: skipped.map(toPosixPath),
      progress_path: PATHS.DOC_PROGRESS,
      handover_path: toPosixPath(join('.paqad/handover', 'product-summary.md')),
      module_map_path: PATHS.MODULE_MAP,
      module_docs_pending_map_review: false,
      module_map_low_confidence_modules: [],
      orphaned_module_dirs: orphanedModuleDirs,
      stack_snapshot: stackSnapshot,
      effective_routing: routing,
      profile_updated: false,
      steps,
    };
  }

  private async runFoundation(
    options: DocumentationWorkflowOptions,
  ): Promise<DocumentationWorkflowResult> {
    const profile = loadProjectProfile(options.projectRoot);
    if (profile === null) {
      throw new Error('Documentation workflow requires onboarding to complete first');
    }

    const progress = await this.tracker.load(options.projectRoot);
    await this.tracker.resetGeneratingEntries(options.projectRoot, progress);

    const detection = await this.detector.detect(options.projectRoot);
    const stackSnapshot = await this.introspector.snapshot(options.projectRoot);
    const routing = resolveEffectiveRouting(profile, detection, stackSnapshot, options.request);
    const profileUpdated = await syncOnboardingState(
      options.projectRoot,
      profile,
      detection,
      routing,
      stackSnapshot,
    );

    const sourceFiles = await gatherSourceFiles(
      options.projectRoot,
      routing.stack,
      stackSnapshot.repository,
    );

    // Write module-map.yml BEFORE discoverModules so that registries, architecture docs,
    // and tech-debt references all use business-language module names.  Any module names
    // explicitly mentioned in the request text are passed as high-confidence hints.
    const hintModuleNames = extractModuleNamesFromRequest(options.request?.request_text);
    const moduleMapYaml = await generateModuleMapYaml(options.projectRoot, hintModuleNames);
    await mkdir(join(options.projectRoot, PATHS.RULES_DIR), { recursive: true });
    await writeModuleMap(options.projectRoot, moduleMapYaml);

    const modules = await discoverModules(options.projectRoot);
    const generated: string[] = [];
    const skipped: string[] = [];
    const steps: DocumentationWorkflowStep[] = [];

    steps.push({
      id: 'validate-stack',
      summary: `Validated application stack as ${routing.stack} from project manifests`,
      generated: [],
      skipped: [],
    });

    const stackDrift = await writeStackArtifacts(
      options.projectRoot,
      stackSnapshot,
      stackSnapshot,
      { writeHumanDocs: true },
    );
    const stackDocs = [
      join(PATHS.FRAMEWORK_STACK_DIR, 'overview.md'),
      join(PATHS.FRAMEWORK_STACK_DIR, 'frameworks.md'),
      join(PATHS.FRAMEWORK_STACK_DIR, 'dependencies.md'),
      join(PATHS.FRAMEWORK_STACK_DIR, 'tooling.md'),
      join(PATHS.FRAMEWORK_STACK_DIR, 'version-rules.md'),
      join(PATHS.FRAMEWORK_STACK_DIR, 'sources.md'),
      join(PATHS.FRAMEWORK_STACK_DIR, 'drift-report.md'),
    ];
    generated.push(...stackDocs);
    steps.push({
      id: 'stack-context',
      summary: `Wrote stack context and drift review targets (${stackDrift.review_targets.length})`,
      generated: stackDocs,
      skipped: [],
    });

    if (routing.domain === 'content' && options.request?.request_text) {
      const contentOutputPath =
        options.request.output_path ?? defaultContentOutputPath(options.request.request_text);
      const contentBody = await buildContentDeliverable({
        projectRoot: options.projectRoot,
        requestText: options.request.request_text,
        outputPath: contentOutputPath,
        routing,
        stackSnapshot,
        profile,
      });
      await mkdir(dirname(join(options.projectRoot, contentOutputPath)), { recursive: true });
      await writeFile(join(options.projectRoot, contentOutputPath), contentBody);
      generated.push(contentOutputPath);
      steps.push({
        id: 'content-deliverable',
        summary: `Wrote content deliverable to ${contentOutputPath}`,
        generated: [contentOutputPath],
        skipped: [],
      });
    }

    const designTokenService = new DesignTokenService();
    // Seed a placeholder tokens file (a scaffold for the user to fill in), then
    // try to derive docs from it. While the file is still the unedited
    // placeholder, generation is skipped — we never ship design-system docs
    // built from generic defaults (issue #72).
    await designTokenService.seed(options.projectRoot);
    let designDocs: DesignTokenDocArtifact[] = [];
    let themeArtifacts: ThemeExportArtifact[] = [];
    let designSystemPlaceholderNote: string | undefined;
    try {
      designDocs = await designTokenService.generateDocs(options.projectRoot);
      themeArtifacts = await designTokenService.exportTheme(options.projectRoot, routing.stack);
    } catch (error) {
      if (error instanceof DesignTokensPlaceholderError) {
        designSystemPlaceholderNote = error.message;
      } else {
        throw error;
      }
    }

    progress.global.designSystem ??= {};
    const designSystemGenerated: string[] = [];
    const designSystemSkipped: string[] = [];
    progress.global.designSystem.designTokens ??= this.tracker.createEntry(
      PATHS.DESIGN_TOKENS_FILE,
      sourceFiles,
    );
    await processEntry({
      projectRoot: options.projectRoot,
      entry: progress.global.designSystem.designTokens,
      content: await readFile(join(options.projectRoot, PATHS.DESIGN_TOKENS_FILE), 'utf8'),
      generated: designSystemGenerated,
      skipped: designSystemSkipped,
    });
    for (const doc of designDocs) {
      const key = basenameWithoutExtension(doc.path);
      progress.global.designSystem[key] ??= this.tracker.createEntry(doc.path, [
        PATHS.DESIGN_TOKENS_FILE,
      ]);
      await processEntry({
        projectRoot: options.projectRoot,
        entry: progress.global.designSystem[key],
        content: doc.content,
        generated: designSystemGenerated,
        skipped: designSystemSkipped,
      });
    }
    await Promise.all(
      themeArtifacts.map(async (artifact) => {
        await mkdir(dirname(join(options.projectRoot, artifact.path)), { recursive: true });
        await writeFile(join(options.projectRoot, artifact.path), artifact.content);
        designSystemGenerated.push(artifact.path);
      }),
    );
    generated.push(...designSystemGenerated);
    skipped.push(...designSystemSkipped);
    steps.push({
      id: 'design-system',
      summary: designSystemPlaceholderNote
        ? `Seeded placeholder design tokens; skipped design-system docs — ${designSystemPlaceholderNote}`
        : 'Synced design-system documentation',
      generated: designSystemGenerated,
      skipped: designSystemSkipped,
    });

    progress.global.architecture ??= {};
    progress.global.architecture.overview ??= this.tracker.createEntry(
      join(PATHS.ARCHITECTURE_DIR, 'overview.md'),
      sourceFiles,
    );
    progress.global.architecture.decisions ??= this.tracker.createEntry(
      join(PATHS.ARCHITECTURE_DIR, 'decisions.md'),
      sourceFiles,
    );
    progress.global.architecture.patterns ??= this.tracker.createEntry(
      join(PATHS.ARCHITECTURE_DIR, 'patterns.md'),
      sourceFiles,
    );
    const architectureGenerated: string[] = [];
    const architectureSkipped: string[] = [];
    await processEntry({
      projectRoot: options.projectRoot,
      entry: progress.global.architecture.overview,
      content: buildArchitectureOverview(modules, routing, stackSnapshot),
      generated: architectureGenerated,
      skipped: architectureSkipped,
    });
    await processEntry({
      projectRoot: options.projectRoot,
      entry: progress.global.architecture.decisions,
      content: buildArchitectureDecisions(routing, stackSnapshot),
      generated: architectureGenerated,
      skipped: architectureSkipped,
    });
    await processEntry({
      projectRoot: options.projectRoot,
      entry: progress.global.architecture.patterns,
      content: buildArchitecturePatterns(routing, sourceFiles),
      generated: architectureGenerated,
      skipped: architectureSkipped,
    });
    generated.push(...architectureGenerated);
    skipped.push(...architectureSkipped);
    steps.push({
      id: 'architecture',
      summary: 'Updated global architecture documents',
      generated: architectureGenerated,
      skipped: architectureSkipped,
    });

    const registryGenerated: string[] = [];
    const registrySkipped: string[] = [];
    progress.global.registries ??= {};
    for (const registry of REGISTRIES) {
      const path = join(PATHS.REGISTRIES_DIR, registry);
      progress.global.registries[registry] ??= this.tracker.createEntry(path, sourceFiles);
      await processEntry({
        projectRoot: options.projectRoot,
        entry: progress.global.registries[registry],
        content: buildRegistryDoc(registry, modules, routing, stackSnapshot),
        generated: registryGenerated,
        skipped: registrySkipped,
      });
    }
    generated.push(...registryGenerated);
    skipped.push(...registrySkipped);
    steps.push({
      id: 'registries',
      summary: 'Refreshed canonical registries from current modules and stack context',
      generated: registryGenerated,
      skipped: registrySkipped,
    });

    progress.global.benchmarks ??= {};
    progress.global.benchmarks.index ??= this.tracker.createEntry(
      join(PATHS.BENCHMARKS_DIR, 'index.md'),
      sourceFiles,
    );
    progress.global.techDebt ??= {};
    progress.global.techDebt.index ??= this.tracker.createEntry(
      join(PATHS.TECH_DEBT_DIR, 'index.md'),
      sourceFiles,
    );
    const maintenanceGenerated: string[] = [];
    const maintenanceSkipped: string[] = [];
    await processEntry({
      projectRoot: options.projectRoot,
      entry: progress.global.benchmarks.index,
      content: buildBenchmarksDoc(routing, stackSnapshot),
      generated: maintenanceGenerated,
      skipped: maintenanceSkipped,
    });
    await processEntry({
      projectRoot: options.projectRoot,
      entry: progress.global.techDebt.index,
      content: buildTechDebtDoc(modules, routing),
      generated: maintenanceGenerated,
      skipped: maintenanceSkipped,
    });
    generated.push(...maintenanceGenerated);
    skipped.push(...maintenanceSkipped);
    steps.push({
      id: 'maintenance-docs',
      summary: 'Updated benchmarks and technical debt indexes',
      generated: maintenanceGenerated,
      skipped: maintenanceSkipped,
    });

    // The module-map.yml was written before discoverModules above.
    // Register it in generated and parse it now to surface low-confidence entries.
    generated.push(PATHS.MODULE_MAP);
    const writtenMap = (await loadModuleMap(options.projectRoot)) as ModuleMap;
    const lowConfidenceModules = writtenMap.modules
      .filter((m) => m.confidence === 'low')
      .map((m) => m.name);

    steps.push({
      id: 'module-map',
      summary: `Wrote module map to ${PATHS.MODULE_MAP} — review before running create module documentation`,
      generated: [PATHS.MODULE_MAP],
      skipped: [],
    });

    // Record that module docs are blocked pending map review
    progress.moduleDocStage = 'pending_map_review';
    await this.tracker.save(options.projectRoot, progress);

    return {
      generated: generated.map(toPosixPath),
      skipped: skipped.map(toPosixPath),
      progress_path: PATHS.DOC_PROGRESS,
      handover_path: toPosixPath(join('.paqad/handover', 'product-summary.md')),
      module_map_path: PATHS.MODULE_MAP,
      module_docs_pending_map_review: true,
      module_map_low_confidence_modules: lowConfidenceModules,
      orphaned_module_dirs: [],
      stack_snapshot: stackSnapshot,
      effective_routing: routing,
      profile_updated: profileUpdated,
      steps,
    };
  }
}

async function syncOnboardingState(
  projectRoot: string,
  profile: ProjectProfile,
  detection: DetectionReport,
  routing: EffectiveRouting,
  stackSnapshot: StackSnapshot,
): Promise<boolean> {
  const routingChanged =
    getProfileDomain(profile) !== routing.domain ||
    JSON.stringify(profile.stack_profile?.frameworks ?? []) !==
      JSON.stringify(stackSnapshot.profile.frameworks) ||
    JSON.stringify(profile.stack_profile?.traits ?? []) !==
      JSON.stringify(stackSnapshot.profile.traits);

  if (!routingChanged) {
    writeDetectionReport(projectRoot, detection);
    return false;
  }

  const updatedProfile: ProjectProfile = {
    ...profile,
    active_capabilities:
      routing.domain === 'coding' ? ['content', 'coding', 'security'] : ['content'],
    stack_profile: routing.domain === 'coding' ? stackSnapshot.profile : undefined,
  };
  writeProjectProfile(projectRoot, updatedProfile);
  writeDetectionReport(projectRoot, {
    ...detection,
    detected_domain: routing.domain,
    detected_stack: routing.stack,
    detected_capabilities: routing.capabilities,
    timestamp: stackSnapshot.generated_at,
  });

  const manifest = await readOnboardingManifest(projectRoot);
  if (manifest !== null) {
    writeOnboardingManifest(projectRoot, {
      ...manifest,
      profile: updatedProfile,
      repository: detection.repository ?? stackSnapshot.repository,
    });
  }

  return true;
}

function resolveEffectiveRouting(
  profile: ProjectProfile,
  detection: DetectionReport,
  stackSnapshot: StackSnapshot,
  request?: Pick<ClassificationResult, 'domain' | 'stack'>,
): EffectiveRouting {
  const ecosystems = new Set(stackSnapshot.toolchains.map((toolchain) => toolchain.ecosystem));
  const packageNames = new Set(stackSnapshot.packages.map((pkg) => pkg.name));

  const stack =
    detection.detected_stack ??
    (packageNames.has('laravel/framework') || ecosystems.has('php')
      ? 'laravel'
      : ecosystems.has('dart')
        ? 'flutter'
        : (request?.stack ??
          (stackSnapshot.profile.frameworks[0] as Stack | undefined) ??
          'laravel'));
  const domain =
    request?.domain ??
    detection.detected_domain ??
    (stack === 'short-video' ? 'content' : getProfileDomain(profile));
  const capabilities =
    detection.detected_capabilities.length > 0
      ? detection.detected_capabilities
      : (stackSnapshot.profile.traits.filter((trait) =>
          [
            'react',
            'vue',
            'inertia',
            'tailwind',
            'boost',
            'next',
            'remix',
            'vite-spa',
            'gatsby',
            'nuxt',
            'quasar',
          ].includes(trait),
        ) as Capability[]);

  return {
    domain,
    stack,
    capabilities,
  };
}

async function findOrphanedModuleDirs(
  projectRoot: string,
  reviewedSlugs: string[],
): Promise<string[]> {
  try {
    const modulesRoot = join(projectRoot, PATHS.MODULES_DIR);
    const entries = await readdir(modulesRoot, { withFileTypes: true });
    const slugSet = new Set(reviewedSlugs);
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !slugSet.has(e.name))
      .map((e) => toPosixPath(join(PATHS.MODULES_DIR, e.name)));
  } catch {
    return [];
  }
}

async function processEntry(input: {
  projectRoot: string;
  entry: DocProgressEntry;
  content: string;
  generated: string[];
  skipped: string[];
}): Promise<{ generated: string[]; skipped: string[] }> {
  const currentHash = await hashSourceFiles(input.projectRoot, input.entry.source_files);

  if (input.entry.state === 'done' && input.entry.source_hash === currentHash) {
    // Source-file hash is unchanged, but non-file inputs (module map edits, prompt
    // hints, routing changes) may have altered the intended content.  Compare the
    // existing file content before deciding to skip.
    const existingContent = await readFile(
      join(input.projectRoot, input.entry.output_path),
      'utf8',
    ).catch(() => null);
    if (existingContent === input.content) {
      input.skipped.push(input.entry.output_path);
      return { generated: [], skipped: [input.entry.output_path] };
    }
  }

  input.entry.state = 'generating';
  input.entry.started_at = new Date().toISOString();
  input.entry.error = null;

  await mkdir(dirname(join(input.projectRoot, input.entry.output_path)), { recursive: true });
  await writeFile(join(input.projectRoot, input.entry.output_path), input.content);
  input.generated.push(input.entry.output_path);

  input.entry.state = 'done';
  input.entry.completed_at = new Date().toISOString();
  input.entry.source_hash = currentHash;
  input.entry.tokens_used = Math.max(32, Math.round(input.content.length / 4));

  if (input.entry.output_path.endsWith('tokens.md')) {
    input.entry.design_tokens = {
      extraction_state: 'done',
      total_tokens_found: (input.content.match(/`/g) ?? []).length / 2,
      placeholder_count: (input.content.match(/\{[^}]+\}/g) ?? []).length,
      populated_count: Math.max(0, input.content.split('\n').length - 4),
      placeholder_keys: Array.from(
        new Set((input.content.match(/\{[^}]+\}/g) ?? []).map((item) => item.slice(1, -1))),
      ).slice(0, 10),
    };
  }

  return { generated: [input.entry.output_path], skipped: [] };
}

async function gatherSourceFiles(
  projectRoot: string,
  stack: Stack,
  repository?: RepositoryContext,
): Promise<string[]> {
  const roots = repository?.projects.length
    ? repository.projects.map((project) => project.root)
    : stack === 'flutter'
      ? ['lib', 'test', 'web', 'assets', 'pubspec.yaml']
      : stack === 'short-video'
        ? ['src', 'content', 'scripts', 'package.json']
        : [
            'app',
            'routes',
            'config',
            'resources',
            'database',
            'tests',
            'src',
            'server',
            'controllers',
            'services',
            'internal',
            'cmd',
            'lib',
            'api',
            'package.json',
            'composer.json',
            'requirements.txt',
            'pyproject.toml',
            'Gemfile',
            'pom.xml',
            'build.gradle',
            'build.gradle.kts',
            'go.mod',
            'Cargo.toml',
          ];
  const results = new Set<string>();

  for (const root of roots) {
    try {
      for (const file of await walk(join(projectRoot, root))) {
        results.add(relative(projectRoot, file));
      }
    } catch {
      if (!root.includes('.')) {
        continue;
      }

      results.add(root);
    }
  }

  if (results.size === 0) {
    results.add('package.json');
  }

  return Array.from(results).sort();
}

async function buildContentDeliverable(input: ContentDeliverableInput): Promise<string> {
  const styleGuide = await readOptionalFile(
    join(input.projectRoot, 'docs/instructions/rules/writing-style.md'),
  );
  const codingContext =
    input.profile.active_capabilities.includes('coding') &&
    input.stackSnapshot.profile.frameworks.length > 0
      ? [
          '## Technical Context',
          '',
          `- Coding stacks: ${input.stackSnapshot.profile.frameworks.map((framework) => `\`${framework}\``).join(', ')}`,
          `- Active traits: ${input.stackSnapshot.profile.traits.map((trait) => `\`${trait}\``).join(', ') || 'none'}`,
          '',
          'Embed only the minimum code or API detail needed to support the writing task.',
          '',
        ].join('\n')
      : '';

  return [
    `# ${input.requestText.trim()}`,
    '',
    '## Content Brief',
    '',
    '- Goal: Deliver a clear, publication-ready draft aligned with the project context.',
    `- Output path: \`${input.outputPath}\``,
    '- Required quality bar: precise structure, attributable claims, and concise code references.',
    '',
    codingContext,
    '## Writing Rules',
    '',
    '- Lead with the user outcome, then support it with specifics.',
    '- Prefer short sections and Markdown headings that scan well.',
    '- Attribute externally-derived claims and avoid unsupported assertions.',
    '- When code context is relevant, keep snippets brief and explain why they matter.',
    '',
    styleGuide ? ['## Project Writing Style', '', styleGuide.trim(), ''].join('\n') : '',
    '## Draft',
    '',
    '> Replace this draft with the final content deliverable.',
    '',
    '- Audience:',
    '- Key message:',
    '- Supporting points:',
    '- Call to action:',
    '',
  ]
    .filter((section) => section !== '')
    .join('\n');
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function defaultContentOutputPath(requestText: string): string {
  return join('content', `${slugify(requestText)}.md`);
}

function slugify(requestText: string): string {
  const slug = requestText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug.length > 0 ? slug : 'content-draft';
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) {
      if (
        [
          '.dart_tool',
          '.git',
          '.gradle',
          '.next',
          '.nuxt',
          '.turbo',
          'build',
          'coverage',
          'dist',
          'node_modules',
          'out',
          'target',
          'vendor',
        ].includes(entry.name)
      ) {
        continue;
      }
      files.push(...(await walk(target)));
      continue;
    }

    files.push(target);
  }

  return files;
}

function selectModuleFiles(moduleName: string, sourceFiles: string[]): string[] {
  const normalized = moduleName.toLowerCase();
  const matches = sourceFiles.filter((file) => file.toLowerCase().includes(normalized));

  return (matches.length > 0 ? matches : sourceFiles).slice(0, 12);
}

function loadProjectProfile(projectRoot: string): ProjectProfile | null {
  return readProjectProfile(projectRoot);
}

async function readOnboardingManifest(projectRoot: string): Promise<OnboardingManifest | null> {
  try {
    return JSON.parse(
      await readFile(join(projectRoot, PATHS.ONBOARDING_MANIFEST), 'utf8'),
    ) as OnboardingManifest;
  } catch {
    return null;
  }
}

function buildModuleSummary(input: BuilderInput): string {
  return [
    `# ${input.title} Summary`,
    '',
    `Stack: \`${input.stack}\``,
    '',
    '## What This Module Owns',
    '',
    `- Canonical ownership for ${input.moduleName} based on the current onboarded project.`,
    ...input.moduleFiles.slice(0, 5).map((file) => `- Evidence from \`${file}\``),
    '',
    '## Key Risks',
    '',
    '- Keep contracts, state changes, and external dependencies aligned with canonical docs.',
    '',
  ].join('\n');
}

function buildBusinessDoc(input: FeatureBuilderInput): string {
  return [
    `# ${input.featureTitle} Business`,
    '',
    '## Overview',
    '',
    `${input.featureTitle} is documented from the current ${input.stack} application state after onboarding.`,
    '',
    '## User Roles',
    '',
    '- Primary operators are inferred from the current product structure and routes/screens.',
    '',
    '## User Flows',
    '',
    ...input.featureFiles
      .slice(0, 5)
      .map((file, index) => `${index + 1}. Workflow signal from \`${file}\`.`),
    '',
    '## Business Rules',
    '',
    '- Preserve observed business invariants when implementation changes.',
    '- Update this document whenever ownership or user-visible behavior shifts.',
    '',
    '## Triggers and Side Effects',
    '',
    '- Review events, notifications, queues, or state transitions tied to this module.',
    '',
    '## Error States',
    '',
    '- Record user-visible failures and documented recovery expectations.',
    '',
    '## Glossary',
    '',
    `- Add ${input.featureTitle}-specific domain language here as it stabilizes.`,
    '',
  ].join('\n');
}

function buildTechnicalDoc(input: FeatureBuilderInput): string {
  return [
    `# ${input.featureTitle} Technical`,
    '',
    '## Module Boundaries',
    '',
    ...input.featureFiles.slice(0, 8).map((file) => `- \`${file}\``),
    '',
    '## Database Schema',
    '',
    input.stack === 'laravel'
      ? '- Review owned migrations, models, and table contracts from the Laravel application.'
      : '- Record local persistence or remote schema dependencies relevant to this module.',
    '',
    '## API Endpoints',
    '',
    '- Keep API docs, request schemas, and auth expectations aligned with implementation.',
    '',
    '## Models and Relationships',
    '',
    ...input.stackSnapshot.packages
      .slice(0, 5)
      .map((pkg) => `- \`${pkg.name}\` @ \`${pkg.locked_version}\``),
    '',
    '## State Management',
    '',
    stackStateHint(input.stack),
    '',
    '## Error Codes',
    '',
    '- Update structured error references in `error-catalog.md` and `api/error-codes.md` together.',
    '',
    '## Dependencies',
    '',
    ...buildPackageList(input.stackSnapshot),
    '',
    '## Configuration',
    '',
    '- Capture environment/config dependencies discovered in manifest and source files.',
    '',
    '## Testing Entry Points',
    '',
    '- Keep unit, integration, and end-to-end coverage references current.',
    '',
  ].join('\n');
}

function buildDatabaseSchemaDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — Database Schema`,
    '',
    '## Owned Data Structures',
    '',
    input.stack === 'laravel'
      ? '- Review tables, columns, and relationships from migrations and Eloquent models.'
      : '- Record local or remote data shapes relevant to this module.',
    '',
    '## Source Signals',
    '',
    ...input.moduleFiles.slice(0, 6).map((file) => `- \`${file}\``),
    '',
  ].join('\n');
}

function buildDatabaseIndexesDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — Database Indexes`,
    '',
    '## Index Coverage',
    '',
    '- Document lookup, uniqueness, and sorting indexes that materially affect behavior.',
    '',
    '## Query Hotspots',
    '',
    ...input.moduleFiles.slice(0, 4).map((file) => `- Review query patterns in \`${file}\`.`),
    '',
  ].join('\n');
}

function buildDatabaseQueriesDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — Queries`,
    '',
    '## Query Inventory',
    '',
    '- Record high-value reads, writes, aggregates, and reporting paths.',
    '',
    '## Optimization Notes',
    '',
    `- Prefer optimizations that match the ${input.stack} stack conventions.`,
    '',
  ].join('\n');
}

function buildDatabaseVolumesDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — Data Volumes`,
    '',
    '## Expected Scale',
    '',
    '- Capture rough row counts, churn, and retention expectations when known.',
    '',
    '## Growth Drivers',
    '',
    '- Note batch jobs, user growth, or event throughput that could affect this module.',
    '',
  ].join('\n');
}

function buildApiEndpointsDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — API Endpoints`,
    '',
    '> Canonical reference for routes, auth rules, payloads, and response contracts.',
    '',
    '## Current Signals',
    '',
    ...input.sourceFiles
      .filter((file) => file.includes('routes/') || file.includes('api/'))
      .slice(0, 6)
      .map((file) => `- Route or API signal from \`${file}\``),
    '',
    '## Documentation Rules',
    '',
    '- Add each endpoint with method, route, auth, schema, and error-code references.',
    '',
  ].join('\n');
}

function buildApiSchemasDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — API Schemas`,
    '',
    '## Request and Response Contracts',
    '',
    '- Keep request, response, and validation payloads aligned with the live application.',
    '',
    '## Related Sources',
    '',
    ...input.moduleFiles.slice(0, 5).map((file) => `- \`${file}\``),
    '',
  ].join('\n');
}

function buildApiErrorCodesDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — API Error Codes`,
    '',
    '## Canonical Error References',
    '',
    '- Keep structured API errors aligned with the module error catalog.',
    '',
    `- Prefix recommendation: \`${input.moduleName.toUpperCase()}-\``,
    '',
  ].join('\n');
}

function buildIntegrationEventsDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — Events`,
    '',
    '## Published Events',
    '',
    '- Record events emitted by this module and their downstream subscribers.',
    '',
    '## Consumed Events',
    '',
    '- Record events consumed from external modules or services.',
    '',
    '## Source Signals',
    '',
    ...input.moduleFiles.slice(0, 4).map((file) => `- \`${file}\``),
    '',
  ].join('\n');
}

function buildIntegrationContractsDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — Integration Contracts`,
    '',
    '## Internal Contracts',
    '',
    '- Document jobs, events, service contracts, and cross-module dependencies.',
    '',
    '## External Contracts',
    '',
    '- Record APIs, SDKs, and external service dependencies.',
    '',
  ].join('\n');
}

function buildErrorCatalogDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — Error Catalog`,
    '',
    '## Error Code Format',
    '',
    `${input.moduleName.toUpperCase()}-NNN`,
    '',
    '## Catalog Rules',
    '',
    '- Update user-facing message, internal message, recovery path, and alerting state together.',
    '',
  ].join('\n');
}

function buildScreensDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — Screens`,
    '',
    '## Screen Inventory',
    '',
    ...uiSignals(input).map((line) => `- ${line}`),
    '',
  ].join('\n');
}

function buildComponentsDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — Components`,
    '',
    '## UI Components',
    '',
    ...uiSignals(input).map((line) => `- ${line}`),
    '',
  ].join('\n');
}

function buildStatesDoc(input: BuilderInput): string {
  return [
    `# ${input.moduleName} — States`,
    '',
    '## State and Transition Notes',
    '',
    stackStateHint(input.stack),
    '',
    ...input.moduleFiles.slice(0, 4).map((file) => `- Validate state transitions in \`${file}\``),
    '',
  ].join('\n');
}

function buildArchitectureOverview(
  modules: string[],
  routing: EffectiveRouting,
  stackSnapshot: StackSnapshot,
): string {
  return [
    '# Architecture Overview',
    '',
    `Canonical documentation workflow resolved the project as \`${routing.domain}/${routing.stack}\`.`,
    '',
    '## Modules',
    '',
    ...modules.map((moduleName) => `- ${moduleName}`),
    '',
    '## Toolchains',
    '',
    ...stackSnapshot.toolchains.map(
      (toolchain) =>
        `- ${toolchain.ecosystem}: ${toolchain.package_manager} (${toolchain.lockfile})`,
    ),
    '',
  ].join('\n');
}

function buildArchitectureDecisions(
  routing: EffectiveRouting,
  stackSnapshot: StackSnapshot,
): string {
  return [
    '# Architecture Decisions',
    '',
    `- Canonical stack confirmed as \`${routing.stack}\` before documentation generation.`,
    `- Toolchains observed: ${stackSnapshot.toolchains.map((toolchain) => toolchain.package_manager).join(', ') || 'none'}.`,
    '- Update this file when architectural conventions or stack assumptions change.',
    '',
  ].join('\n');
}

function buildArchitecturePatterns(routing: EffectiveRouting, sourceFiles: string[]): string {
  return [
    '# Architecture Patterns',
    '',
    `- Documentation strategy selected for the \`${routing.stack}\` stack.`,
    ...sourceFiles.slice(0, 6).map((file) => `- Pattern evidence from \`${file}\``),
    '',
  ].join('\n');
}

function buildRegistryDoc(
  registry: string,
  modules: string[],
  routing: EffectiveRouting,
  stackSnapshot: StackSnapshot,
): string {
  return [
    `# ${registry}`,
    '',
    `Generated from the current ${routing.stack} project state.`,
    '',
    ...modules.map((moduleName) => `- ${moduleName}`),
    '',
    `Observed packages: ${stackSnapshot.packages.length}`,
    '',
  ].join('\n');
}

function buildBenchmarksDoc(routing: EffectiveRouting, stackSnapshot: StackSnapshot): string {
  return [
    '# Benchmarks',
    '',
    `Track performance-sensitive benchmarks for the ${routing.stack} stack.`,
    '',
    `Current package inventory: ${stackSnapshot.packages.length} package entries.`,
    '',
  ].join('\n');
}

function buildTechDebtDoc(modules: string[], routing: EffectiveRouting): string {
  return [
    '# Technical Debt',
    '',
    `Review debt across ${modules.length} module(s) for the ${routing.stack} stack.`,
    '',
    ...modules.map(
      (moduleName) =>
        `- ${moduleName}: capture follow-up items when docs drift from implementation.`,
    ),
    '',
  ].join('\n');
}

function buildHandoverSummary(
  modules: string[],
  generated: string[],
  routing: EffectiveRouting,
  stackSnapshot: StackSnapshot,
): string {
  return [
    '# Product Summary',
    '',
    `Documentation workflow completed for the \`${routing.stack}\` application.`,
    '',
    `Modules documented: ${modules.length}.`,
    `Artifacts written or refreshed: ${generated.length}.`,
    `Package snapshot entries: ${stackSnapshot.packages.length}.`,
    '',
  ].join('\n');
}

function buildPackageList(stackSnapshot: StackSnapshot): string[] {
  const packages = stackSnapshot.packages.slice(0, 6);

  if (packages.length === 0) {
    return ['- No stack snapshot packages available.'];
  }

  return packages.map((pkg) => `- \`${pkg.name}\` @ \`${pkg.locked_version}\``);
}

function uiSignals(input: BuilderInput): string[] {
  const candidates = input.sourceFiles.filter(
    (file) =>
      file.includes('resources/') ||
      file.includes('lib/') ||
      file.includes('ui/') ||
      file.includes('components/') ||
      file.includes('screens/'),
  );

  return (candidates.length > 0 ? candidates : input.moduleFiles).slice(0, 5);
}

function stackStateHint(stack: Stack): string {
  switch (stack) {
    case 'flutter':
      return '- Document widget state, navigation state, and asynchronous view-model transitions.';
    case 'short-video':
      return '- Document editorial states, publishing stages, and content workflow transitions.';
    default:
      return '- Document request lifecycle, domain state changes, and queued/background processing.';
  }
}

function titleize(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function basenameWithoutExtension(path: string): string {
  return (
    path
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '') ?? path
  );
}

/**
 * Resolves a list of mapped source_paths (which may be file paths or directory paths) against
 * the full set of discovered source files. Exact file paths are kept as-is; directory paths
 * expand to all source files that live under that directory tree.
 */
function resolveSourcePaths(mappedPaths: string[], sourceFiles: string[]): string[] {
  const result: string[] = [];
  for (const p of mappedPaths) {
    if (sourceFiles.includes(p)) {
      result.push(p);
    } else {
      // Treat as a directory prefix: include every source file whose path starts with <p>/
      const prefix = p.endsWith('/') ? p : `${p}/`;
      result.push(...sourceFiles.filter((f) => f.startsWith(prefix)));
    }
  }
  return result;
}

/**
 * Extracts explicit module names from a request string such as
 * "create documentation; modules are Billing and Orders".
 * Returns the raw name tokens (not yet slugified) so that casing is preserved.
 */
function extractModuleNamesFromRequest(requestText: string | undefined): string[] {
  if (!requestText) return [];
  // Match: "modules are/is/: Billing, Orders and Payments"
  const match = /\bmodules?\s*(?:are|is|:)\s*([\w][\w\s,]*)/i.exec(requestText);
  if (!match?.[1]) return [];
  return match[1]
    .split(/,|\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}
