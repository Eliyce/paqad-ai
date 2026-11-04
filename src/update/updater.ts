import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { deriveRecordedProviders } from '@/adapters/recorded-providers.js';
import { PATHS } from '@/core/constants/paths.js';
import {
  checkoutIsNewer,
  reconcileConfigOverrides,
  resolveTeamBootstrapEnabled,
  writeConfigExample,
  writeConfigsReadme,
} from '@/core/framework-config.js';
import {
  isRemovedWorkflowEntryNote,
  syncTeamConfigFiles,
  teamConfigPath,
  WORKFLOW_TEAM_FILE,
} from '@/core/team-config.js';
import { migrateTeamConfig } from '@/core/team-config-migrate.js';
import { toPosixPath } from '@/core/path-utils.js';
import { getProfileDomain, readProjectProfile } from '@/core/project-profile.js';
import { checkAndMigrateSchema } from '@/core/schema-version.js';
import { getLegacyCapabilities, getPrimaryStack } from '@/core/stack-profile.js';
import { runPendingEvidenceMigration } from '@/feature-evidence/migrate.js';
import { migrateDeliveryPolicy, OLD_DELIVERY_POLICY } from '@/git-workflow/migrate.js';
import { syncGitWorkflow } from '@/git-workflow/sync.js';
import { installGitHooks } from '@/feature-evidence/git-hooks.js';
import { isPluginInstalled, pluginLoadState } from '@/health/plugin-install.js';
import { projectWiresLiveNpmHooks } from '@/install/plugin-migration.js';
import { cleanupLegacyMcpFiles } from '@/mcp/cleanup.js';
import {
  cleanObsoleteWorkflowRules,
  OBSOLETE_WORKFLOW_RULES,
} from '@/onboarding/obsolete-cleanup.js';
import { FEATURE_DEVELOPMENT_VIEW_RELATIVE } from '@/pipeline/feature-development-view.js';
import { dropRuleScriptMapSources, isRuleScriptMapCurrent } from '@/rule-scripts/compile.js';
import { removeGeneratedFiles } from '@/update/generated-files-cleanup.js';
import { VERSION } from '@/index.js';
import { writeManagedGitignoreBlock } from '@/onboarding/gitignore-writer.js';
import {
  writeFrameworkVersionPreservingTimestamp,
  writeOnboardingManifest,
} from '@/onboarding/manifest-writer.js';
import { OnboardingOrchestrator } from '@/onboarding/orchestrator.js';
import { writeWorktreeInclude } from '@/onboarding/worktree-include-writer.js';
import { writeStageAgents } from '@/stage-isolation/agent-writer.js';
import type { AdapterType } from '@/core/types/adapter.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

const CLAUDE_HOOK_ARTIFACTS = new Set([
  '.claude/settings.json',
  '.claude/settings.hooks.json',
  '.claude/settings.local.json',
]);
const CLAUDE_TEAM_HOOK_ARTIFACTS = new Set(['.claude/settings.hooks.json']);
const CLAUDE_HOST_FILES = new Set([
  '.claude/.gitignore',
  '.claude/settings.json',
  '.claude/settings.local.json',
]);

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
  changed_files?: string[];
  skipped: UpdateDiff[];
  deprecated: string[];
  new_mcp_servers: string[];
  new_scripts: string[];
  config_keys_pruned: string[];
  team_setup_notes?: string[];
  git_workflow_notes?: string[];
}

export interface FrameworkUpdaterOptions {
  generateCandidates?: (projectRoot: string) => Promise<UpdateCandidate[]>;
}

const RETIRED_FILES: readonly string[] = [
  ...OBSOLETE_WORKFLOW_RULES.map((rule) => `${PATHS.RULES_DIR}/${rule.path}`),
  OLD_DELIVERY_POLICY,
  FEATURE_DEVELOPMENT_VIEW_RELATIVE,
];

export function withoutRemovedRetiredFiles<T extends { path: string }>(
  artifacts: readonly T[],
  fileExists: (path: string) => boolean,
): T[] {
  return artifacts.filter(
    (artifact) => !RETIRED_FILES.includes(toPosixPath(artifact.path)) || fileExists(artifact.path),
  );
}

const TRACKED_UPDATE_FILES: readonly string[] = [
  PATHS.ONBOARDING_MANIFEST,
  PATHS.PROJECT_CONFIG_EXAMPLE,
  '.paqad/.gitignore',
  '.paqad/.gitattributes',
  '.worktreeinclude',
  ...RETIRED_FILES,
];

function snapshotText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function filesUnder(projectRoot: string, relativeDir: string): string[] {
  let entries;
  try {
    entries = readdirSync(join(projectRoot, relativeDir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = `${relativeDir}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(projectRoot, path) : [path];
  });
}

function trackedUpdatePaths(projectRoot: string): string[] {
  return [...TRACKED_UPDATE_FILES, ...filesUnder(projectRoot, PATHS.PROJECT_CONFIGS_DIR)];
}

function snapshotFiles(projectRoot: string): Map<string, string | null> {
  return new Map(
    trackedUpdatePaths(projectRoot).map((path) => [path, snapshotText(join(projectRoot, path))]),
  );
}

function filesChangedSince(projectRoot: string, before: Map<string, string | null>): string[] {
  const paths = new Set([...before.keys(), ...trackedUpdatePaths(projectRoot)]);
  return [...paths]
    .filter((path) => (before.get(path) ?? null) !== snapshotText(join(projectRoot, path)))
    .sort();
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
    const filesBefore = snapshotFiles(projectRoot);
    const manifest = readManifest(projectRoot);
    const artifactPolicy = new Map(
      manifest?.generated_artifacts.map((artifact) => [artifact.path, artifact.auto_update]) ?? [],
    );
    const providers: AdapterType[] = manifest ? deriveRecordedProviders(manifest) : ['claude-code'];
    const gitWorkflowDir = `${PATHS.GIT_WORKFLOW_DIR}/`;
    const generated = (await this.getCandidates(projectRoot, providers)).filter(
      (candidate) => !toPosixPath(candidate.path).startsWith(gitWorkflowDir),
    );
    const usesClaude = generated.some((candidate) => toPosixPath(candidate.path) === 'CLAUDE.md');
    const claude = new ClaudeCodeAdapter();
    const candidates = usesClaude
      ? [
          ...generated.filter((candidate) => !CLAUDE_HOST_FILES.has(toPosixPath(candidate.path))),
          ...claude.hostSettingsFiles(projectRoot),
        ]
      : generated;
    const regenerated: string[] = [];
    const skipped: UpdateDiff[] = [];
    const newScripts: string[] = [];

    const pluginInstalled = isPluginInstalled();
    const pluginOwnsClaudeHooks = pluginInstalled && !projectWiresLiveNpmHooks(projectRoot);
    const pluginSkips = resolveTeamBootstrapEnabled(projectRoot)
      ? CLAUDE_TEAM_HOOK_ARTIFACTS
      : CLAUDE_HOOK_ARTIFACTS;

    for (const candidate of candidates) {
      const reportedPath = toPosixPath(candidate.path);
      const target = join(projectRoot, candidate.path);
      if (pluginOwnsClaudeHooks && pluginSkips.has(reportedPath)) {
        continue;
      }
      const existing = readExistingText(target);
      const existed = existing !== null;
      const autoUpdate = artifactPolicy.get(candidate.path) ?? candidate.autoUpdate;

      if (existing === candidate.content) {
        if (candidate.executable === true && autoUpdate !== false) {
          chmodSync(target, 0o755);
        }
        continue;
      }

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

    if (manifest) {
      writeOnboardingManifest(projectRoot, { ...manifest, providers });
    }

    cleanupLegacyMcpFiles(projectRoot);

    writeConfigsReadme(projectRoot);
    writeConfigExample(projectRoot);
    const gitWorkflowNotes = updateGitWorkflow(projectRoot);
    const teamConfigMigration = migrateTeamConfig(projectRoot);
    if (teamConfigMigration.ran) gitWorkflowNotes.push(...teamConfigMigration.lines);
    gitWorkflowNotes.push(...removeGeneratedFiles(projectRoot));
    const mapWasCurrent = isRuleScriptMapCurrent(projectRoot);
    const ruleCleanup = cleanObsoleteWorkflowRules(projectRoot);
    gitWorkflowNotes.push(...ruleCleanup.lines);
    if (ruleCleanup.removed.length > 0) {
      try {
        dropRuleScriptMapSources(projectRoot, ruleCleanup.removed, mapWasCurrent);
      } catch (error) {
        gitWorkflowNotes.push(
          `Couldn't drop the removed rule files from the rule-script map: ${error instanceof Error ? error.message : 'unknown error'}.`,
        );
      }
    }
    if (manifest) {
      const artifacts = withoutRemovedRetiredFiles(manifest.generated_artifacts, (path) =>
        existsSync(join(projectRoot, path)),
      );
      if (artifacts.length !== manifest.generated_artifacts.length) {
        writeOnboardingManifest(projectRoot, {
          ...manifest,
          providers,
          generated_artifacts: artifacts,
        });
      }
    }
    const teamConfigProblems: string[] = [];
    const rewritten = syncTeamConfigFiles(projectRoot, teamConfigProblems);
    gitWorkflowNotes.push(...teamConfigProblems);
    for (const path of rewritten) {
      gitWorkflowNotes.push(
        `Rewrote ${toPosixPath(relative(projectRoot, path))}: it lists every setting, and your own values and notes are kept.`,
      );
    }
    if (teamConfigProblems.some(isRemovedWorkflowEntryNote)) {
      gitWorkflowNotes.push(
        commitFileNote(
          toPosixPath(relative(projectRoot, teamConfigPath(projectRoot, WORKFLOW_TEAM_FILE))),
        ),
      );
    }
    const configKeysPruned = reconcileConfigOverrides(projectRoot).flatMap((file) => file.removed);

    try {
      writeStageAgents({ pluginInstalled: pluginLoadState(null) === 'live' });
    } catch {}

    const teamSetup = usesClaude ? claude.syncTeamSetup(projectRoot) : null;

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
      changed_files: [
        ...new Set([
          ...filesChangedSince(projectRoot, filesBefore),
          ...(teamSetup?.report.written ?? []),
          ...(teamSetup?.report.removed ?? []),
        ]),
      ],
      skipped,
      deprecated: [],
      new_mcp_servers: [],
      new_scripts: newScripts.sort(),
      config_keys_pruned: configKeysPruned,
      team_setup_notes: teamSetup?.notes ?? [],
      git_workflow_notes: gitWorkflowNotes,
    };
  }

  private async getCandidates(
    projectRoot: string,
    providers: AdapterType[],
  ): Promise<UpdateCandidate[]> {
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
        interactive: false,
        selections: {
          providers,
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

function commitFileNote(path: string): string {
  return `Commit ${path} so your teammates don't repeat this change locally.`;
}

function updateGitWorkflow(projectRoot: string): string[] {
  const profile = readProfile(projectRoot);
  if (profile === null || getProfileDomain(profile) !== 'coding') return [];
  const migration = migrateDeliveryPolicy(projectRoot);
  syncGitWorkflow(projectRoot);
  try {
    installGitHooks(projectRoot);
  } catch {}
  return migration.lines;
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
