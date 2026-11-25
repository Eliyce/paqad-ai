import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { readTextIfExistsSync } from '@/core/fs/read-if-exists.js';
import { readFileNoFollow, writeFileNoFollow } from '@/core/fs/read-no-follow.js';
import { isHigherStamp } from '@/core/team-file-schema.js';
import { replaceMarkerBlock } from '@/core/text/marker-block.js';
import { legacyEvidenceIgnoreEntries } from '@/feature-evidence/migrate.js';
import { appendPlanningAudit } from '@/planning/audit.js';

const MANAGED_BEGIN = '# >>> paqad-ai managed (do not edit between markers) >>>';
const MANAGED_END = '# <<< paqad-ai managed <<<';

const GITATTRIBUTES_BEGIN = '# >>> paqad-ai managed >>>';
const GITATTRIBUTES_END = '# <<< paqad-ai managed <<<';

const LEGACY_MARKER = '# paqad-ai';

export const MANAGED_BLOCK_VERSION = 3;
const MANAGED_BLOCK_VERSION_LINE = /^# managed_block_version:[ \t]*(\S+)[ \t]*\r?$/mu;

const MANAGED_GITIGNORE_ENTRIES = [
  `# managed_block_version: ${MANAGED_BLOCK_VERSION}`,
  '.agent-entry-loaded',
  '.agent-entry-loaded.d/',
  'framework-version.txt',
  'cache/',
  'session/',
  'locks/',
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
  '# onboarding journey run state (choices.jsonl and report.* stay committable)',
  'onboarding/journey.json',
  'onboarding/events.jsonl',
  'onboarding/view.json',
  '.config',
  '# per-machine runtime state (regenerated locally)',
  'logs/',
  'state/last-update.json',
  'state/last-update.seen.json',
  'audit.log',
  'decisions/audit.jsonl',
  'decisions/events.jsonl',
  'detection-report.json',
  'stack-snapshot.json',
  'stack-drift.json',
  'rules-discovery-nudge.json',
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
  '# .paqad/skills/ only: .paqad/authoring/skills/ and .paqad/authoring/agents/ hold tracked skill and agent evidence',
  '/skills/',
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

export const AGENTS_IGNORE_LINES: readonly string[] = [
  '# paqad writes and refreshes these files itself. Never commit them.',
  'paqad-*',
];

export const SKILLS_IGNORE_LINES: readonly string[] = [
  '# paqad writes and refreshes these folders itself. Never commit them.',
  'paqad-*/',
];

const OLD_RECIPE_BLOCK_BEGIN = '# paqad recipes:';
const OLD_RECIPE_BLOCK_END = '# end paqad recipes';

function withoutOldRecipeBlock(existing: string): string {
  const start = existing.indexOf(OLD_RECIPE_BLOCK_BEGIN);
  if (start === -1) return existing;
  const endAt = existing.indexOf(OLD_RECIPE_BLOCK_END, start);
  if (endAt === -1) return existing;
  let stop = endAt + OLD_RECIPE_BLOCK_END.length;
  if (existing.startsWith('\r\n', stop)) stop += 2;
  else if (existing.startsWith('\n', stop)) stop += 1;
  return `${existing.slice(0, start)}${existing.slice(stop)}`;
}

export function renderFolderIgnoreBlock(existing: string, lines: readonly string[]): string {
  const base = withoutOldRecipeBlock(existing);
  const eol = base.includes('\r\n') ? '\r\n' : '\n';
  const block = [MANAGED_BEGIN, ...lines, MANAGED_END].join(eol);
  const replaced = replaceMarkerBlock(base, MANAGED_BEGIN, MANAGED_END, block);
  if (replaced !== null) return replaced.endsWith('\n') ? replaced : `${replaced}${eol}`;
  const prefix = base === '' || base.endsWith('\n') ? base : `${base}${eol}`;
  return `${prefix}${block}${eol}`;
}

export function folderIgnoreIsSymlink(folderAbs: string): boolean {
  for (const path of [folderAbs, join(folderAbs, '.gitignore')]) {
    try {
      if (lstatSync(path).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function writeFolderIgnoreBlock(folderAbs: string, lines: readonly string[]): boolean {
  if (folderIgnoreIsSymlink(folderAbs)) return false;
  const path = join(folderAbs, '.gitignore');
  const read = readFileNoFollow(path);
  if (read.kind === 'symlink') return false;
  if (read.kind === 'other') throw read.error;
  const existing = read.kind === 'file' ? read.text : '';
  const next = renderFolderIgnoreBlock(existing, lines);
  if (next === existing) return false;
  mkdirSync(folderAbs, { recursive: true });
  writeFileNoFollow(path, next);
  return true;
}

function ignoredPathsFromRoot(entries: readonly string[] = MANAGED_GITIGNORE_ENTRIES): string[] {
  return entries
    .filter((entry) => !entry.startsWith('#'))
    .map((entry) => `.paqad/${entry.replace(/^\//u, '')}`);
}

export function managedBlockIsNewer(projectRoot: string): boolean {
  const found = MANAGED_BLOCK_VERSION_LINE.exec(
    readTextOrEmpty(join(projectRoot, '.paqad', '.gitignore')),
  )?.[1];
  return isHigherStamp(found, MANAGED_BLOCK_VERSION);
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
  const replaced = replaceMarkerBlock(existing, begin, end, block);
  if (replaced !== null) {
    return ensureTrailingNewline(replaced);
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

export function isGitRepository(projectRoot: string): boolean {
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

export function listTrackedPaths(projectRoot: string, paths: string[]): string[] {
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

const LOCAL_EXCLUDE_MARKER = '# paqad-ai: generated on each machine';

function localExcludePath(projectRoot: string): string | null {
  let excludePath: string;
  try {
    excludePath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
  return isAbsolute(excludePath) ? excludePath : join(projectRoot, excludePath);
}

function excludeLine(relativePath: string): string {
  return `/${relativePath.replace(/^\//u, '')}`;
}

export function excludeLocally(projectRoot: string, relativePath: string): boolean {
  const path = localExcludePath(projectRoot);
  if (path === null) return false;
  const line = excludeLine(relativePath);
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {}
  if (existing.split(/\r?\n/u).includes(line)) return false;
  mkdirSync(dirname(path), { recursive: true });
  const prefix = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
  writeFileSync(path, `${prefix}${LOCAL_EXCLUDE_MARKER}\n${line}\n`, 'utf8');
  return true;
}

export function unexcludeLocally(projectRoot: string, relativePath: string): boolean {
  const path = localExcludePath(projectRoot);
  if (path === null) return false;
  const text = readTextIfExistsSync(path);
  if (text === null) return false;
  const line = excludeLine(relativePath);
  const lines = text.split('\n');
  const kept: string[] = [];
  let removed = false;
  for (const entry of lines) {
    if (entry.replace(/\r$/u, '') !== line) {
      kept.push(entry);
      continue;
    }
    removed = true;
    if (kept.at(-1)?.replace(/\r$/u, '') === LOCAL_EXCLUDE_MARKER) kept.pop();
  }
  if (!removed) return false;
  writeFileSync(path, kept.join('\n'), 'utf8');
  return true;
}
