import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveTeamBootstrapEnabled } from '@/core/framework-config.js';
import { gitPendingPaths } from '@/core/fs/git-tracked.js';
import { getRuntimeTemplatesRoot } from '@/core/runtime-paths.js';
import { versionAtLeast } from '@/core/version-compare.js';

declare const __PKG_VERSION__: string;

export const TEAM_LAUNCHER_PATH = '.paqad/hook.mjs';
export const LAUNCHER_VERSION_TOKEN = '__PAQAD_VERSION__';

const LAUNCHER_STAMP = /PAQAD_LAUNCHER_VERSION = '([^']+)'/;

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
  return report;
}

export function teamSetupMissing(projectRoot: string): boolean {
  return teamOwnedFiles().some((file) => readIfPresent(join(projectRoot, file.path)) === null);
}

export function teamTrackedPaths(): string[] {
  return [TEAM_LAUNCHER_PATH];
}

function isTeamPath(path: string): boolean {
  return teamTrackedPaths().includes(path);
}

export function teamFilesToCommit(projectRoot: string, report: TeamSetupReport): string[] {
  if (!report.enabled) return [];
  const pending = gitPendingPaths(projectRoot, teamTrackedPaths());
  if (pending === null) return [...report.written].sort();
  return pending.filter(isTeamPath);
}

export function teamSetupNotes(projectRoot: string, report: TeamSetupReport): string[] {
  const notes: string[] = [];
  const toCommit = teamFilesToCommit(projectRoot, report);
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
