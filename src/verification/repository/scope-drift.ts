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
