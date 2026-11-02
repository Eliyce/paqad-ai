import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from './constants/paths.js';
import { parseDotConfig, type ConfigGroup } from './framework-config.js';

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
