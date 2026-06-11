// Issue #117 (C-4) — scope-drift detection. Compares the changed files against
// the frozen spec boundary (the attributed modules + the framework/test/doc
// areas a change is legitimately allowed to touch). Files outside the boundary
// are out-of-scope drift: the agent was asked for X and also changed Y.
//
// Pure prefix matching, kept separate from the boundary *policy* (which the
// context builder owns) so it is trivially unit-testable.

function normalizeBoundaryPath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '')
    .trim();
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
  const boundary = specBoundary.map(normalizeBoundaryPath).filter((entry) => entry.length > 0);
  if (boundary.length === 0) {
    return [];
  }

  const drift = changedFiles
    .map((file) =>
      file
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '')
        .trim(),
    )
    .filter((file) => file.length > 0 && !isWithinBoundary(file, boundary));

  return [...new Set(drift)].sort();
}
