import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveTeamBootstrapEnabled } from '@/core/framework-config.js';
import { PLUGIN_ID } from '@/health/plugin-install.js';
import { gitPendingPaths, isGitTracked } from '@/core/fs/git-tracked.js';
import { getRuntimeTemplatesRoot } from '@/core/runtime-paths.js';
import { versionAtLeast } from '@/core/version-compare.js';
import { renderStageAgentFiles } from '@/stage-isolation/agent-writer.js';

import { CLAUDE_SETTINGS_FILE, TEAM_LAUNCHER_MARK } from './team-settings.js';

declare const __PKG_VERSION__: string;

export const TEAM_LAUNCHER_PATH = '.paqad/hook.mjs';
export const LAUNCHER_VERSION_TOKEN = '__PAQAD_VERSION__';
export const TEAM_AGENTS_DIR = '.claude/agents';

const LAUNCHER_STAMP = /PAQAD_LAUNCHER_VERSION = '([^']+)'/;
const AGENT_STAMP = /<!-- written by paqad-ai ([^ ]+) -->/;

export interface TeamSetupReport {
  enabled: boolean;
  written: string[];
  removed: string[];
  kept: string[];
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
  if (!template.includes(LAUNCHER_VERSION_TOKEN)) {
    throw new Error('the team launcher template has no version token');
  }
  return template.replace(LAUNCHER_VERSION_TOKEN, version);
}

export function renderTeamAgents(
  version: string = __PKG_VERSION__,
): { path: string; content: string }[] {
  return renderStageAgentFiles('claude-code').map(({ name, content }) => ({
    path: `${TEAM_AGENTS_DIR}/${name}`,
    content: `${content}\n<!-- written by paqad-ai ${version} -->\n`,
  }));
}

export function teamOwnedFiles(version: string = __PKG_VERSION__): OwnedFile[] {
  return [
    { path: TEAM_LAUNCHER_PATH, content: renderTeamLauncher(version), stamp: LAUNCHER_STAMP },
    ...renderTeamAgents(version).map((agent) => ({ ...agent, stamp: AGENT_STAMP })),
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
  return [CLAUDE_SETTINGS_FILE, CLAUDE_GITIGNORE_FILE, TEAM_LAUNCHER_PATH, TEAM_AGENTS_DIR];
}

function isTeamPath(path: string): boolean {
  return (
    path === CLAUDE_SETTINGS_FILE ||
    path === CLAUDE_GITIGNORE_FILE ||
    path === TEAM_LAUNCHER_PATH ||
    path.startsWith(`${TEAM_AGENTS_DIR}/paqad-`)
  );
}

export function teamFilesToCommit(projectRoot: string, report: TeamSetupReport): string[] {
  if (!report.enabled) return [];
  const pending = gitPendingPaths(projectRoot, teamTrackedPaths());
  if (pending === null) return [...report.written].sort();
  return pending.filter(isTeamPath);
}

function collapseAgents(paths: string[]): string[] {
  const agentPrefix = `${TEAM_AGENTS_DIR}/paqad-`;
  const others = paths.filter((path) => !path.startsWith(agentPrefix));
  return others.length === paths.length ? others : [...others, `${agentPrefix}*.md`];
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
  const toCommit = collapseAgents(teamFilesToCommit(projectRoot, report));
  if (toCommit.length > 0) {
    notes.push(
      `Commit these team setup files together so teammates and cloud sessions get paqad: ${toCommit.join(', ')}.`,
    );
  }
  if (report.kept.length > 0) {
    notes.push(
      `Left alone because they were edited by hand or written by a newer paqad: ${report.kept.join(', ')}.`,
    );
  }
  return notes;
}
