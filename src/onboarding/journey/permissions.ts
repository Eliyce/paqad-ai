import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { writeFileAtomic } from '@/hud/files.js';

import { readTextOrNull } from './io.js';

export const SETTINGS_LOCAL = '.claude/settings.local.json';

export interface AllowListEntries {
  allow: string[];
  deny: string[];
  ask: string[];
}

export function allowListEntries(installDir: string): AllowListEntries {
  const skills = join(installDir, 'runtime/base/skills');
  return {
    allow: [
      'Bash(paqad-ai:*)',
      `Bash(node ${skills}/:*)`,
      'Edit(docs/**)',
      'Write(docs/**)',
      'Edit(.paqad/**)',
      'Write(.paqad/**)',
    ],
    deny: [
      'Edit(.paqad/.config)',
      'Write(.paqad/.config)',
      'Edit(.paqad/configs/**)',
      'Write(.paqad/configs/**)',
      'Edit(.paqad/decisions/**)',
      'Write(.paqad/decisions/**)',
      'Edit(.paqad/scripts/rules/**)',
      'Write(.paqad/scripts/rules/**)',
      'Edit(.paqad/onboarding/journey.json)',
      'Write(.paqad/onboarding/journey.json)',
      'Edit(.paqad/onboarding/events.jsonl)',
      'Write(.paqad/onboarding/events.jsonl)',
      'Edit(.paqad/onboarding/view.json)',
      'Write(.paqad/onboarding/view.json)',
    ],
    ask: ['Bash(paqad-ai onboarding commit:*)'],
  };
}

function isGitIgnored(projectRoot: string, rel: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd: projectRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureIgnored(projectRoot: string): boolean {
  if (isGitIgnored(projectRoot, SETTINGS_LOCAL)) return false;
  const gitignore = join(projectRoot, '.gitignore');
  const current = readTextOrNull(gitignore) ?? '';
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  appendFileSync(gitignore, `${prefix}${SETTINGS_LOCAL}\n`, 'utf8');
  return true;
}

type Settings = { permissions?: Partial<Record<keyof AllowListEntries, string[]>> } & Record<
  string,
  unknown
>;

export interface AllowListResult {
  added: AllowListEntries;
  ignore_line_added: boolean;
  path: string;
}

export function writeAllowList(projectRoot: string, installDir: string): AllowListResult {
  const ignoreAdded = ensureIgnored(projectRoot);
  const path = join(projectRoot, SETTINGS_LOCAL);
  const text = readTextOrNull(path);
  const settings: Settings = text && text.trim() !== '' ? (JSON.parse(text) as Settings) : {};
  const permissions = { ...(settings.permissions ?? {}) };
  const wanted = allowListEntries(installDir);
  const added: AllowListEntries = { allow: [], deny: [], ask: [] };
  for (const key of ['allow', 'deny', 'ask'] as const) {
    const existing = permissions[key] ?? [];
    const fresh = wanted[key].filter((entry) => !existing.includes(entry));
    added[key] = fresh;
    if (fresh.length > 0 || permissions[key]) permissions[key] = [...existing, ...fresh];
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify({ ...settings, permissions }, null, 2)}\n`);
  return { added, ignore_line_added: ignoreAdded, path: SETTINGS_LOCAL };
}
