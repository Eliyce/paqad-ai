import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { AdapterFactory } from '@/adapters/factory.js';
import { DifferentialRefresh } from '@/context/differential-refresh.js';
import { PATHS } from '@/core/constants/paths.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';
import { Detector } from '@/detection/detector.js';
import { StackSnapshotCache } from '@/introspection/cache.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import { removeObsoleteContractDocs } from '@/onboarding/obsolete-cleanup.js';
import { readGitChangedFiles } from '@/pipeline/change-evidence.js';
import { writeGeneratedFiles } from '@/onboarding/file-writer.js';
import { refreshProjectRules, type RulesRefreshReport } from '@/onboarding/rules-refresh.js';
import { RagService } from '@/rag/service.js';
import { reconcileModuleMap } from '@/module-map/reconciler.js';
import { discoverSourceRoots } from '@/module-map/source-roots.js';
import { writeStackArtifacts } from '@/stack-docs/generator.js';

export function createRefreshCommand(): Command {
  return new Command('refresh')
    .description('Refresh derived framework artifacts')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--stack', 'Refresh the cached stack snapshot')
    .option('--context', 'Refresh chunk and vector context indexes')
    .option(
      '--providers',
      'Re-render provider entry files and the canonical Decision Pause Contract doc',
    )
    .option('--reconcile-module-map', 'Run the module-map reconciler and exit non-zero on drift')
    .option(
      '--rules',
      'Regenerate docs/instructions/rules from the framework rule packs for the saved stack',
    )
    .option(
      '--force',
      'With --rules, delete the existing generated rules and rewrite them (otherwise report the plan only)',
    )
    .action(
      async (options: {
        projectRoot: string;
        stack?: boolean;
        context?: boolean;
        providers?: boolean;
        reconcileModuleMap?: boolean;
        rules?: boolean;
        force?: boolean;
      }) => {
        const hasExplicitTarget =
          options.stack === true ||
          options.context === true ||
          options.providers === true ||
          options.reconcileModuleMap === true ||
          options.rules === true;

        if (!hasExplicitTarget) {
          console.error(
            'paqad-ai refresh: nothing to refresh — every target is opt-in. Choose one or more:\n' +
              '  --stack                 refresh the cached stack snapshot and docs/instructions/stack/*\n' +
              '  --context               refresh chunk and vector context indexes\n' +
              '  --providers             re-render provider entry files and the Decision Pause Contract doc\n' +
              '  --rules                 regenerate docs/instructions/rules from the framework rule packs\n' +
              '  --reconcile-module-map  reconcile module-map.yml and fail on drift\n' +
              'The design system (docs/instructions/design-system/*) is owned by the documentation workflow ("create documentation"), not refresh.',
          );
          return;
        }

        const shouldRefreshStack = options.stack === true;
        const shouldRefreshContext = options.context === true;
        const shouldRefreshProviders = options.providers === true;
        const shouldReconcileModuleMap = options.reconcileModuleMap === true;
        const shouldRefreshRules = options.rules === true;
        const profile = readProjectProfile(options.projectRoot);

        if (shouldRefreshRules) {
          if (profile === null) {
            console.error(
              'paqad-ai refresh --rules: no project profile found. Run `paqad-ai onboard` first.',
            );
            process.exitCode = 1;
          } else {
            const report = await refreshProjectRules(options.projectRoot, profile, {
              force: options.force === true,
            });
            printRulesReport(report);
          }
        }

        if (shouldRefreshProviders) {
          await refreshProviderEntries(options.projectRoot);
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
          const changedFiles = await resolveChangedFiles(options.projectRoot, contextChangedFiles);
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

function printRulesReport(report: RulesRefreshReport): void {
  const preservedNote =
    report.preserved.length > 0
      ? ` Preserved (project-owned): ${report.preserved.join(', ')}.`
      : '';

  if (report.dryRun) {
    console.error(
      `paqad-ai refresh --rules (dry run): ${report.deleted.length} rule file(s) would be deleted, ` +
        `${report.written.length} would be written. Re-run with --force to apply.${preservedNote}`,
    );
    return;
  }

  console.error(
    `paqad-ai refresh --rules: deleted ${report.deleted.length}, wrote ${report.written.length} rule file(s).${preservedNote}`,
  );
}

async function refreshProviderEntries(projectRoot: string): Promise<void> {
  removeObsoleteContractDocs(projectRoot);

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
    if (adapter instanceof ClaudeCodeAdapter) {
      adapter.syncTeamSetup(projectRoot);
    }
  }
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

async function resolveChangedFiles(
  projectRoot: string,
  contextChangedFiles: string[],
): Promise<string[]> {
  if (contextChangedFiles.length > 0) {
    return [...new Set(contextChangedFiles)].sort();
  }

  return readGitChangedFiles(projectRoot);
}
