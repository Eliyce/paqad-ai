import { execFileSync } from 'node:child_process';

let cached: boolean | undefined;

export function isNpmAvailable(): boolean {
  if (cached === undefined) {
    try {
      execFileSync('npm --version', { stdio: 'ignore', shell: true });
      cached = true;
    } catch {
      cached = false;
    }
  }
  return cached;
}

export function resetNpmAvailableCache(): void {
  cached = undefined;
}
