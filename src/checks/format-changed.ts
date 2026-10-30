import { lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { readJsonFile } from '@/introspection/parsers/shared.js';
import { getPacksForFrameworks } from '@/packs/project-packs.js';
import { gitPathList } from '@/pipeline/git-paths.js';

export const FORMAT_CHANGED_MAX_FILES = 200;

export interface ResolvedFormatCommand {
  command: string;
  files: string[] | null;
  scope: 'changed' | 'full';
  reason: string;
}

export interface ResolveFormatCommandInput {
  projectRoot: string;
  frameworks: string[];
  formatCommand: string;
}

export async function resolveFormatCommand(
  input: ResolveFormatCommandInput,
): Promise<ResolvedFormatCommand> {
  const full = (reason: string): ResolvedFormatCommand => ({
    command: input.formatCommand,
    files: null,
    scope: 'full',
    reason,
  });
  const entry = getPacksForFrameworks(input.frameworks, input.projectRoot)
    .flatMap((pack) => pack.manifest.format_changed ?? [])
    .find((candidate) => candidate.default_command === input.formatCommand);
  if (!entry) return full('no changed-files formatter is declared for this format command');

  const pkg = await readJsonFile<{ scripts?: Record<string, unknown> }>(
    input.projectRoot,
    'package.json',
  );
  if (pkg?.scripts?.format !== entry.script) {
    return full('the package.json format script is not the one the pack knows');
  }

  const tracked = gitPathList(input.projectRoot, [
    'diff',
    '--name-only',
    '--relative',
    '-z',
    'HEAD',
  ]);
  const untracked = gitPathList(input.projectRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  if (tracked === null || untracked === null) return full('git could not list the changed files');

  const files = filterFormattableFiles(input.projectRoot, [...tracked, ...untracked]);
  if (files.length === 0) return full('no changed files to format');
  if (files.length > FORMAT_CHANGED_MAX_FILES) {
    return full(`more than ${FORMAT_CHANGED_MAX_FILES} changed files`);
  }
  return {
    command: entry.command,
    files: files.map((file) => `./${file}`),
    scope: 'changed',
    reason: `${files.length} changed files`,
  };
}

export function filterFormattableFiles(projectRoot: string, paths: string[]): string[] {
  const root = realpathSync(projectRoot);
  const kept = new Set<string>();
  for (const raw of paths) {
    const path = raw.replace(/\\/g, '/');
    if (/^([A-Za-z]:|\/)/.test(path) || path.split('/').includes('..')) continue;
    if (isFormattableFile(root, path)) kept.add(path);
  }
  return [...kept].sort();
}

function isFormattableFile(root: string, path: string): boolean {
  const absolute = join(root, path);
  try {
    const link = lstatSync(absolute);
    if (link.isFile()) return true;
    if (!link.isSymbolicLink()) return false;
    const target = realpathSync(absolute);
    const inside = relative(root, target);
    return (
      inside !== '..' &&
      !inside.startsWith(`..${sep}`) &&
      !isAbsolute(inside) &&
      statSync(target).isFile()
    );
  } catch {
    return false;
  }
}
