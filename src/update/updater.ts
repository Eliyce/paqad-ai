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
import { compileFailureReason, ensureCompiledRulesCurrent } from '@/context/rule-context.js';
import { PATHS } from '@/core/constants/paths.js';
import {
  reconcileConfigOverrides,
  resolveTeamBootstrapEnabled,
  writeConfigExample,
  writeConfigsReadme,
} from '@/core/framework-config.js';
import { syncTeamConfigFiles, teamConfigPath } from '@/core/team-config.js';
import { RETIRED_SAFETY_FILE } from '@/core/team-config-retired.js';
import { TEAM_CONFIG_FILES } from '@/core/team-config-values.js';
import { migrateTeamConfig } from '@/core/team-config-migrate.js';
import { toPosixPath } from '@/core/path-utils.js';
import { getProfileDomain, readProjectProfile } from '@/core/project-profile.js';
import { checkAndMigrateSchema } from '@/core/schema-version.js';
import { versionAtLeast } from '@/core/version-compare.js';
import { getLegacyCapabilities, getPrimaryStack } from '@/core/stack-profile.js';
import { runPendingEvidenceMigration } from '@/feature-evidence/migrate.js';
import { migrateDeliveryPolicy, OLD_DELIVERY_POLICY } from '@/git-workflow/migrate.js';
import { gitWorkflowFilePath } from '@/git-workflow/load.js';
import { syncGitWorkflow } from '@/git-workflow/sync.js';
import { GIT_WORKFLOW_FILES } from '@/git-workflow/types.js';
import { lastAppliedPath } from '@/git-workflow/last-applied.js';
import { installGitHooks, trackedWorkflowHookAdvice } from '@/feature-evidence/git-hooks.js';
import { isPluginInstalled, pluginLoadState } from '@/health/plugin-install.js';
import { projectWiresLiveNpmHooks } from '@/install/plugin-migration.js';
import { cleanupLegacyMcpFiles } from '@/mcp/cleanup.js';
import { LEGACY_MCP_OUTPUT_PATHS } from '@/mcp/config-manager.js';
import {
  cleanObsoleteWorkflowRules,
  KEPT_RULE_WITH_SHIPPED_LINES,
  OBSOLETE_WORKFLOW_RULES,
  repairKeptRuleLines,
} from '@/onboarding/obsolete-cleanup.js';
import { FEATURE_DEVELOPMENT_VIEW_RELATIVE } from '@/pipeline/feature-development-view.js';
import { dropRuleScriptMapSources, isRuleScriptMapCurrent } from '@/rule-scripts/compile.js';
import { LEGACY_VIEW_HASH, removeGeneratedFiles } from '@/update/generated-files-cleanup.js';
import { VERSION } from '@/index.js';
import { managedBlockIsNewer, writeManagedGitignoreBlock } from '@/onboarding/gitignore-writer.js';
import {
  readFrameworkVersion,
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

const REMOVED_WORKFLOW_FILES: readonly string[] = [
  OLD_DELIVERY_POLICY,
  FEATURE_DEVELOPMENT_VIEW_RELATIVE,
];

const TRACKED_UPDATE_FILES: readonly string[] = [
  PATHS.ONBOARDING_MANIFEST,
  PATHS.PROJECT_CONFIG_EXAMPLE,
  '.paqad/.gitignore',
  '.paqad/.gitattributes',
  '.worktreeinclude',
  PATHS.RULE_SCRIPT_MAP,
  PATHS.CAPABILITY_LOCK,
  PATHS.SCHEMA_MARKER,
  LEGACY_VIEW_HASH,
  ...new Set(Object.values(LEGACY_MCP_OUTPUT_PATHS)),
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
    const filesBefore = snapshotFiles(projectRoot);
    await checkAndMigrateSchema(projectRoot, VERSION);
    runPendingEvidenceMigration(projectRoot);

    const previousVersion = readText(join(projectRoot, PATHS.FRAMEWORK_VERSION));
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
    const ruleRepair = repairKeptRuleLines(
      projectRoot,
      candidates.find((candidate) => toPosixPath(candidate.path) === KEPT_RULE_WITH_SHIPPED_LINES)
        ?.content ?? null,
      REMOVED_WORKFLOW_FILES.filter((path) => !existsSync(join(projectRoot, path))),
    );
    gitWorkflowNotes.push(...ruleRepair.lines);
    refreshSkippedEntries(projectRoot, skipped, ruleRepair.repaired);
    if (ruleCleanup.removed.length > 0 || ruleRepair.repaired.length > 0) {
      try {
        dropRuleScriptMapSources(projectRoot, ruleCleanup.removed, mapWasCurrent, ruleRepair.texts);
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
    syncTeamConfigFiles(projectRoot, teamConfigProblems);
    gitWorkflowNotes.push(...teamConfigProblems);
    const changedTeam = changedTeamFiles(projectRoot, filesBefore);
    if (changedTeam.length > 0) gitWorkflowNotes.push(commitLine(projectRoot, changedTeam));
    const configKeysPruned = reconcileConfigOverrides(projectRoot).flatMap((file) => file.removed);

    try {
      writeStageAgents({ pluginInstalled: pluginLoadState(null) === 'live' });
    } catch {}

    const teamSetup = usesClaude ? claude.syncTeamSetup(projectRoot) : null;

    mkdirSync(dirname(join(projectRoot, PATHS.FRAMEWORK_VERSION)), { recursive: true });
    const versionPath = join(projectRoot, PATHS.FRAMEWORK_VERSION);
    const recorded = readFrameworkVersion(versionPath);
    if (recorded === null || versionAtLeast(VERSION, recorded)) {
      writeFrameworkVersionPreservingTimestamp(versionPath, VERSION, new Date().toISOString());
    }
    if (!managedBlockIsNewer(projectRoot)) {
      writeManagedGitignoreBlock(projectRoot);
    }
    writeWorktreeInclude(projectRoot);
    const compileFailure = await ensureCompiledRulesCurrent(projectRoot);
    if (compileFailure !== null) {
      gitWorkflowNotes.push(
        `Couldn't refresh ${PATHS.COMPILED_RULES}: ${compileFailureReason(compileFailure)}. Doctor will flag it. Run paqad-ai rag refresh-context to try again.`,
      );
    }

    return {
      previous_version: previousVersion,
      target_version: VERSION,
      regenerated,
      changed_files: [
        ...new Set([
          ...filesChangedSince(projectRoot, filesBefore),
          ...ruleRepair.repaired,
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

function refreshSkippedEntries(
  projectRoot: string,
  skipped: UpdateDiff[],
  repaired: readonly string[],
): void {
  for (const path of repaired) {
    const index = skipped.findIndex((entry) => entry.path === path);
    if (index < 0) continue;
    const entry = skipped[index]!;
    const before = readFileSync(join(projectRoot, path), 'utf8');
    if (before === entry.after) skipped.splice(index, 1);
    else skipped[index] = { ...entry, before };
  }
}

function changedTeamFiles(projectRoot: string, before: Map<string, string | null>): string[] {
  const teamFiles = [
    ...TEAM_CONFIG_FILES.map((file) =>
      toTeamRelative(projectRoot, teamConfigPath(projectRoot, file)),
    ),
    `${PATHS.PROJECT_CONFIGS_DIR}/${RETIRED_SAFETY_FILE}`,
    ...GIT_WORKFLOW_FILES.map((file) =>
      toTeamRelative(projectRoot, gitWorkflowFilePath(projectRoot, file)),
    ),
  ];
  return teamFiles.filter(
    (path) => (before.get(path) ?? null) !== snapshotText(join(projectRoot, path)),
  );
}

function toTeamRelative(projectRoot: string, path: string): string {
  return toPosixPath(relative(projectRoot, path));
}

function commitLine(projectRoot: string, files: readonly string[]): string {
  const record = toTeamRelative(projectRoot, lastAppliedPath(projectRoot));
  return `Commit ${[...files, record].join(', ')} together so your teammates don't repeat this change. This happens once. Everyone needs this version or newer, including the plugin inside sessions.`;
}

function updateGitWorkflow(projectRoot: string): string[] {
  const profile = readProfile(projectRoot);
  if (profile === null || getProfileDomain(profile) !== 'coding') return [];
  const migration = migrateDeliveryPolicy(projectRoot);
  const syncNotes: string[] = [];
  syncGitWorkflow(projectRoot, { notes: syncNotes });
  migration.lines.push(...syncNotes.filter((note) => !migration.lines.includes(note)));
  try {
    installGitHooks(projectRoot);
    const advice = trackedWorkflowHookAdvice(projectRoot);
    if (advice !== null) migration.lines.push(advice);
  } catch (error) {
    migration.lines.push(
      `Couldn't check the git hooks: ${error instanceof Error ? error.message : 'unknown error'}.`,
    );
  }
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
