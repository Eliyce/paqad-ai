import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { confirm } from '@inquirer/prompts';
import { Command } from 'commander';

import { AdapterFactory, type GeneratedFile } from '@/adapters/index.js';
import { teamSetupMissing } from '@/adapters/claude/team-setup.js';
import { deriveRecordedProviders } from '@/adapters/recorded-providers.js';
import { PATHS } from '@/core/constants/paths.js';
import { isGitIgnored } from '@/core/fs/git-tracked.js';
import { resolveFrameworkConfig, resolveTeamBootstrapEnabled } from '@/core/framework-config.js';
import { getDefaultEmbeddingModel } from '@/core/project-intelligence.js';
import { getProfileDomain, readProjectProfile } from '@/core/project-profile.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { getLegacyCapabilities, getPrimaryStack } from '@/core/stack-profile.js';
import type { AdapterType } from '@/core/types/adapter.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import { buildCodeKnowledgeIndex } from '@/code-knowledge/builder.js';
import { validateCodeKnowledgeIndex } from '@/code-knowledge/schema.js';
import { writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import { runDeliveryDetection } from '@/delivery/detect-run.js';
import { Detector } from '@/detection/detector.js';
import { installGitHooks } from '@/feature-evidence/git-hooks.js';
import { cleanupLegacyMcpFiles } from '@/mcp/cleanup.js';
import { McpConfigManager } from '@/mcp/config-manager.js';
import { VERSION } from '@/index.js';
import { bootstrapFrameworkHome } from '@/install/bootstrap.js';
import { StackSnapshotCache } from '@/introspection/cache.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import {
  collectQualityMeasures,
  createBaseline,
  readQualityBaseline,
  writeQualityBaseline,
} from '@/quality-ratchet/index.js';
import { writeStackArtifacts } from '@/stack-docs/generator.js';
import { writeGeneratedFiles } from '@/onboarding/file-writer.js';
import {
  readExistingOnboardingManifest,
  writeDetectionReport,
  writeFrameworkVersionPreservingTimestamp,
} from '@/onboarding/manifest-writer.js';
import { writeWorktreeInclude } from '@/onboarding/worktree-include-writer.js';
import { compileRules, writeCompiledRules } from '@/planning/index.js';
import { assertEmbeddingProviderAvailable } from '@/rag/removed-provider.js';
import { RagService } from '@/rag/service.js';
import { Resolver } from '@/resolver/resolver.js';
import { writeRuleContext } from '@/context/rule-context.js';

import { initializeRagIndex } from './rag.js';

export const JOIN_NOT_ONBOARDED_MESSAGE =
  'This project has not been onboarded yet. Ask the project lead to run `paqad-ai onboard`, or run it yourself if you are the lead.';
export const JOIN_RAG_OFF_MESSAGE = 'RAG is off for this project, nothing to build.';
export const JOIN_RAG_PRESENT_MESSAGE = 'RAG index is already present and valid, nothing to build.';
export const JOIN_RAG_BUILDING_MESSAGE =
  'Building your local RAG index (this stays on your machine and is not committed)...';
export const JOIN_TEAM_SETUP_MISSING_MESSAGE =
  'This repo does not carry the paqad team setup yet, so teammates and cloud sessions do not get paqad on their own. Ask the project lead to run `paqad-ai update` and commit the result.';
export const JOIN_READY_MESSAGE =
  'Ready. Your machine is set up for this project. No tracked files changed.';

const FRAMEWORK_VERSION_EPOCH_SEED = '1970-01-01T00:00:00Z';

export interface JoinProjectOptions {
  projectRoot: string;
  interactive?: boolean;
  rag?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
}

export function createJoinCommand(): Command {
  return new Command('join')
    .description('Set up an already-onboarded project on your machine (no re-onboarding)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--interactive', 'Opt in to prompts')
    .option('--no-rag', 'Skip the RAG step')
    .option('--yes', 'Accept the RAG build without confirming')
    .option(
      '--non-interactive',
      'Never prompt; build the RAG index without confirming (exit 2 with missing --yes if --interactive is set with no TTY and no --yes)',
    )
    .action(async (options: JoinProjectOptions) => joinProject(options));
}

export async function joinProject(options: JoinProjectOptions): Promise<void> {
  const { projectRoot } = options;
  const manifestPath = join(projectRoot, PATHS.ONBOARDING_MANIFEST);
  const profilePath = join(projectRoot, PATHS.PROJECT_PROFILE);
  if (!existsSync(manifestPath) || !existsSync(profilePath)) {
    throw new Error(JOIN_NOT_ONBOARDED_MESSAGE);
  }

  const manifest = readExistingOnboardingManifest(projectRoot);
  const profile = readProjectProfile(projectRoot, { persistMigration: false });
  if (!manifest || !profile) {
    throw new Error(JOIN_NOT_ONBOARDED_MESSAGE);
  }

  try {
    bootstrapFrameworkHome();
  } catch {}

  const providers = deriveRecordedProviders(manifest);
  await recreateLocalArtifacts(projectRoot, profile, providers);
  await regenerateMachineArtifacts(projectRoot);

  writeWorktreeInclude(projectRoot);

  if (
    providers.includes('claude-code') &&
    resolveTeamBootstrapEnabled(projectRoot) &&
    teamSetupMissing(projectRoot)
  ) {
    process.stdout.write(`${JOIN_TEAM_SETUP_MISSING_MESSAGE}\n`);
  }

  if (options.rag !== false) {
    const shouldContinue = await joinRag(projectRoot, options);
    if (!shouldContinue) {
      return;
    }
  }

  process.stdout.write(`${JOIN_READY_MESSAGE}\n`);
}

export { deriveRecordedProviders } from '@/adapters/recorded-providers.js';

async function recreateLocalArtifacts(
  projectRoot: string,
  profile: ProjectProfile,
  providers: AdapterType[],
): Promise<void> {
  const resolver = new Resolver({ runtimeRoot: getRuntimeRoot() });
  const resolved = await resolver.resolve({
    domain: getProfileDomain(profile),
    active_capabilities: profile.active_capabilities,
    stack_profile: profile.stack_profile,
    stack: getPrimaryStack(profile),
    capabilities: getLegacyCapabilities(profile),
  });
  const candidates: GeneratedFile[] = [];
  let recommendMcp = false;

  for (const provider of providers) {
    const adapter = AdapterFactory.create(provider);
    candidates.push(
      ...(await adapter.generateConfig({
        frameworkPath: PATHS.FRAMEWORK_PATH,
        rulesPath: PATHS.RULES_DIR,
        projectRoot,
      })),
    );
    if (adapter.capabilities.hooks) {
      candidates.push(...(await adapter.installHooks(resolved.hooks)));
    }
    recommendMcp ||= adapter.capabilities.mcp;
    if (adapter.capabilities.caching) {
      candidates.push(...(await adapter.configureCaching(profile)));
    }
    if (adapter.capabilities.memory) {
      candidates.push(...(await adapter.configureMemory(profile)));
    }
  }

  if (recommendMcp) {
    candidates.push({ ...new McpConfigManager().generate(profile), autoUpdate: true });
  }

  writeGeneratedFiles(
    projectRoot,
    candidates.filter((candidate) => isGitIgnored(projectRoot, candidate.path)),
  );

  cleanupLegacyMcpFiles(projectRoot, { canDelete: (path) => isGitIgnored(projectRoot, path) });

  if (isGitIgnored(projectRoot, PATHS.COMPILED_RULES)) {
    const compiled = await compileRules(projectRoot);
    await writeCompiledRules(projectRoot, compiled);
  }
  if (isGitIgnored(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT)) {
    await writeRuleContext(projectRoot);
  }
  if (isGitIgnored(projectRoot, PATHS.VECTORS_DIR)) {
    mkdirSync(join(projectRoot, PATHS.VECTORS_DIR), { recursive: true });
  }
  for (const dir of [
    PATHS.DECISIONS_PENDING_DIR,
    PATHS.DECISIONS_RESOLVED_DIR,
    PATHS.DECISIONS_EXPIRED_DIR,
  ]) {
    if (isGitIgnored(projectRoot, dir)) {
      mkdirSync(join(projectRoot, dir), { recursive: true });
    }
  }
  const hookResult = installGitHooks(projectRoot);
  if (hookResult.trackedHooksDir && hookResult.snippet) {
    process.stdout.write(
      `Your git hooks directory is tracked, so paqad did not modify it. Add this yourself:\n${hookResult.snippet}\n`,
    );
  }
  if (isGitIgnored(projectRoot, PATHS.FRAMEWORK_VERSION)) {
    writeFrameworkVersionPreservingTimestamp(
      join(projectRoot, PATHS.FRAMEWORK_VERSION),
      VERSION,
      FRAMEWORK_VERSION_EPOCH_SEED,
    );
  }
}

async function regenerateMachineArtifacts(projectRoot: string): Promise<void> {
  try {
    writeDetectionReport(projectRoot, await new Detector().detect(projectRoot));
  } catch {}
  try {
    const previous = await new StackSnapshotCache().read(projectRoot);
    const snapshot = await new StackIntrospector().snapshot(projectRoot);
    await writeStackArtifacts(projectRoot, snapshot, previous);
  } catch {}

  try {
    const index = await buildCodeKnowledgeIndex(projectRoot);
    if (validateCodeKnowledgeIndex(index).valid) {
      writeCodeKnowledgeIndex(projectRoot, index);
    }
  } catch {}

  try {
    await runDeliveryDetection(projectRoot, createDeliveryShell(projectRoot));
  } catch {}

  try {
    if ((await readQualityBaseline(projectRoot)) === null) {
      const current = await collectQualityMeasures({
        projectRoot,
        changedFiles: [],
        lane: 'full',
        stackProfile: null,
        deadCodeFiles: null,
      });
      await writeQualityBaseline(projectRoot, createBaseline(current, new Date().toISOString()));
    }
  } catch {}
}

async function joinRag(
  projectRoot: string,
  options: Pick<JoinProjectOptions, 'interactive' | 'yes' | 'nonInteractive'>,
): Promise<boolean> {
  const intelligence = resolveFrameworkConfig(projectRoot).intelligence;
  if (!intelligence.rag_enabled) {
    process.stdout.write(`${JOIN_RAG_OFF_MESSAGE}\n`);
    return true;
  }
  assertEmbeddingProviderAvailable(projectRoot, intelligence.embedding_provider);

  const service = new RagService(projectRoot);
  const status = await service.getStatus();
  if (status.index_present && status.valid) {
    process.stdout.write(`${JOIN_RAG_PRESENT_MESSAGE}\n`);
    return true;
  }

  if (options.interactive && !options.yes && !options.nonInteractive) {
    const accepted = await confirm({
      message: 'Build the local RAG index now?',
      default: true,
    });
    if (!accepted) {
      return false;
    }
  }

  process.stdout.write(`${JOIN_RAG_BUILDING_MESSAGE}\n`);
  const provider = intelligence.embedding_provider ?? 'local';
  await initializeRagIndex(projectRoot, {
    current: status,
    provider,
    model: intelligence.embedding_model ?? getDefaultEmbeddingModel(provider),
    buildOnly: true,
  });
  return true;
}
