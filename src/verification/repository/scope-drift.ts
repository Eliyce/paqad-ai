// Issue #117 (C-4) — scope-drift detection. Compares the changed files against
// the frozen spec boundary (the attributed modules + the framework/test/doc
// areas a change is legitimately allowed to touch). Files outside the boundary
// are out-of-scope drift: the agent was asked for X and also changed Y.
//
// Pure prefix matching, kept separate from the boundary *policy* (which the
// context builder owns) so it is trivially unit-testable.

/**
 * Normalize a project-relative path for prefix comparison: backslashes to
 * forward slashes, strip a single leading `./` or `/`, strip trailing slashes.
 * Trailing slashes are removed with a character scan rather than a `/\/+$/`
 * regex, which CodeQL flags as polynomial ReDoS on strings of many slashes.
 */
function normalizePath(value: string): string {
  const slashed = value.replace(/\\/g, '/').trim();
  let start = 0;
  if (slashed.startsWith('./')) {
    start = 2;
  } else if (slashed.startsWith('/')) {
    start = 1;
  }
  let end = slashed.length;
  while (end > start && slashed[end - 1] === '/') {
    end -= 1;
  }
  return slashed.slice(start, end);
}

function isWithinBoundary(file: string, boundary: string[]): boolean {
  return boundary.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

/**
 * Returns the sorted, de-duplicated changed files that fall outside the spec
 * boundary. An empty boundary means "no boundary declared" and yields no drift
 * (the gate stays inert on the in-session provider path). A boundary entry is a
 * project-relative file or directory prefix; a changed file is in scope when it
 * equals, or sits under, any entry.
 */
export function collectScopeDriftPaths(changedFiles: string[], specBoundary: string[]): string[] {
  const boundary = specBoundary.map(normalizePath).filter((entry) => entry.length > 0);
  if (boundary.length === 0) {
    return [];
  }

  const drift = changedFiles
    .map((file) => normalizePath(file))
    .filter((file) => file.length > 0 && !isWithinBoundary(file, boundary));

  return [...new Set(drift)].sort();
}
