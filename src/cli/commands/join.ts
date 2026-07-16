import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { confirm } from '@inquirer/prompts';
import { Command } from 'commander';

import { AdapterFactory, type GeneratedFile } from '@/adapters/index.js';
import { PATHS } from '@/core/constants/paths.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { getDefaultEmbeddingModel } from '@/core/project-intelligence.js';
import { getProfileDomain, readProjectProfile } from '@/core/project-profile.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { getLegacyCapabilities, getPrimaryStack } from '@/core/stack-profile.js';
import { ADAPTER_TYPES, type AdapterType } from '@/core/types/adapter.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import { installGitHooks } from '@/feature-evidence/git-hooks.js';
import { VERSION } from '@/index.js';
import { writeGeneratedFiles } from '@/onboarding/file-writer.js';
import {
  readExistingOnboardingManifest,
  writeFrameworkVersionPreservingTimestamp,
} from '@/onboarding/manifest-writer.js';
import { compileRules, writeCompiledRules } from '@/planning/index.js';
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
export const JOIN_READY_MESSAGE =
  'Ready. Your machine is set up for this project. No tracked files changed.';

export interface JoinProjectOptions {
  projectRoot: string;
  interactive?: boolean;
  rag?: boolean;
  yes?: boolean;
}

export function createJoinCommand(): Command {
  return new Command('join')
    .description('Set up an already-onboarded project on your machine (no re-onboarding)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--interactive', 'Opt in to prompts')
    .option('--no-rag', 'Skip the RAG step')
    .option('--yes', 'Accept the RAG build without confirming')
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

  const providers = deriveRecordedProviders(manifest);
  await recreateLocalArtifacts(projectRoot, manifest, profile, providers);

  if (options.rag !== false) {
    const shouldContinue = await joinRag(projectRoot, options);
    if (!shouldContinue) {
      return;
    }
  }

  process.stdout.write(`${JOIN_READY_MESSAGE}\n`);
}

export function deriveRecordedProviders(manifest: OnboardingManifest): AdapterType[] {
  const artifactPaths = new Set(
    manifest.generated_artifacts.map((artifact) => artifact.path.replaceAll('\\', '/')),
  );
  const recorded = ADAPTER_TYPES.filter((type) => {
    const configPath = AdapterFactory.create(type).getConfigPath().replaceAll('\\', '/');
    return artifactPaths.has(configPath);
  });
  return [manifest.adapter, ...recorded.filter((type) => type !== manifest.adapter)];
}

async function recreateLocalArtifacts(
  projectRoot: string,
  manifest: OnboardingManifest,
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
    if (adapter.capabilities.mcp) {
      candidates.push(...(await adapter.installMcp(resolved.mcpConfigs, profile)));
    }
    if (adapter.capabilities.caching) {
      candidates.push(...(await adapter.configureCaching(profile)));
    }
    if (adapter.capabilities.memory) {
      candidates.push(...(await adapter.configureMemory(profile)));
    }
  }

  writeGeneratedFiles(
    projectRoot,
    candidates.filter(
      (candidate) =>
        !existsSync(join(projectRoot, candidate.path)) && isGitIgnored(projectRoot, candidate.path),
    ),
  );

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
  installGitHooks(projectRoot);
  if (isGitIgnored(projectRoot, PATHS.FRAMEWORK_VERSION)) {
    writeFrameworkVersionPreservingTimestamp(
      join(projectRoot, PATHS.FRAMEWORK_VERSION),
      VERSION,
      new Date().toISOString(),
    );
  }
  if (isGitIgnored(projectRoot, PATHS.AGENT_ENTRY_SENTINEL)) {
    writeFileSync(
      join(projectRoot, PATHS.AGENT_ENTRY_SENTINEL),
      `${JSON.stringify({
        loaded_at: new Date().toISOString(),
        entry_file: AdapterFactory.create(manifest.adapter).getConfigPath(),
        framework_version: VERSION,
      })}\n`,
      'utf8',
    );
  }
}

async function joinRag(
  projectRoot: string,
  options: Pick<JoinProjectOptions, 'interactive' | 'yes'>,
): Promise<boolean> {
  const intelligence = resolveFrameworkConfig(projectRoot).intelligence;
  if (!intelligence.rag_enabled) {
    process.stdout.write(`${JOIN_RAG_OFF_MESSAGE}\n`);
    return true;
  }

  const service = new RagService(projectRoot);
  const status = await service.getStatus();
  if (status.index_present && status.valid) {
    process.stdout.write(`${JOIN_RAG_PRESENT_MESSAGE}\n`);
    return true;
  }

  if (options.interactive && !options.yes) {
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
  });
  return true;
}

function isGitIgnored(projectRoot: string, path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--no-index', '--', path], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}
