// npm availability probe (issue #616, Part 8).
//
// Inside the Claude Code plugin a machine may have no npm on PATH at all. The other providers
// (Codex, Gemini, Cursor, …) are still delivered through the npm package, so when npm is absent the
// only provider onboarding can wire is `claude-code` (the plugin itself). Onboarding uses this to
// narrow the provider choice and to validate `--providers` in non-interactive mode.

import { execFileSync } from 'node:child_process';

let cached: boolean | undefined;

/** True when an `npm` binary is resolvable on PATH. Memoized for the process. */
export function isNpmAvailable(): boolean {
  if (cached === undefined) {
    try {
      execFileSync('npm', ['--version'], { stdio: 'ignore' });
      cached = true;
    } catch {
      cached = false;
    }
  }
  return cached;
}

/** Reset the memoized probe. Test-only. */
export function resetNpmAvailableCache(): void {
  cached = undefined;
}
