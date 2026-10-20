import { execFileSync } from 'node:child_process';

import fg from 'fast-glob';

export const DEFAULT_SOURCE_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}'];

export const DEFAULT_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.paqad/**',
  '**/build/**',
  '**/vendor/**',
];

export function dropGitIgnored(projectRoot: string, files: string[]): string[] {
  try {
    const out = execFileSync('git', ['check-ignore', '-z', '--stdin'], {
      cwd: projectRoot,
      input: files.join('\0'),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const ignored = new Set(out.toString('utf8').split('\0').filter(Boolean));
    return files.filter((f) => !ignored.has(f));
  } catch {
    return files;
  }
}

export function scanWorkingTree(
  projectRoot: string,
  globs: string[] = DEFAULT_SOURCE_GLOBS,
  ignore: string[] = DEFAULT_IGNORE_GLOBS,
): string[] {
  const listed = fg.sync(globs, { cwd: projectRoot, ignore, onlyFiles: true });
  return dropGitIgnored(projectRoot, listed).sort();
}
