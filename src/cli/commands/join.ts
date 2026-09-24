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
import { buildCodeKnowledgeIndex } from '@/code-knowledge/builder.js';
import { validateCodeKnowledgeIndex } from '@/code-knowledge/schema.js';
import { writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import { runDeliveryDetection } from '@/delivery/detect-run.js';
import { Detector } from '@/detection/detector.js';
import { installGitHooks } from '@/feature-evidence/git-hooks.js';
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

  // Issue #576 (Finding 2) — set up the GLOBAL install first. `join` used to skip this (only
  // `onboard`/`install` did it), so on a machine that never onboarded a project, `~/.paqad-ai/
  // current` and the stage agents did not exist: every generated hook command resolved to a
  // missing module and the host silently treated the failure as non-blocking, leaving ALL gates
  // off, and `CLAUDE.md → .paqad/framework-path.txt → ~/.paqad-ai/current/AGENT-BOOTSTRAP.md`
  // dangled. The HOME-ONLY bootstrap creates the framework symlink and the stage agents under the
  // user home and writes NOTHING into the project, so join's "no tracked files changed" contract
  // holds. Best-effort: a home-write failure must not abort join (the local artifacts below are
  // still worth recreating, and a later `paqad-ai install`/session retries the home install).
  try {
    bootstrapFrameworkHome();
  } catch {
    // best-effort — a later `paqad-ai install`/session re-attempts the home install.
  }

  const providers = deriveRecordedProviders(manifest);
  await recreateLocalArtifacts(projectRoot, manifest, profile, providers);
  await regenerateMachineArtifacts(projectRoot);

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

/**
 * Regenerate the per-machine artifacts a teammate needs but that never arrive via clone (all
 * git-ignored, so join's no-tracked-diff contract holds). Before this, only `onboard`/the
 * documentation workflow produced them, so a teammate who ran `join` hit: `doctor` failing on the
 * missing detection/stack reports (Finding 4); the reuse gate, evidence-armed reuse forks and the
 * spec code check all degraded with no code-knowledge index (Finding 7); delivery falling back to
 * framework defaults with no delivery-detection (Finding 8); and a quality floor captured with the
 * teammate's first diff baked in (Finding 6). Every step is best-effort — a failure here must not
 * fail join (the machine is still usable, and the next onboard/refresh/session retries).
 */
async function regenerateMachineArtifacts(projectRoot: string): Promise<void> {
  // Finding 4 — the detection report + stack snapshot/drift that `doctor` reads.
  try {
    writeDetectionReport(projectRoot, await new Detector().detect(projectRoot));
  } catch {
    // best-effort
  }
  try {
    const previous = await new StackSnapshotCache().read(projectRoot);
    const snapshot = await new StackIntrospector().snapshot(projectRoot);
    await writeStackArtifacts(projectRoot, snapshot, previous);
  } catch {
    // best-effort
  }

  // Finding 7 — the git-ignored code-knowledge index (reuse gate, evidence-armed reuse forks,
  // spec code check). Only the index itself is written here: `index build`'s tracked side
  // artifacts (the `docs/instructions/registries/` reuse catalog and module-map evidence) are the
  // lead's committed registries and arrive via clone, so a teammate `join` must not rewrite them.
  try {
    const index = await buildCodeKnowledgeIndex(projectRoot);
    if (validateCodeKnowledgeIndex(index).valid) {
      writeCodeKnowledgeIndex(projectRoot, index);
    }
  } catch {
    // best-effort
  }

  // Finding 8 — delivery detection (host, base branch, branch/commit templates).
  try {
    await runDeliveryDetection(projectRoot, createDeliveryShell(projectRoot));
  } catch {
    // best-effort
  }

  // Finding 6 — seed the quality-ratchet baseline from the clean HEAD. join runs on a freshly
  // cloned tree (working tree == HEAD), so measuring now captures the committed baseline instead
  // of the teammate's first in-progress diff. Only when no baseline exists yet — never clobber one.
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
  } catch {
    // best-effort
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
    // Issue #576 (Finding 3) — build the index only; never rewrite the tracked profile or the
    // dev-local `.config` on a teammate machine (they belong to the team's committed config).
    buildOnly: true,
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
