import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveTeamBootstrapEnabled } from '@/core/framework-config.js';
import { PLUGIN_ID } from '@/health/plugin-install.js';
import { gitPendingPaths, isGitTracked } from '@/core/fs/git-tracked.js';
import { getRuntimeTemplatesRoot } from '@/core/runtime-paths.js';
import { versionAtLeast } from '@/core/version-compare.js';
import { migrateProjectStageAgents } from '@/onboarding/stage-agent-migration.js';

import { CLAUDE_SETTINGS_FILE, TEAM_LAUNCHER_MARK } from './team-settings.js';

declare const __PKG_VERSION__: string;

export const TEAM_LAUNCHER_PATH = '.paqad/hook.mjs';
export const LAUNCHER_VERSION_TOKEN = '__PAQAD_VERSION__';

const LAUNCHER_STAMP = /PAQAD_LAUNCHER_VERSION = '([^']+)'/;

export interface TeamSetupReport {
  enabled: boolean;
  written: string[];
  removed: string[];
  kept: string[];
  handEditedAgents?: string[];
}

interface OwnedFile {
  path: string;
  content: string;
  stamp: RegExp;
}

export function renderTeamLauncher(version: string = __PKG_VERSION__): string {
  const template = readFileSync(
    join(getRuntimeTemplatesRoot(), 'team-bootstrap', 'hook.mjs'),
    'utf8',
  );
  return template.replace(LAUNCHER_VERSION_TOKEN, version);
}

export function teamOwnedFiles(version: string = __PKG_VERSION__): OwnedFile[] {
  return [
    { path: TEAM_LAUNCHER_PATH, content: renderTeamLauncher(version), stamp: LAUNCHER_STAMP },
  ];
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function isNewerStamp(existing: string, stamp: RegExp, version: string): boolean {
  const found = stamp.exec(existing)?.[1];
  return found !== undefined && !versionAtLeast(version, found);
}

function syncOwnedFile(
  projectRoot: string,
  file: OwnedFile,
  enabled: boolean,
  version: string,
  report: TeamSetupReport,
): void {
  const target = join(projectRoot, file.path);
  const existing = readIfPresent(target);
  if (!enabled) {
    if (existing === null) return;
    if (existing === file.content) {
      rmSync(target, { force: true });
      report.removed.push(file.path);
    } else {
      report.kept.push(file.path);
    }
    return;
  }
  if (existing === file.content) return;
  if (existing !== null && isNewerStamp(existing, file.stamp, version)) {
    report.kept.push(file.path);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content, 'utf8');
  report.written.push(file.path);
}

export function syncTeamSetup(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  version: string = __PKG_VERSION__,
): TeamSetupReport {
  const enabled = resolveTeamBootstrapEnabled(projectRoot, env);
  const report: TeamSetupReport = { enabled, written: [], removed: [], kept: [] };
  for (const file of teamOwnedFiles(version)) {
    syncOwnedFile(projectRoot, file, enabled, version, report);
  }
  const agents = migrateProjectStageAgents(projectRoot);
  report.removed.push(...agents.removed);
  report.kept.push(...agents.kept);
  report.handEditedAgents = agents.kept;
  return report;
}

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
  return raw.includes(TEAM_LAUNCHER_MARK) && enabled?.[PLUGIN_ID] !== undefined;
}

export function teamSetupMissing(projectRoot: string): boolean {
  return (
    !settingsCarryTeamSetup(projectRoot) ||
    teamOwnedFiles().some((file) => readIfPresent(join(projectRoot, file.path)) === null)
  );
}

export function teamTrackedPaths(): string[] {
  return [CLAUDE_SETTINGS_FILE, CLAUDE_GITIGNORE_FILE, TEAM_LAUNCHER_PATH];
}

function isTeamPath(path: string): boolean {
  return (
    path === CLAUDE_SETTINGS_FILE || path === CLAUDE_GITIGNORE_FILE || path === TEAM_LAUNCHER_PATH
  );
}

export function teamFilesToCommit(projectRoot: string, report: TeamSetupReport): string[] {
  if (!report.enabled) return [];
  const pending = gitPendingPaths(projectRoot, teamTrackedPaths());
  if (pending === null) return [...report.written].sort();
  return pending.filter(isTeamPath);
}

export const SHARED_SETTINGS_NOTE =
  '`.claude/settings.json` is now shared with your team, so review and commit it; anything personal it held now lives in the git-ignored `.claude/settings.local.json`.';

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
    notes.push(
      `Commit these team setup files together so teammates and cloud sessions get paqad: ${toCommit.join(', ')}.`,
    );
  }
  const handEdited = new Set(report.handEditedAgents ?? []);
  const removedAgents = report.removed.filter((path) => path.startsWith('.claude/agents/'));
  if (removedAgents.length > 0) {
    notes.push(
      `Removed the old paqad stage agents from .claude/agents, because the paqad plugin now provides them: ${removedAgents.join(', ')}.`,
    );
  }
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
