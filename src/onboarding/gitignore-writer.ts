import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { legacyEvidenceIgnoreEntries } from '@/feature-evidence/migrate.js';
import { appendPlanningAudit } from '@/planning/audit.js';

const MANAGED_BEGIN = '# >>> paqad-ai managed (do not edit between markers) >>>';
const MANAGED_END = '# <<< paqad-ai managed <<<';

const GITATTRIBUTES_BEGIN = '# >>> paqad-ai managed >>>';
const GITATTRIBUTES_END = '# <<< paqad-ai managed <<<';

const LEGACY_MARKER = '# paqad-ai';

const MANAGED_GITIGNORE_ENTRIES = [
  '.agent-entry-loaded',
  '.agent-entry-loaded.d/',
  'framework-version.txt',
  'cache/',
  'session/',
  'context/',
  'vectors/',
  'secrets.env',
  'workflows/',
  'indexes/',
  'pentest/',
  'theme/',
  'scripts/rules/.cache/',
  'scripts/rules/.history/',
  'onboarding-checkpoint.json',
  '.config',
  '# per-machine runtime state (regenerated locally)',
  'logs/',
  'audit.log',
  'decisions/audit.jsonl',
  'decisions/events.jsonl',
  'detection-report.json',
  'stack-snapshot.json',
  'stack-drift.json',
  'doc-progress.json',
  'quality-baseline.json',
  'compiled-rules.json',
  'module-health/',
  'module-health-evidence/',
  'module-health-consumed-events.json',
  'patterns/',
  'crs/',
  'attachments/',
  'attachment-events.jsonl',
  'traceability/',
  'module-map/drift.json',
  'module-map/events.jsonl',
  'schema-migrations.jsonl',
  'skills/',
  'delivery-detection.json',
  'checks/',
  '# compliance ledger (share via dashboard/SIEM, not git)',
  'ledger/',
  'compliance/',
  'tmp/',
];

const MANAGED_GITATTRIBUTES_ENTRIES = ['decisions/index.json merge=union'];

const DEPRECATED_ARTIFACTS = [
  '.paqad/version',
  '.paqad/classifier-config.json',
  '.paqad/next-steps.md',
  '.paqad/hooks/silent-update.sh',
];

function ignoredPathsFromRoot(entries: readonly string[] = MANAGED_GITIGNORE_ENTRIES): string[] {
  return entries.filter((entry) => !entry.startsWith('#')).map((entry) => `.paqad/${entry}`);
}

function managedGitignoreEntries(projectRoot: string): string[] {
  return [...MANAGED_GITIGNORE_ENTRIES, ...legacyEvidenceIgnoreEntries(projectRoot)];
}

export function writeManagedGitignoreBlock(
  projectRoot: string,
  entries: string[] = managedGitignoreEntries(projectRoot),
): void {
  reconcileFile(join(projectRoot, '.paqad', '.gitignore'), MANAGED_BEGIN, MANAGED_END, entries);
  reconcileFile(
    join(projectRoot, '.paqad', '.gitattributes'),
    GITATTRIBUTES_BEGIN,
    GITATTRIBUTES_END,
    MANAGED_GITATTRIBUTES_ENTRIES,
  );
}

export function writeGitignore(projectRoot: string): void {
  const entries = managedGitignoreEntries(projectRoot);
  writeManagedGitignoreBlock(projectRoot, entries);

  scrubRootFile(join(projectRoot, '.gitignore'), MANAGED_BEGIN, MANAGED_END, true);
  scrubRootFile(join(projectRoot, '.gitattributes'), GITATTRIBUTES_BEGIN, GITATTRIBUTES_END, false);

  untrackNowIgnoredPaths(projectRoot, ignoredPathsFromRoot(entries));

  removeDeprecatedArtifacts(projectRoot, DEPRECATED_ARTIFACTS);
}

function removeDeprecatedArtifacts(projectRoot: string, paths: string[]): void {
  if (isGitRepository(projectRoot)) {
    const tracked = listTrackedPaths(projectRoot, paths);
    if (tracked.length > 0) {
      try {
        execFileSync('git', ['rm', '-r', '--cached', '--ignore-unmatch', ...tracked], {
          cwd: projectRoot,
          stdio: 'ignore',
        });
      } catch {}
    }
  }

  const removed = paths.filter((path) => unlinkIfPresent(join(projectRoot, path)));
  if (removed.length > 0) {
    appendPlanningAudit(projectRoot, 'INFO', 'gitignore.removed-deprecated-artifacts', {
      paths: removed.join(','),
      count: removed.length,
    });
  }
}

function unlinkIfPresent(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

function reconcileFile(path: string, begin: string, end: string, entries: string[]): void {
  const existing = readTextOrEmpty(path);
  const next = reconcileManagedBlock(existing, begin, end, entries);
  if (next !== existing) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
  }
}

function reconcileManagedBlock(
  existing: string,
  begin: string,
  end: string,
  entries: string[],
): string {
  const block = [begin, ...entries, end].join('\n');
  const beginIdx = existing.indexOf(begin);
  const endIdx = existing.indexOf(end);

  if (beginIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + end.length);
    return ensureTrailingNewline(`${before}${block}${after}`);
  }

  const trimmed = existing.replace(/\s+$/, '');
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : '';
  return `${prefix}${block}\n`;
}

function scrubRootFile(path: string, begin: string, end: string, scrubLegacy: boolean): void {
  const existing = readTextOrEmpty(path);
  if (existing === '') {
    return;
  }

  let next = removeManagedBlock(existing, begin, end);
  if (scrubLegacy && next.includes(LEGACY_MARKER)) {
    next = stripLegacyBlock(next);
  }

  if (next !== existing) {
    writeFileSync(path, next);
  }
}

function removeManagedBlock(existing: string, begin: string, end: string): string {
  const beginIdx = existing.indexOf(begin);
  const endIdx = existing.indexOf(end);
  if (beginIdx === -1 || endIdx <= beginIdx) {
    return existing;
  }

  const before = existing.slice(0, beginIdx).replace(/\n+$/, '');
  const after = existing.slice(endIdx + end.length).replace(/^\n+/, '');

  if (before === '' && after === '') {
    return '';
  }
  if (before === '') {
    return ensureTrailingNewline(after);
  }
  if (after === '') {
    return ensureTrailingNewline(before);
  }
  return ensureTrailingNewline(`${before}\n\n${after}`);
}

function stripLegacyBlock(existing: string): string {
  const managedPaths = new Set([...ignoredPathsFromRoot(), '.paqad/framework-path.txt']);
  return existing
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== LEGACY_MARKER && !managedPaths.has(trimmed);
    })
    .join('\n');
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function untrackNowIgnoredPaths(projectRoot: string, paths: string[]): void {
  if (!isGitRepository(projectRoot)) {
    return;
  }

  const tracked = listTrackedPaths(projectRoot, paths);
  if (tracked.length === 0) {
    return;
  }

  try {
    execFileSync('git', ['rm', '-r', '--cached', '--ignore-unmatch', ...tracked], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
  } catch {
    return;
  }

  appendPlanningAudit(projectRoot, 'INFO', 'gitignore.untracked-now-ignored', {
    paths: tracked.join(','),
    count: tracked.length,
  });
}

function isGitRepository(projectRoot: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim() === 'true';
  } catch {
    return false;
  }
}

function listTrackedPaths(projectRoot: string, paths: string[]): string[] {
  if (paths.length === 0) {
    return [];
  }
  const normalized = paths.map((path) => path.replace(/\/$/, ''));
  let listed: Set<string>;
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', ...normalized], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    listed = new Set(out.toString('utf8').split('\0').filter(Boolean));
  } catch {
    return [];
  }
  if (listed.size === 0) {
    return [];
  }
  const trackedEntries = [...listed];
  return normalized.filter((path) =>
    trackedEntries.some((entry) => entry === path || entry.startsWith(`${path}/`)),
  );
}
