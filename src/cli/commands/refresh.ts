import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AdapterFactory } from '@/adapters/factory.js';
import { DifferentialRefresh } from '@/context/differential-refresh.js';
import { PATHS } from '@/core/constants/paths.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { STACKS, type Stack } from '@/core/types/domain.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';
import { DesignTokenService } from '@/design-tokens/service.js';
import { Detector } from '@/detection/detector.js';
import { StackSnapshotCache } from '@/introspection/cache.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import { writeDecisionPauseContractDocument } from '@/onboarding/decision-pause-contract-writer.js';
import { writeGeneratedFiles } from '@/onboarding/file-writer.js';
import { RagService } from '@/rag/service.js';
import { reconcileModuleMap } from '@/module-map/reconciler.js';
import { discoverSourceRoots } from '@/module-map/source-roots.js';
import { writeStackArtifacts } from '@/stack-docs/generator.js';

export function createRefreshCommand(): Command {
  return new Command('refresh')
    .description('Refresh derived framework artifacts')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--design-system', 'Refresh design-system markdown from design tokens')
    .option('--stack', 'Refresh the cached stack snapshot')
    .option('--context', 'Refresh chunk and vector context indexes')
    .option(
      '--providers',
      'Re-render provider entry files and the canonical Decision Pause Contract doc',
    )
    .option(
      '--reconcile-module-map',
      'Run the module-map reconciler and exit non-zero on drift (issue #80 Phase 2)',
    )
    .action(
      async (options: {
        projectRoot: string;
        designSystem?: boolean;
        stack?: boolean;
        context?: boolean;
        providers?: boolean;
        reconcileModuleMap?: boolean;
      }) => {
        const hasExplicitTarget =
          options.designSystem === true ||
          options.stack === true ||
          options.context === true ||
          options.providers === true ||
          options.reconcileModuleMap === true;
        const shouldRefreshDesignSystem = hasExplicitTarget ? options.designSystem === true : true;
        const shouldRefreshStack = hasExplicitTarget ? options.stack === true : true;
        const shouldRefreshContext = options.context === true;
        const shouldRefreshProviders = options.providers === true;
        const shouldReconcileModuleMap = hasExplicitTarget
          ? options.reconcileModuleMap === true
          : true;
        const profile = readProjectProfile(options.projectRoot);

        if (shouldRefreshProviders) {
          await refreshProviderEntries(options.projectRoot);
        }

        if (shouldRefreshDesignSystem) {
          const designTokens = new DesignTokenService();
          const stack = resolveRefreshStack(profile?.stack_profile?.frameworks?.[0]);
          // Self-heal: seed default tokens if the file is missing. `seed` is
          // idempotent (flag 'wx', swallows EEXIST), so this is safe on every
          // refresh and unblocks projects whose tokens file was never seeded
          // or got deleted.
          await designTokens.seed(options.projectRoot);
          await designTokens.writeDocs(options.projectRoot);
          await designTokens.writeThemeExports(options.projectRoot, stack);
        }

        if (shouldRefreshStack) {
          const previous = await new StackSnapshotCache().read(options.projectRoot);
          const detection = await new Detector().detect(options.projectRoot);
          const snapshot = await new StackIntrospector().snapshot(options.projectRoot);
          const drift = await writeStackArtifacts(options.projectRoot, snapshot, previous, {
            writeHumanDocs: true,
          });

          if (profile !== null) {
            const nextCapabilities = detection.recommended_capabilities ?? ['content'];
            const nextProfile = {
              ...profile,
              active_capabilities: nextCapabilities,
              stack_profile: nextCapabilities.includes('coding') ? snapshot.profile : undefined,
            };
            writeProjectProfile(options.projectRoot, nextProfile);
            writeRefreshDrift(options.projectRoot, {
              previous_capabilities: profile.active_capabilities,
              current_capabilities: nextCapabilities,
              previous_packs: profile.stack_profile?.frameworks ?? [],
              current_packs: detection.matched_packs ?? [],
              stack_drift: drift,
            });
          }
        }
        let contextChangedFiles: string[] = [];
        if (shouldRefreshContext) {
          const syncResult = await new RagService(options.projectRoot).refreshContext();
          contextChangedFiles = [
            ...syncResult.changed_files,
            ...syncResult.added_files,
            ...syncResult.deleted_files,
          ];
        }

        if (shouldReconcileModuleMap) {
          const discovered = discoverSourceRoots(options.projectRoot);
          if (discovered.source_roots === null) {
            // Phase 2: packs do not yet declare module_health.source_roots.
            // Gracefully degrade — print a warning, do not break refresh.
            // Phase 3 populates every shipped pack and this branch becomes
            // unreachable for projects on a supported stack.
            console.error(
              'paqad-ai refresh: skipping module-map reconciliation — no stack pack declares module_health.source_roots.',
            );
          } else {
            const report = await reconcileModuleMap({
              projectRoot: options.projectRoot,
              sourceRoots: discovered.source_roots,
            });
            if (report.findings.length > 0) {
              console.error(
                `paqad-ai refresh: module-map drift detected (${report.findings.length} finding(s) — see .paqad/module-map/drift.json).`,
              );
              process.exitCode = 1;
            }
          }
        }

        if (profile?.efficiency.differential_refresh) {
          const changedFiles = resolveChangedFiles(options.projectRoot, contextChangedFiles);
          const differential = await new DifferentialRefresh().refresh(changedFiles);
          writeRefreshDrift(options.projectRoot, {
            differential_refresh: {
              changed_files: changedFiles,
              ...differential,
            },
          });
        }
      },
    );
}

async function refreshProviderEntries(projectRoot: string): Promise<void> {
  writeDecisionPauseContractDocument(projectRoot);

  // Re-render entry files for every adapter that already has its config file
  // present. Untouched adapters stay untouched — refresh should not silently
  // onboard new providers.
  for (const type of ADAPTER_TYPES) {
    const adapter = AdapterFactory.create(type);
    const configPath = join(projectRoot, adapter.getConfigPath());
    if (!existsSync(configPath)) {
      continue;
    }
    const files = await adapter.generateConfig({
      frameworkPath: PATHS.FRAMEWORK_PATH,
      rulesPath: 'docs/instructions/rules',
      projectRoot,
    });
    writeGeneratedFiles(projectRoot, files);
  }
}

function resolveRefreshStack(value: string | undefined): Stack | null {
  return value !== undefined && STACKS.includes(value as Stack) ? (value as Stack) : null;
}

function writeRefreshDrift(projectRoot: string, refreshDrift: Record<string, unknown>): void {
  const path = join(projectRoot, PATHS.STACK_DRIFT);
  const current = readExistingJson(path);
  writeFileSync(path, `${JSON.stringify({ ...(current ?? {}), ...refreshDrift }, null, 2)}\n`);
}

function readExistingJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveChangedFiles(projectRoot: string, contextChangedFiles: string[]): string[] {
  if (contextChangedFiles.length > 0) {
    return [...new Set(contextChangedFiles)].sort();
  }

  const trackedPath = join(projectRoot, PATHS.CHANGED_FILES);
  if (!existsSync(trackedPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(trackedPath, 'utf8'));
    if (!Array.isArray(parsed)) {
      return [];
    }

    return [
      ...new Set(parsed.filter((value): value is string => typeof value === 'string')),
    ].sort();
  } catch {
    return [];
  }
}
