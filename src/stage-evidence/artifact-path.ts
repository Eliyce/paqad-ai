// Artifact-path boundary validator (issue #350).
//
// A stage-end names the file that proves a thinking stage did real work; the recorder
// hashes that file's on-disk bytes (recorder.ts `hashArtifacts`), and a genuinely-
// missing in-tree file is deliberately recorded as `:absent` so a stage can't claim a
// file that isn't there (the #320 anti-spoof). But the recorder resolves a path with
// `join(projectRoot, rel)`, and `path.join('/repo', '/tmp/x')` is `/repo/tmp/x` — it
// does NOT honour an absolute second arg. So an absolute or out-of-tree path silently
// became a non-existent in-repo path, hashed as absent, and folded the stage to
// inconclusive while the CLI still printed `recorded:true`. The caller believed
// evidence was captured when it wasn't.
//
// This validator runs ONCE at each caller boundary (the CLI flag + the chat marker), so
// both agree: an in-tree path — absolute or relative — normalizes to a project-relative
// posix path the recorder can join safely; a genuinely out-of-tree path is rejected
// loudly (human decision D-01KX841Q4BW3H219AND947T0DV: accept in-tree, reject out-of-
// tree). It judges tree LOCATION only, never existence, so the recorder's absent/empty
// anti-spoof for missing in-tree files is untouched.

import { realpathSync } from 'node:fs';

import { isAbsolute, relative, resolve } from 'pathe';

/** Thrown when an artifact path resolves outside the project root. */
export class ArtifactOutOfTreeError extends Error {
  constructor(public readonly input: string) {
    super(`artifact must be a path inside the project; got ${input}`);
    this.name = 'ArtifactOutOfTreeError';
  }
}

/** Real (symlink-resolved) path when it exists, else the lexical path unchanged. */
function realOrLexical(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

/** Whether a `relative()` result means the path is not inside the root it was taken from. */
function isEscape(rel: string): boolean {
  // Empty (the root dir), a `..` escape, or an absolute remainder (a different Windows
  // drive) all mean the path is not inside the project root.
  return (
    rel === '' || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)
  );
}

/**
 * Normalize an artifact path to a project-relative posix path, or throw
 * {@link ArtifactOutOfTreeError} when it resolves outside the project root.
 *
 * Accepts both a relative in-tree path (unchanged behaviour — the common case) and an
 * absolute path that lands inside the root (normalized to relative). Rejects an
 * absolute path outside the root, a `../…` path that escapes it, and the root itself
 * (a directory, not a file). Existence is never checked as an accept/reject condition —
 * a missing in-tree file still normalizes and is left for the recorder to record as
 * absent (the #320 anti-spoof).
 *
 * Symlinks are reconciled the same way the capability gate does: `process.cwd()` on
 * macOS reports the realpath (`/private/tmp/…`) while a user-supplied absolute path may
 * use the symlinked form (`/tmp/…`), so a purely lexical `relative()` would wrongly read
 * an in-tree file as an escape. The input is therefore compared against BOTH forms of the
 * root — its realpath and its lexical resolution — and is in-tree when either matches.
 *
 * Comparing against both is what keeps existence irrelevant (issue #401): `realpath` falls
 * back to the lexical path for a file that does not exist yet, so an absolute path to a
 * not-yet-created file under a symlinked root (macOS `/var`, `/tmp`) stays in the symlinked
 * form while the root realpaths to `/private/var/…`. Matching only the realpath'd root read
 * that genuinely in-tree path as a `../..` escape and rejected it.
 */
export function normalizeArtifactPath(projectRoot: string, input: string): string {
  const rootResolved = resolve(projectRoot);
  const rootReal = realOrLexical(rootResolved);
  const absInput = isAbsolute(input) ? realOrLexical(input) : resolve(rootReal, input);

  // A Set so the common case (no symlink in the root) does exactly one comparison.
  for (const root of new Set([rootReal, rootResolved])) {
    const rel = relative(root, absInput);
    if (!isEscape(rel)) {
      return rel.replace(/\\/g, '/');
    }
  }
  throw new ArtifactOutOfTreeError(input);
}
