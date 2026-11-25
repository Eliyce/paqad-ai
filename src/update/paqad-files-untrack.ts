import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { LEGACY_RECIPE_FOLDER_NAMES, RECIPE_FOLDER_NAMES } from '@/authoring/generated-recipes.js';
import { OPEN_STANDARD_SKILLS_ROOT } from '@/authoring/paths.js';
import { splitFrontMatter } from '@/feature-evidence/envelope.js';
import { VERSION } from '@/index.js';
import { PROJECT_AGENTS_DIR, isPaqadOwnedAgent } from '@/onboarding/stage-agent-migration.js';

export interface GitResult {
  status: number | null;
  stdout: string;
}

export type GitRunner = (args: readonly string[], cwd: string) => GitResult | null;

export const runGit: GitRunner = (args, cwd) => {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error) return null;
  return { status: result.status, stdout: result.stdout ?? '' };
};

export const TEAM_LAUNCHER_FILE = '.paqad/hook.mjs';
const LAUNCHER_STAMP = /LAUNCHER_REVISION = (\S+?);/u;
const AGENT_PATH = /^\.claude\/agents\/paqad-[a-z0-9-]+\.md$/u;

export function untrackLine(version: string = VERSION): string {
  return `paqad's own files (stage agents, recipes and .paqad/hook.mjs) are now kept out of git and refreshed for you. Commit the removal once: \`git commit -m "chore: stop tracking paqad files"\`, and ask teammates to run \`paqad-ai update\` (or set updates.minimum_version to ${version}).`;
}

export function isCiEnvironment(env: NodeJS.ProcessEnv): boolean {
  return (
    (typeof env.CI === 'string' && env.CI !== '' && env.CI !== 'false') ||
    env.GITHUB_ACTIONS === 'true'
  );
}

function ok(result: GitResult | null): result is GitResult {
  return result !== null && result.status === 0;
}

export function gitIsSafe(projectRoot: string, git: GitRunner): boolean {
  const inside = git(['rev-parse', '--is-inside-work-tree'], projectRoot);
  if (!ok(inside) || inside.stdout.trim() !== 'true') return false;
  const dir = git(['rev-parse', '--git-dir'], projectRoot);
  if (!ok(dir)) return false;
  const gitDir = isAbsolute(dir.stdout.trim())
    ? dir.stdout.trim()
    : join(projectRoot, dir.stdout.trim());
  return !['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'index.lock'].some((name) =>
    existsSync(join(gitDir, name)),
  );
}

export function isPaqadLauncher(text: string | null): boolean {
  return text !== null && LAUNCHER_STAMP.test(text);
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function listed(git: GitRunner, projectRoot: string, args: string[]): string[] {
  const result = git(args, projectRoot);
  if (!ok(result)) return [];
  return result.stdout.split('\0').filter(Boolean);
}

function recipeFolderOf(path: string): string | null {
  const prefix = `${OPEN_STANDARD_SKILLS_ROOT}/`;
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length).split('/')[0];
  return name === undefined || name === '' ? null : name;
}

function indexText(git: GitRunner, projectRoot: string, ref: string, path: string): string | null {
  const result = git(['show', ref === ':' ? `:${path}` : `${ref}:${path}`], projectRoot);
  return ok(result) ? result.stdout : null;
}

function ownedPaths(git: GitRunner, projectRoot: string, ref: string, paths: string[]): string[] {
  const owned = new Set<string>();
  for (const path of paths) {
    if (AGENT_PATH.test(path)) {
      const text = readText(join(projectRoot, path)) ?? indexText(git, projectRoot, ref, path);
      if (text !== null && isPaqadOwnedAgent(text)) owned.add(path);
      continue;
    }
    if (path === TEAM_LAUNCHER_FILE) {
      const text = readText(join(projectRoot, path)) ?? indexText(git, projectRoot, ref, path);
      if (isPaqadLauncher(text)) owned.add(path);
      continue;
    }
    const folder = recipeFolderOf(path);
    if (folder === null) continue;
    if (RECIPE_FOLDER_NAMES.includes(folder)) {
      owned.add(`${OPEN_STANDARD_SKILLS_ROOT}/${folder}`);
    } else if (LEGACY_RECIPE_FOLDER_NAMES.includes(folder)) {
      const skill = indexText(
        git,
        projectRoot,
        ref,
        `${OPEN_STANDARD_SKILLS_ROOT}/${folder}/SKILL.md`,
      );
      if (skill !== null && splitFrontMatter(skill).header?.['name'] === folder) {
        owned.add(`${OPEN_STANDARD_SKILLS_ROOT}/${folder}`);
      }
    }
  }
  return [...owned].sort();
}

function scopes(): string[] {
  return [PROJECT_AGENTS_DIR, OPEN_STANDARD_SKILLS_ROOT, TEAM_LAUNCHER_FILE];
}

export interface UntrackResult {
  untracked: string[];
  notes: string[];
}

export interface UntrackOptions {
  git?: GitRunner;
  env?: NodeJS.ProcessEnv;
  version?: string;
}

export function untrackPaqadFiles(
  projectRoot: string,
  options: UntrackOptions = {},
): UntrackResult {
  const git = options.git ?? runGit;
  const env = options.env ?? process.env;
  const result: UntrackResult = { untracked: [], notes: [] };
  try {
    if (isCiEnvironment(env)) return result;
    if (!gitIsSafe(projectRoot, git)) return result;
    const tracked = listed(git, projectRoot, ['ls-files', '-z', '--', ...scopes()]);
    const toUntrack = ownedPaths(git, projectRoot, ':', tracked);
    if (toUntrack.length > 0) {
      const removed = git(
        ['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', ...toUntrack],
        projectRoot,
      );
      if (ok(removed)) result.untracked = toUntrack;
    }
    const inHead = listed(git, projectRoot, [
      'ls-tree',
      '-r',
      '-z',
      '--name-only',
      'HEAD',
      '--',
      ...scopes(),
    ]);
    if (ownedPaths(git, projectRoot, 'HEAD', inHead).length > 0) {
      result.notes.push(untrackLine(options.version));
    }
  } catch {
    return result;
  }
  return result;
}
