import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from './constants/paths.js';
import { readTeamConfig, teamConfigPath } from './team-config.js';
import {
  CONFIG_GROUP_FILES,
  isMigratedStub,
  legacyFilesWithSettings,
  legacyNoLongerReadLine,
  legacyTeamConfigReadable,
} from './team-config-legacy.js';
import { TEAM_CONFIG_FILES } from './team-config-values.js';

export function missingTeamFileLine(file: string): string {
  return `.paqad/configs/${file} is missing. Run paqad-ai update to create it.`;
}

function isMigrated(projectRoot: string): boolean {
  const app = join(projectRoot, PATHS.PROJECT_CONFIGS_DIR, CONFIG_GROUP_FILES.app);
  if (!existsSync(app)) return legacyFilesWithSettings(projectRoot).length === 0;
  try {
    return isMigratedStub(readFileSync(app, 'utf8'));
  } catch {
    return false;
  }
}

export function missingTeamConfigFiles(projectRoot: string): string[] {
  if (!existsSync(join(projectRoot, PATHS.PROJECT_CONFIGS_DIR))) return [];
  if (!isMigrated(projectRoot)) return [];
  return TEAM_CONFIG_FILES.filter((file) => !existsSync(teamConfigPath(projectRoot, file)));
}

export function legacyAfterWindowLines(projectRoot: string): string[] {
  if (legacyTeamConfigReadable()) return [];
  return legacyFilesWithSettings(projectRoot).map(legacyNoLongerReadLine);
}

export function teamConfigSessionLines(projectRoot: string): string[] {
  if (!existsSync(join(projectRoot, PATHS.PROJECT_CONFIGS_DIR))) return [];
  return [
    ...readTeamConfig(projectRoot).issues.map((issue) => issue.message),
    ...legacyAfterWindowLines(projectRoot),
    ...missingTeamConfigFiles(projectRoot).map(missingTeamFileLine),
  ];
}

export function teamConfigSessionStartText(projectRoot: string): string | null {
  let lines: string[];
  try {
    lines = teamConfigSessionLines(projectRoot);
  } catch {
    return null;
  }
  if (lines.length === 0) return null;
  return ['paqad team settings:', ...lines.map((line) => `- ${line}`)].join('\n');
}
