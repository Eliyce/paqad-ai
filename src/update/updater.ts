import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { PATHS } from '@/core/constants/paths.js';
import {
  reconcileConfigOverrides,
  syncGroupConfigs,
  writeConfigExample,
  writeConfigsReadme,
} from '@/core/framework-config.js';
import { toPosixPath } from '@/core/path-utils.js';
import { getProfileDomain, readProjectProfile } from '@/core/project-profile.js';
import { getLegacyCapabilities, getPrimaryStack } from '@/core/stack-profile.js';
import { VERSION } from '@/index.js';
import { writeFrameworkVersionPreservingTimestamp } from '@/onboarding/manifest-writer.js';
import { OnboardingOrchestrator } from '@/onboarding/orchestrator.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

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
  /** Obsolete config keys pruned from `.config` / `configs/.config.*` because
   *  this version's knob registry no longer knows them (never reset-to-default). */
  config_keys_pruned: string[];
}

export interface FrameworkUpdaterOptions {
  generateCandidates?: (projectRoot: string) => Promise<UpdateCandidate[]>;
}

export class FrameworkUpdater {
  constructor(private readonly options: FrameworkUpdaterOptions = {}) {}

  async run(projectRoot: string): Promise<UpdateReport> {
    const previousVersion = readText(join(projectRoot, PATHS.FRAMEWORK_VERSION));
    const manifest = readManifest(projectRoot);
    const artifactPolicy = new Map(
      manifest?.generated_artifacts.map((artifact) => [artifact.path, artifact.auto_update]) ?? [],
    );
    const candidates = await this.getCandidates(projectRoot);
    const regenerated: string[] = [];
    const skipped: UpdateDiff[] = [];
    const newScripts: string[] = [];

    for (const candidate of candidates) {
      // Normalize the reported path for user-facing fields (regenerated,
      // skipped, new_scripts). Use native `candidate.path` for filesystem
      // ops since Node accepts mixed separators on Windows.
      const reportedPath = toPosixPath(candidate.path);
      const target = join(projectRoot, candidate.path);
      const existed = existsSync(target);
      const autoUpdate = artifactPolicy.get(candidate.path) ?? candidate.autoUpdate;

      if (existed && autoUpdate === false) {
        skipped.push({
          path: reportedPath,
          before: readFileSync(target, 'utf8'),
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

    // Refresh the team config layer: write the README and sync the group files
    // (create any missing one fully; append knobs added in a newer version to
    // existing files, commented; preserve every value the team uncommented).
    // Then reconcile: PRUNE ONLY keys this version no longer knows, preserving
    // every value the team set (never reset-to-default). This is the knob
    // add/remove evolution path — added keys surface in the group files, removed
    // keys are pruned here and reported.
    writeConfigsReadme(projectRoot);
    writeConfigExample(projectRoot);
    syncGroupConfigs(projectRoot);
    const configKeysPruned = reconcileConfigOverrides(projectRoot).flatMap((file) => file.removed);

    mkdirSync(dirname(join(projectRoot, PATHS.FRAMEWORK_VERSION)), { recursive: true });
    writeFrameworkVersionPreservingTimestamp(
      join(projectRoot, PATHS.FRAMEWORK_VERSION),
      VERSION,
      new Date().toISOString(),
    );

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
