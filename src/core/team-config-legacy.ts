import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from './constants/paths.js';
import {
  LEGACY_TEAM_CONFIG_READ_UNTIL,
  parseDotConfig,
  type ConfigGroup,
} from './framework-config.js';

declare const __PKG_RELEASE_DATE__: string;

export interface TeamConfigClock {
  today: () => string;
  releaseDate: () => string;
}

const SYSTEM_CLOCK: TeamConfigClock = {
  today: () => new Date().toISOString().slice(0, 10),
  releaseDate: () => __PKG_RELEASE_DATE__,
};

let clock: TeamConfigClock = SYSTEM_CLOCK;

export function setTeamConfigClock(next: Partial<TeamConfigClock> | null): void {
  clock = next === null ? SYSTEM_CLOCK : { ...SYSTEM_CLOCK, ...next };
}

export function legacyTeamConfigReadable(): boolean {
  return clock.today() <= LEGACY_TEAM_CONFIG_READ_UNTIL;
}

export function releasedAfterLegacyWindow(): boolean {
  return clock.releaseDate() > LEGACY_TEAM_CONFIG_READ_UNTIL;
}

export function legacyStillLine(key: string, oldFile: string): string {
  return `${key} is still in .paqad/configs/${oldFile}. Run paqad-ai config migrate to move it.`;
}

export function legacyBothLine(key: string, oldFile: string, yamlFile: string): string {
  return `${key} is set in both .paqad/configs/${oldFile} and ${yamlFile}; paqad uses the YAML value. Run paqad-ai config migrate to clean up.`;
}

export function legacyNoLongerReadLine(oldFile: string): string {
  return `Old settings in .paqad/configs/${oldFile} are no longer read. Run paqad-ai config migrate to move them.`;
}

export function legacyShouldMoveLine(oldFile: string): string {
  return `Old settings in .paqad/configs/${oldFile} should be moved. Run paqad-ai config migrate.`;
}

export const CONFIG_GROUP_FILES: Record<ConfigGroup, string> = {
  app: '.config.app',
  rag: '.config.rag',
  models: '.config.models',
  policy: '.config.policy',
};

export const MIGRATED_STUB_MARKER = '# paqad-migrated-stub';

export interface LegacyCollision {
  key: string;
  files: string[];
}

export interface LegacyTeamConfig {
  merged: Map<string, string>;
  collisions: LegacyCollision[];
  sources: Map<string, string>;
}

export function listConfigsFiles(projectRoot: string): string[] {
  const dir = join(projectRoot, PATHS.PROJECT_CONFIGS_DIR);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^\.config\..+/u.test(name) && name !== '.config.example')
    .sort()
    .map((name) => join(dir, name));
}

export function isMigratedStub(text: string): boolean {
  return text.split(/\r?\n/u, 1)[0]?.trim() === MIGRATED_STUB_MARKER;
}

export function legacyFilesWithSettings(projectRoot: string): string[] {
  const names: string[] = [];
  for (const file of listConfigsFiles(projectRoot)) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!isMigratedStub(text) && parseDotConfig(text).size > 0) {
      names.push(file.split(/[\\/]/u).pop()!);
    }
  }
  return names;
}

export function readLegacyTeamConfig(projectRoot: string): LegacyTeamConfig {
  const merged = new Map<string, string>();
  const seenIn = new Map<string, string[]>();
  for (const file of listConfigsFiles(projectRoot)) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (isMigratedStub(text)) continue;
    for (const [key, value] of parseDotConfig(text)) {
      merged.set(key, value);
      seenIn.set(key, [...(seenIn.get(key) ?? []), file]);
    }
  }
  const collisions: LegacyCollision[] = [];
  const sources = new Map<string, string>();
  for (const [key, files] of seenIn) {
    sources.set(key, files[files.length - 1]!);
    if (files.length > 1) collisions.push({ key, files });
  }
  return { merged, collisions, sources };
}
