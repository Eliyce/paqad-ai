import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from './constants/paths.js';
import { FRAMEWORK_CONFIG_SPECS } from './framework-config.js';
import { readTeamConfig, readTeamYamlFile, teamConfigPath } from './team-config.js';
import {
  legacyFilesWithSettings,
  legacyNoLongerReadLine,
  legacyTeamConfigReadable,
  teamConfigMigrated,
} from './team-config-legacy.js';
import { STRUCTURED_TEAM_SETTINGS } from './team-config-schema.js';
import { retiredPathsFor } from './team-config-retired.js';
import { TEAM_CONFIG_FILES, type OwnTeamConfigFile } from './team-config-values.js';

export function missingTeamFileLine(file: string): string {
  return `.paqad/configs/${file} is missing. Run paqad-ai update to create it.`;
}

export function missingTeamConfigFiles(projectRoot: string): string[] {
  if (!existsSync(join(projectRoot, PATHS.PROJECT_CONFIGS_DIR))) return [];
  if (!teamConfigMigrated(projectRoot)) return [];
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

export function unknownSettingLine(file: string, path: string): string {
  return `${file} has a setting paqad doesn't know: ${path}. It may be from a newer paqad or a typo.`;
}

function knownPaths(file: OwnTeamConfigFile): { leaves: Set<string>; branches: Set<string> } {
  const leaves = new Set<string>(['paqad_version', 'schema_version', ...retiredPathsFor(file)]);
  for (const spec of FRAMEWORK_CONFIG_SPECS) {
    if (spec.file === file) leaves.add(spec.path.join('.'));
  }
  for (const setting of STRUCTURED_TEAM_SETTINGS) {
    if (setting.file === file) leaves.add(setting.path.join('.'));
  }
  const branches = new Set<string>();
  for (const leaf of leaves) {
    const segments = leaf.split('.');
    for (let i = 1; i < segments.length; i += 1) branches.add(segments.slice(0, i).join('.'));
  }
  return { leaves, branches };
}

function collectUnknown(
  node: unknown,
  prefix: string[],
  known: { leaves: Set<string>; branches: Set<string> },
  out: string[],
): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = [...prefix, key].join('.');
    if (known.leaves.has(path)) continue;
    if (known.branches.has(path)) {
      collectUnknown(value, [...prefix, key], known, out);
      continue;
    }
    out.push(path);
  }
}

export function unknownTeamConfigSettings(
  projectRoot: string,
): Array<{ file: OwnTeamConfigFile; path: string }> {
  const found: Array<{ file: OwnTeamConfigFile; path: string }> = [];
  for (const file of TEAM_CONFIG_FILES) {
    const { document } = readTeamYamlFile(projectRoot, file);
    if (document === null) continue;
    const paths: string[] = [];
    collectUnknown(document.toJS(), [], knownPaths(file), paths);
    for (const path of paths) found.push({ file, path });
  }
  return found;
}
