import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PAQAD_MARKER = '# paqad-ai';

const PAQAD_GITIGNORE_ENTRIES = [
  PAQAD_MARKER,
  '.paqad/framework-path.txt',
  '.paqad/cache/',
  '.paqad/session/',
  '.paqad/context/',
  '.paqad/vectors/',
  '.paqad/secrets.env',
  '.paqad/workflows/',
  '.paqad/indexes/',
  '.paqad/pentest/',
  '.paqad/theme/',
].join('\n');

/**
 * Appends the paqad-ai volatile directory entries to the project .gitignore.
 * Idempotent: if the marker line already exists, the file is left unchanged.
 */
export function writeGitignore(projectRoot: string): void {
  const gitignorePath = join(projectRoot, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';

  if (existing.includes(PAQAD_MARKER)) {
    return;
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(gitignorePath, `${existing}${separator}\n${PAQAD_GITIGNORE_ENTRIES}\n`);
}
