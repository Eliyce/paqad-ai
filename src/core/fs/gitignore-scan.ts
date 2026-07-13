// Shared .gitignore-respecting working-tree scan (issue #353, decision
// D-01KXD2PH90CBBGWMF93ZFF12F7). Extracted from src/rule-scripts/runner.ts so the
// rule-script runner and the code-knowledge index resolve the file set through
// ONE canonical helper instead of two divergent copies (RULE-13 / RULE-14).
//
// No LLM, no network. A single batched `git check-ignore` honours the project
// `.gitignore`, nested `.paqad/.gitignore`, and any global excludes alike.
// `check-ignore` respects the index by default, so *tracked* source that merely
// matches a pattern is kept; only genuinely-ignored (untracked) files are removed.

import { execFileSync } from 'node:child_process';

import fg from 'fast-glob';

/** Common source-file globs — the working-tree scan default. */
export const DEFAULT_SOURCE_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}'];

/** Directories never worth scanning (build output, vendored deps, framework metadata). */
export const DEFAULT_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.paqad/**',
  '**/build/**',
  '**/vendor/**',
];

/**
 * Drop the paths git ignores (build output, vendored deps, generated code a team
 * gitignores) from a candidate list, via a single batched `git check-ignore`.
 *
 * Best-effort: git missing or not-a-repo (exit 128) / nothing ignored (exit 1)
 * both throw, and we fall back to the caller's static list unchanged — a git
 * failure never removes a file and never throws.
 */
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

/**
 * Enumerate the working tree for `globs`, drop the statically-ignored directories,
 * then drop everything git ignores. Returns project-relative, forward-slash paths,
 * sorted for a stable order.
 */
export function scanWorkingTree(
  projectRoot: string,
  globs: string[] = DEFAULT_SOURCE_GLOBS,
  ignore: string[] = DEFAULT_IGNORE_GLOBS,
): string[] {
  const listed = fg.sync(globs, { cwd: projectRoot, ignore, onlyFiles: true });
  return dropGitIgnored(projectRoot, listed).sort();
}
