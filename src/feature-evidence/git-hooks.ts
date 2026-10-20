import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { toPosixPath } from '@/core/path-utils.js';
import { getPackageRoot } from '@/core/runtime-paths.js';

export const GIT_HOOK_MARKER = `# paqad-ai delivery-link (issue #${339})`;

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

export function installGitHooks(projectRoot: string): InstallGitHooksResult {
  const dir = resolveHooksDir(projectRoot);
  if (!dir) {
    return { installed: [], skipped: [], notAGitRepo: true };
  }
  if (hooksDirIsTracked(projectRoot, dir)) {
    return {
      installed: [],
      skipped: [],
      notAGitRepo: false,
      trackedHooksDir: true,
      snippet:
        `${GIT_HOOK_MARKER}\n` +
        `add to post-commit and post-merge in your tracked hooks dir:\n` +
        `  ${hookBlock('commit').split('\n')[1]}`,
    };
  }
  mkdirSync(dir, { recursive: true });
  const installed: string[] = [];
  const skipped: string[] = [];
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
    const block = hookBlock(verb);
    if (existing.trim() === '') {
      writeFileSync(path, `#!/bin/sh\n${block}\n`, 'utf8');
    } else {
      const prefix = existing.endsWith('\n') ? existing : `${existing}\n`;
      writeFileSync(path, `${prefix}${block}\n`, 'utf8');
    }
    try {
      chmodSync(path, 0o755);
    } catch {}
    installed.push(name);
  }
  return { installed, skipped, notAGitRepo: false };
}
