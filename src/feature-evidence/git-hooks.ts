import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { toPosixPath } from '@/core/path-utils.js';
import { getPackageRoot } from '@/core/runtime-paths.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import type { PeopleEnforcement } from '@/git-workflow/types.js';

export const GIT_HOOK_MARKER = '# paqad-ai delivery-link';
export const GIT_WORKFLOW_HOOK_MARKER = '# paqad-ai git-workflow';

const WORKFLOW_HOOKS: ReadonlyArray<{ name: string; line: string; runs: RegExp }> = [
  {
    name: 'commit-msg',
    line: 'if command -v paqad-ai >/dev/null 2>&1; then paqad-ai git-workflow check-commit "$1" || exit 1; fi',
    runs: /paqad-ai git-workflow check-commit\s+"?\$1"?/u,
  },
  {
    name: 'pre-push',
    line: 'if command -v paqad-ai >/dev/null 2>&1; then paqad-ai git-workflow check-push || exit 1; fi',
    runs: /paqad-ai git-workflow check-push/u,
  },
];

const HUSKY_RUNNER_DIR = '_';
const HUSKY_RUNNER_FILE = 'h';
const PATH_LIMIT_LINE = 'The check is skipped in a terminal where paqad-ai is not on the PATH.';

export const WORKFLOW_HOOK_NAMES: readonly string[] = WORKFLOW_HOOKS.map((hook) => hook.name);

export function workflowHookBlock(name: string): string {
  const hook = WORKFLOW_HOOKS.find((entry) => entry.name === name);
  return `${GIT_WORKFLOW_HOOK_MARKER}\n${hook?.line ?? ''}`;
}

export function distCliPath(): string {
  return toPosixPath(join(getPackageRoot(), 'dist', 'cli', 'index.js'));
}

const HOOKS: ReadonlyArray<{ name: string; verb: 'commit' | 'merge' }> = [
  { name: 'post-commit', verb: 'commit' },
  { name: 'post-merge', verb: 'merge' },
];

export interface InstallGitHooksResult {
  installed: string[];
  skipped: string[];
  removed?: string[];
  notAGitRepo: boolean;
  trackedHooksDir?: boolean;
  snippet?: string;
}

function hooksDirIsTracked(projectRoot: string, dir: string): boolean {
  const gitDir = git(projectRoot, ['rev-parse', '--absolute-git-dir']);
  if (gitDir) {
    const resolvedGitDir = resolve(gitDir);
    const resolvedDir = resolve(dir);
    if (resolvedDir === resolvedGitDir || resolvedDir.startsWith(resolvedGitDir + sep)) {
      return false;
    }
  }
  const rel = relative(projectRoot, dir).replace(/\\/g, '/');
  if (rel === '' || rel.startsWith('..')) {
    return false;
  }
  const listed = git(projectRoot, ['ls-files', '--', rel]);
  return listed !== undefined && listed.length > 0;
}

function git(projectRoot: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

export function resolveHooksDir(projectRoot: string): string | null {
  const rel = git(projectRoot, ['rev-parse', '--git-path', 'hooks']);
  if (!rel) return null;
  return isAbsolute(rel) ? rel : join(projectRoot, rel);
}

export function hookBlock(verb: 'commit' | 'merge', cliPath: string = distCliPath()): string {
  return (
    `${GIT_HOOK_MARKER}\n` +
    `if command -v paqad-ai >/dev/null 2>&1; then paqad-ai delivery-link ${verb} >/dev/null 2>&1 || true; ` +
    `elif command -v node >/dev/null 2>&1 && [ -f "${cliPath}" ]; then ` +
    `node "${cliPath}" delivery-link ${verb} >/dev/null 2>&1 || true; fi`
  );
}

function readHook(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function makeExecutable(path: string): void {
  try {
    chmodSync(path, 0o755);
  } catch {}
}

function appendBlock(path: string, existing: string, block: string): void {
  if (existing.trim() === '') {
    writeFileSync(path, `#!/bin/sh\n${block}\n`, 'utf8');
  } else {
    const prefix = existing.endsWith('\n') ? existing : `${existing}\n`;
    writeFileSync(path, `${prefix}${block}\n`, 'utf8');
  }
  makeExecutable(path);
}

export function stripWorkflowBlock(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === GIT_WORKFLOW_HOOK_MARKER) {
      i += 1;
      continue;
    }
    kept.push(lines[i]);
  }
  return kept.join('\n');
}

export function peopleSetting(projectRoot: string): PeopleEnforcement {
  try {
    const { config } = loadGitWorkflow(projectRoot);
    return config.enforcement.enabled ? config.enforcement.people : 'off';
  } catch {
    return 'off';
  }
}

function syncWorkflowHooks(
  dir: string,
  people: PeopleEnforcement,
  result: { installed: string[]; skipped: string[]; removed: string[] },
): void {
  for (const hook of WORKFLOW_HOOKS) {
    const { name } = hook;
    const path = join(dir, name);
    const existing = readHook(path);
    const present = existing.includes(GIT_WORKFLOW_HOOK_MARKER);
    if (people === 'off') {
      if (!present) continue;
      const stripped = stripWorkflowBlock(existing);
      if (stripped.replace(/^#!.*\n?/, '').trim() === '') rmSync(path, { force: true });
      else writeFileSync(path, stripped, 'utf8');
      result.removed.push(name);
      continue;
    }
    if (hookRunsCheck(existing, hook)) {
      makeExecutable(path);
      result.skipped.push(name);
      continue;
    }
    appendBlock(path, existing, workflowHookBlock(name));
    result.installed.push(name);
  }
}

function hookRunsCheck(text: string, hook: { runs: RegExp }): boolean {
  return text.split(/\r?\n/u).some((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith('#') && hook.runs.test(trimmed);
  });
}

function isExecutable(path: string): boolean {
  try {
    return (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

interface HookFiles {
  dir: string;
  huskyRuns: boolean;
}

function hookFilesFor(projectRoot: string, dir: string): HookFiles {
  const huskyRuns =
    basename(dir) === HUSKY_RUNNER_DIR &&
    existsSync(join(dir, HUSKY_RUNNER_FILE)) &&
    hooksDirIsTracked(projectRoot, dir);
  return huskyRuns ? { dir: dirname(dir), huskyRuns } : { dir, huskyRuns };
}

function needsExecutableBit(files: HookFiles, platform: NodeJS.Platform): boolean {
  return !files.huskyRuns && platform !== 'win32';
}

export function workflowHooksInstalled(
  projectRoot: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const dir = resolveHooksDir(projectRoot);
  if (!dir) return false;
  const files = hookFilesFor(projectRoot, dir);
  return WORKFLOW_HOOKS.every((hook) => {
    const path = join(files.dir, hook.name);
    return (
      hookRunsCheck(readHook(path), hook) &&
      (!needsExecutableBit(files, platform) || isExecutable(path))
    );
  });
}

function executableStep(shown: string): string {
  return `chmod +x ${shown}, or git update-index --chmod=+x ${shown} from Windows`;
}

function hookAdvice(
  projectRoot: string,
  files: HookFiles,
  hook: (typeof WORKFLOW_HOOKS)[number],
  platform: NodeJS.Platform,
): string[] {
  const path = join(files.dir, hook.name);
  const shown = toPosixPath(relative(projectRoot, path));
  const block = workflowHookBlock(hook.name);
  if (!existsSync(path)) {
    return [
      `${shown} doesn't exist yet. Create it with these lines, then run ${executableStep(shown)}:`,
      '#!/bin/sh',
      block,
    ];
  }
  if (!hookRunsCheck(readHook(path), hook)) return [`${shown}:`, block];
  if (needsExecutableBit(files, platform) && !isExecutable(path)) {
    return [`${shown} has the line but git can't run it. Run ${executableStep(shown)}.`];
  }
  return [];
}

export function trackedWorkflowHookAdvice(
  projectRoot: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const dir = resolveHooksDir(projectRoot);
  if (!dir || !hooksDirIsTracked(projectRoot, dir) || peopleSetting(projectRoot) === 'off') {
    return null;
  }
  const files = hookFilesFor(projectRoot, dir);
  const missing = WORKFLOW_HOOKS.flatMap((hook) => hookAdvice(projectRoot, files, hook, platform));
  if (missing.length === 0) return null;
  return [
    `Your git hooks are in ${toPosixPath(relative(projectRoot, files.dir))}, which your repo tracks, so paqad didn't change them.`,
    'Add these lines to commit-msg and pre-push so people get the workflow check:',
    ...missing,
    PATH_LIMIT_LINE,
  ].join('\n');
}

function deliveryLinkSnippet(): string[] {
  return HOOKS.flatMap(({ name, verb }) => [`${name}:`, hookBlock(verb)]);
}

export function installGitHooks(projectRoot: string): InstallGitHooksResult {
  const dir = resolveHooksDir(projectRoot);
  if (!dir) {
    return { installed: [], skipped: [], notAGitRepo: true };
  }
  if (hooksDirIsTracked(projectRoot, dir)) {
    const advice = trackedWorkflowHookAdvice(projectRoot);
    return {
      installed: [],
      skipped: [],
      notAGitRepo: false,
      trackedHooksDir: true,
      snippet: [
        ...(advice === null ? [] : [advice]),
        'Add these lines to post-commit and post-merge in your tracked hooks dir:',
        ...deliveryLinkSnippet(),
      ].join('\n'),
    };
  }
  mkdirSync(dir, { recursive: true });
  const installed: string[] = [];
  const skipped: string[] = [];
  const removed: string[] = [];
  for (const { name, verb } of HOOKS) {
    const path = join(dir, name);
    let existing = '';
    try {
      existing = readFileSync(path, 'utf8');
    } catch {}
    if (existing.includes(GIT_HOOK_MARKER)) {
      skipped.push(name);
      continue;
    }
    appendBlock(path, existing, hookBlock(verb));
    installed.push(name);
  }
  syncWorkflowHooks(dir, peopleSetting(projectRoot), { installed, skipped, removed });
  return { installed, skipped, removed, notAGitRepo: false };
}
