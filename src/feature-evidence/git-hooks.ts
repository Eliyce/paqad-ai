// Native git-hook installer (issue #339, Phase 5): post-commit + post-merge.
//
// Hooks are a Claude-Code privilege; git's OWN hook events are the one signal every
// host shares. paqad installs `post-commit` / `post-merge` that call
// `paqad-ai delivery-link` so the active feature's `delivery.json` gets the complete
// commit trail as commits land — on every provider. The installer CHAINS, never
// clobbers: an existing hook (or husky / lefthook / a `core.hooksPath` redirect) is
// preserved and our block is appended after it, guarded by a marker so re-install is
// idempotent. post-commit/post-merge are unaffected by `--no-verify`, so capture is not
// skippable. Every hook line is best-effort (`|| true`) — a git operation is never
// blocked by paqad.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Marker that identifies (and de-dupes) the paqad block inside a hook file. */
export const GIT_HOOK_MARKER = '# paqad-ai delivery-link (issue #339)';

const HOOKS: ReadonlyArray<{ name: string; verb: 'commit' | 'merge' }> = [
  { name: 'post-commit', verb: 'commit' },
  { name: 'post-merge', verb: 'merge' },
];

export interface InstallGitHooksResult {
  /** Hooks freshly written or chained this run. */
  installed: string[];
  /** Hooks already carrying the paqad block (idempotent skip). */
  skipped: string[];
  /** True when the target is not a git repo (nothing installed). */
  notAGitRepo: boolean;
  /**
   * True when the resolved hooks dir is git-TRACKED (a `core.hooksPath` redirect to a committed
   * dir, e.g. husky's `.husky/` or a tracked `.githooks/`). In that case nothing is written —
   * modifying a tracked file would produce a diff (and husky v9 discards appended blocks on
   * reinstall). {@link snippet} carries the line for the developer to add themselves (issue #576,
   * Finding 9).
   */
  trackedHooksDir?: boolean;
  /** The one-line snippet to add to the tracked hooks, set only when {@link trackedHooksDir}. */
  snippet?: string;
}

/**
 * Whether the resolved hooks dir is git-tracked. The default hooks dir lives inside the git dir
 * and is never tracked; a `core.hooksPath` redirect to a working-tree dir is tracked when git
 * tracks any file under it. Best-effort — an indeterminate result reads as not-tracked (install as
 * before), so this only ever SUPPRESSES a write it is confident would touch a tracked file.
 */
function hooksDirIsTracked(projectRoot: string, dir: string): boolean {
  const gitDir = git(projectRoot, ['rev-parse', '--absolute-git-dir']);
  if (gitDir) {
    const resolvedGitDir = resolve(gitDir);
    const resolvedDir = resolve(dir);
    // Boundary-aware containment: `<root>/.git` must not swallow a sibling like `<root>/.githooks`,
    // whose string starts with `<root>/.git` but is NOT inside the git dir. A bare `startsWith`
    // here mis-classified a tracked `.githooks` redirect as internal on Linux (issue #576).
    if (resolvedDir === resolvedGitDir || resolvedDir.startsWith(resolvedGitDir + sep)) {
      return false; // inside `.git/` — never tracked
    }
  }
  // Query with a pathspec RELATIVE to the repo root, forward-slashed. An absolute pathspec is not
  // portable across git versions/platforms (it read empty on Linux CI while passing on macOS), and
  // a Windows path needs forward slashes. A dir resolving outside the repo (`..`) is not tracked.
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

/** The hooks directory git will actually run, honouring a `core.hooksPath` redirect. */
export function resolveHooksDir(projectRoot: string): string | null {
  const rel = git(projectRoot, ['rev-parse', '--git-path', 'hooks']);
  if (!rel) return null;
  return isAbsolute(rel) ? rel : join(projectRoot, rel);
}

/** The paqad hook block for one verb — a marker line plus a best-effort CLI call. */
export function hookBlock(verb: 'commit' | 'merge'): string {
  return (
    `${GIT_HOOK_MARKER}\n` +
    `command -v paqad-ai >/dev/null 2>&1 && ` +
    `paqad-ai delivery-link ${verb} >/dev/null 2>&1 || true`
  );
}

/**
 * Install (or chain) the `post-commit` / `post-merge` hooks in `projectRoot`. Idempotent:
 * a hook that already carries {@link GIT_HOOK_MARKER} is left untouched. A pre-existing
 * hook is chained — our block is appended after the original, which is preserved intact.
 * Returns which hooks were written vs skipped. A non-git dir is a no-op (never throws).
 */
export function installGitHooks(projectRoot: string): InstallGitHooksResult {
  const dir = resolveHooksDir(projectRoot);
  if (!dir) {
    return { installed: [], skipped: [], notAGitRepo: true };
  }
  // Issue #576 (Finding 9) — never write into a git-tracked hooks dir. Report the snippet instead.
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
    } catch {
      // No hook yet — we create one below.
    }
    if (existing.includes(GIT_HOOK_MARKER)) {
      skipped.push(name);
      continue;
    }
    const block = hookBlock(verb);
    if (existing.trim() === '') {
      writeFileSync(path, `#!/bin/sh\n${block}\n`, 'utf8');
    } else {
      // Chain: keep the original hook, append our block so both run.
      const prefix = existing.endsWith('\n') ? existing : `${existing}\n`;
      writeFileSync(path, `${prefix}${block}\n`, 'utf8');
    }
    try {
      chmodSync(path, 0o755);
    } catch {
      // A filesystem without exec bits (some Windows setups) — git still runs it.
    }
    installed.push(name);
  }
  return { installed, skipped, notAGitRepo: false };
}
