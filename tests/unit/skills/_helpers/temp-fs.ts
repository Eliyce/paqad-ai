import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Creates an isolated temp directory for a test, runs the callback with the
 * absolute path, and removes the directory afterward (even on failure).
 *
 * Used by scripts that scan paths (find-api-docs, list-canonical-docs, etc.)
 * so we never poke at the real repo from a test.
 */
export function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-skill-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Writes a file inside a temp dir, creating parent dirs as needed.
 * Returns the absolute path of the written file.
 */
export function writeFile(dir: string, relPath: string, contents: string): string {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
  return full;
}
