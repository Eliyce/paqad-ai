import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { PATHS } from '@/core/constants/paths.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import {
  checkoutIsNewer,
  reconcileConfigOverrides,
  syncGroupConfigs,
  writeConfigExample,
  writeConfigsReadme,
} from '@/core/framework-config.js';
import { toPosixPath } from '@/core/path-utils.js';
import { getProfileDomain, readProjectProfile } from '@/core/project-profile.js';
import { checkAndMigrateSchema } from '@/core/schema-version.js';
import { getLegacyCapabilities, getPrimaryStack } from '@/core/stack-profile.js';
import { runPendingEvidenceMigration } from '@/feature-evidence/migrate.js';
import { isPluginInstalled } from '@/health/plugin-install.js';
import { cleanupLegacyMcpFiles } from '@/mcp/cleanup.js';
import { VERSION } from '@/index.js';
import { writeManagedGitignoreBlock } from '@/onboarding/gitignore-writer.js';
import { writeFrameworkVersionPreservingTimestamp } from '@/onboarding/manifest-writer.js';
import { OnboardingOrchestrator } from '@/onboarding/orchestrator.js';
import { writeWorktreeInclude } from '@/onboarding/worktree-include-writer.js';
import { writeStageAgents } from '@/stage-isolation/agent-writer.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

const CLAUDE_HOOK_ARTIFACTS = new Set(['.claude/settings.json', '.claude/settings.hooks.json']);

export type UpdateCandidate = GeneratedFile;

export interface UpdateDiff {
  path: string;
  before: string;
  after: string;
}

export interface UpdateReport {
  previous_version: string | null;
  target_version: string;
  regenerated: string[];
  skipped: UpdateDiff[];
  deprecated: string[];
  new_mcp_servers: string[];
  new_scripts: string[];
  config_keys_pruned: string[];
}

export interface FrameworkUpdaterOptions {
  generateCandidates?: (projectRoot: string) => Promise<UpdateCandidate[]>;
}

interface NpmHookLib {
  hasLiveNpmHookLines: (settingsPath: string) => boolean;
}

async function holdsLiveNpmHooks(settingsPath: string): Promise<boolean> {
  const libPath = join(getRuntimeRoot(), 'hooks', 'lib', 'paqad-disabled.mjs');
  const lib = (await import(pathToFileURL(libPath).href)) as NpmHookLib;
  return lib.hasLiveNpmHookLines(settingsPath);
}

function readExistingText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export class FrameworkUpdater {
  constructor(private readonly options: FrameworkUpdaterOptions = {}) {}

  async run(projectRoot: string): Promise<UpdateReport> {
    await checkAndMigrateSchema(projectRoot, VERSION);
    runPendingEvidenceMigration(projectRoot);

    const previousVersion = readText(join(projectRoot, PATHS.FRAMEWORK_VERSION));
    const manifest = readManifest(projectRoot);
    const artifactPolicy = new Map(
      manifest?.generated_artifacts.map((artifact) => [artifact.path, artifact.auto_update]) ?? [],
    );
    const candidates = await this.getCandidates(projectRoot);
    const regenerated: string[] = [];
    const skipped: UpdateDiff[] = [];
    const newScripts: string[] = [];

    const pluginInstalled = isPluginInstalled();

    for (const candidate of candidates) {
      const reportedPath = toPosixPath(candidate.path);
      const target = join(projectRoot, candidate.path);
      if (
        pluginInstalled &&
        CLAUDE_HOOK_ARTIFACTS.has(reportedPath) &&
        !(await holdsLiveNpmHooks(target))
      ) {
        continue;
      }
      const existing = readExistingText(target);
      const existed = existing !== null;
      const autoUpdate = artifactPolicy.get(candidate.path) ?? candidate.autoUpdate;

      if (existing !== null && autoUpdate === false) {
        skipped.push({
          path: reportedPath,
          before: existing,
          after: candidate.content,
        });
        continue;
      }

      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, candidate.content);
      if (candidate.executable === true) {
        chmodSync(target, 0o755);
      }

      regenerated.push(reportedPath);
      if (!existed && reportedPath.startsWith('scripts/')) {
        newScripts.push(reportedPath);
      }
    }

    cleanupLegacyMcpFiles(projectRoot);

    writeConfigsReadme(projectRoot);
    writeConfigExample(projectRoot);
    syncGroupConfigs(projectRoot);
    const configKeysPruned = reconcileConfigOverrides(projectRoot).flatMap((file) => file.removed);

    if (!pluginInstalled) {
      try {
        writeStageAgents();
      } catch {}
    }

    mkdirSync(dirname(join(projectRoot, PATHS.FRAMEWORK_VERSION)), { recursive: true });
    writeFrameworkVersionPreservingTimestamp(
      join(projectRoot, PATHS.FRAMEWORK_VERSION),
      VERSION,
      new Date().toISOString(),
    );
    if (!checkoutIsNewer(projectRoot)) {
      writeManagedGitignoreBlock(projectRoot);
    }
    writeWorktreeInclude(projectRoot);

    return {
      previous_version: previousVersion,
      target_version: VERSION,
      regenerated,
      skipped,
      deprecated: [],
      new_mcp_servers: [],
      new_scripts: newScripts.sort(),
      config_keys_pruned: configKeysPruned,
    };
  }

  private async getCandidates(projectRoot: string): Promise<UpdateCandidate[]> {
    if (this.options.generateCandidates) {
      return this.options.generateCandidates(projectRoot);
    }

    const profile = readProfile(projectRoot);
    if (profile === null) {
      throw new Error('Cannot update framework-managed artifacts without a project profile');
    }

    const tempRoot = await mkdtemp(join(tmpdir(), 'paqad-ai-update-'));

    try {
      const result = await new OnboardingOrchestrator().run({
        projectRoot: tempRoot,
        selections: {
          domain: getProfileDomain(profile),
          stack_profile: profile.stack_profile,
          stack: getPrimaryStack(profile),
          capabilities: getLegacyCapabilities(profile),
        },
        profileOverrides: profile,
      });
      const tempManifest = readManifest(tempRoot);
      const files = await collectFiles(tempRoot, result.generated_files, tempManifest);

      return files;
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

function readManifest(projectRoot: string): OnboardingManifest | null {
  const path = join(projectRoot, PATHS.ONBOARDING_MANIFEST);

  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, 'utf8')) as OnboardingManifest;
}

function readProfile(projectRoot: string): ProjectProfile | null {
  return readProjectProfile(projectRoot);
}

function readText(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  const raw = readFileSync(path, 'utf8');
  const match = raw.match(/^version=(.+)$/m);
  return match ? match[1].trim() : raw.trim();
}

async function collectFiles(
  root: string,
  generated: string[],
  manifest?: OnboardingManifest | null,
): Promise<UpdateCandidate[]> {
  const paths = generated.length > 0 ? generated : await walk(root);
  const artifactPolicy = new Map(
    manifest?.generated_artifacts.map((artifact) => [artifact.path, artifact]) ?? [],
  );

  return Promise.all(
    paths.map(async (file) => ({
      path: file,
      content: await readFile(join(root, file), 'utf8'),
      autoUpdate: artifactPolicy.get(file)?.auto_update ?? true,
      executable: artifactPolicy.get(file)?.executable ?? file.startsWith('scripts/'),
    })),
  );
}

async function walk(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(root, absolute)));
      continue;
    }

    files.push(relative(root, absolute));
  }

  return files.sort();
}
