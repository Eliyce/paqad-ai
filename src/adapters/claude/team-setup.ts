import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveTeamBootstrapEnabled,
  teamSetsInstallModeSettings,
} from '@/core/framework-config.js';
import { PLUGIN_ID } from '@/health/plugin-install.js';
import { gitPendingPaths, isGitTracked } from '@/core/fs/git-tracked.js';
import { PROJECT_AGENTS_DIR } from '@/onboarding/stage-agent-migration.js';
import { refreshProjectAgents } from '@/stage-isolation/project-refresh.js';
import { cloudSetupCommand, resolveUpdatePolicy, teamVersion } from '@/update/update-policy.js';
import {
  isCiEnvironment,
  isPaqadLauncher,
  TEAM_LAUNCHER_FILE,
} from '@/update/paqad-files-untrack.js';

import { CLAUDE_SETTINGS_FILE } from './team-settings.js';

export const TEAM_LAUNCHER_PATH = TEAM_LAUNCHER_FILE;

export interface TeamSetupReport {
  enabled: boolean;
  written: string[];
  removed: string[];
  kept: string[];
  handEditedAgents?: string[];
}

export interface TeamSetupOptions {
  removeLauncher?: boolean;
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function removeTeamLauncher(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  report: TeamSetupReport,
): void {
  if (isCiEnvironment(env)) return;
  const target = join(projectRoot, TEAM_LAUNCHER_PATH);
  const existing = readIfPresent(target);
  if (existing === null) return;
  if (!isPaqadLauncher(existing)) {
    report.kept.push(TEAM_LAUNCHER_PATH);
    return;
  }
  rmSync(target, { force: true });
  report.removed.push(TEAM_LAUNCHER_PATH);
}

export function syncTeamSetup(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  options: TeamSetupOptions = {},
): TeamSetupReport {
  const enabled = resolveTeamBootstrapEnabled(projectRoot, env);
  const report: TeamSetupReport = { enabled, written: [], removed: [], kept: [] };
  if (options.removeLauncher === true) removeTeamLauncher(projectRoot, env, report);
  const agents = refreshProjectAgents(projectRoot);
  report.written.push(...agents.written);
  report.kept.push(...agents.kept, ...agents.symlinks);
  report.handEditedAgents = [...agents.kept, ...agents.symlinks];
  return report;
}

export const PROJECT_AGENTS_GITIGNORE = `${PROJECT_AGENTS_DIR}/.gitignore`;

export const CLAUDE_GITIGNORE_FILE = '.claude/.gitignore';

function settingsCarryTeamSetup(projectRoot: string): boolean {
  const raw = readIfPresent(join(projectRoot, CLAUDE_SETTINGS_FILE));
  if (raw === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const enabled = (parsed as { enabledPlugins?: Record<string, unknown> } | null)?.enabledPlugins;
  return enabled?.[PLUGIN_ID] !== undefined || teamSetsInstallModeSettings(projectRoot);
}

export function teamSetupMissing(projectRoot: string): boolean {
  return !settingsCarryTeamSetup(projectRoot);
}

export function teamTrackedPaths(): string[] {
  return [
    CLAUDE_SETTINGS_FILE,
    CLAUDE_GITIGNORE_FILE,
    TEAM_LAUNCHER_PATH,
    PROJECT_AGENTS_GITIGNORE,
  ];
}

function isTeamPath(path: string): boolean {
  return (
    path === CLAUDE_SETTINGS_FILE ||
    path === CLAUDE_GITIGNORE_FILE ||
    path === TEAM_LAUNCHER_PATH ||
    path === PROJECT_AGENTS_GITIGNORE
  );
}

export function teamFilesToCommit(projectRoot: string, report: TeamSetupReport): string[] {
  if (!report.enabled) return [];
  const pending = gitPendingPaths(projectRoot, teamTrackedPaths());
  if (pending === null) return [...report.written].sort();
  const handEdited = new Set(report.handEditedAgents ?? []);
  return pending.filter((path) => isTeamPath(path) && !handEdited.has(path));
}

export const SHARED_SETTINGS_NOTE =
  '`.claude/settings.json` is now shared with your team, so review and commit it; anything personal it held now lives in the git-ignored `.claude/settings.local.json`.';

export function commitTeamFilesNote(paths: readonly string[]): string {
  return `Commit these team setup files together so teammates and cloud sessions get paqad: ${paths.join(', ')}.`;
}

export function cloudSetupNote(projectRoot: string, env: NodeJS.ProcessEnv = {}): string {
  const version = teamVersion(resolveUpdatePolicy(projectRoot, env));
  return `For Claude Code cloud sessions, add these environment setup commands: ${cloudSetupCommand(version)}`;
}

export function teamSetupNotes(projectRoot: string, report: TeamSetupReport): string[] {
  const notes: string[] = [];
  if (
    report.enabled &&
    readIfPresent(join(projectRoot, CLAUDE_SETTINGS_FILE)) !== null &&
    !isGitTracked(projectRoot, CLAUDE_SETTINGS_FILE)
  ) {
    notes.push(SHARED_SETTINGS_NOTE);
  }
  const toCommit = teamFilesToCommit(projectRoot, report);
  if (toCommit.length > 0) {
    notes.push(commitTeamFilesNote(toCommit));
    notes.push(cloudSetupNote(projectRoot));
  }
  const handEdited = new Set(report.handEditedAgents ?? []);
  if (handEdited.size > 0) {
    notes.push(
      `Kept these .claude/agents files because they do not match what paqad wrote; check them and delete any you no longer need: ${[...handEdited].join(', ')}.`,
    );
  }
  const keptOther = report.kept.filter((path) => !handEdited.has(path));
  if (keptOther.length > 0) {
    notes.push(
      `Left alone because they were edited by hand or written by a newer paqad: ${keptOther.join(', ')}.`,
    );
  }
  return notes;
}
