import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readDeprecation } from '../deprecation.js';
import type {
  FrameworkApiAdapter,
  FrameworkApiAdapterInput,
  FrameworkApiAdapterResult,
  FrameworkApiSymbol,
} from '../types.js';

import { phpDeprecationTags, scanPhpFile, type PhpClass } from './php-scan.js';
import { dynamicRecord, projectRelative } from './shared.js';

interface ComposerInstalledEntry {
  name?: string;
  version?: string;
  version_normalized?: string;
  'install-path'?: string;
  dist?: { reference?: string };
}

const MAX_FILES = 6000;

const SKIPPED_DIRS = new Set(['tests', 'test', 'node_modules', 'vendor', '.git', 'stubs']);

export function normalizeComposerVersion(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function findInstalledEntry(
  searchRoot: string,
  packageName: string,
): { entry: ComposerInstalledEntry; dir: string } | null {
  const composerDir = join(searchRoot, 'vendor', 'composer');
  const installed = readJson<{ packages?: ComposerInstalledEntry[] } | ComposerInstalledEntry[]>(
    join(composerDir, 'installed.json'),
  );
  const entries = Array.isArray(installed) ? installed : (installed?.packages ?? []);
  const entry = entries.find((candidate) => candidate.name === packageName);
  if (entry?.version !== undefined) {
    const installPath = entry['install-path'];
    return {
      entry,
      dir:
        installPath === undefined
          ? join(searchRoot, 'vendor', packageName)
          : resolve(composerDir, installPath),
    };
  }

  const lock = readJson<{ packages?: ComposerInstalledEntry[] }>(join(searchRoot, 'composer.lock'));
  const locked = (lock?.packages ?? []).find((candidate) => candidate.name === packageName);
  if (locked?.version === undefined) {
    return null;
  }
  return { entry: locked, dir: join(searchRoot, 'vendor', packageName) };
}

function phpFiles(dir: string): string[] {
  const found: string[] = [];
  const queue = [dir];
  while (queue.length > 0 && found.length < MAX_FILES) {
    const current = queue.shift() as string;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
      /* v8 ignore start -- the directory came from a readdir hit one level up; an unreadable subtree is skipped rather than failing the package. */
    } catch {
      continue;
    }
    /* v8 ignore stop */
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) {
          queue.push(join(current, entry.name));
        }
        continue;
      }
      if (entry.name.endsWith('.php') && found.length < MAX_FILES) {
        found.push(join(current, entry.name));
      }
    }
  }
  return found.sort();
}

function assertedRecord(
  name: string,
  kind: FrameworkApiSymbol['kind'],
  tags: { name: string; text?: { text: string }[] }[],
): FrameworkApiSymbol {
  const deprecation = readDeprecation(tags);
  return {
    name,
    kind,
    exists: true,
    deprecated: deprecation.deprecated,
    message: deprecation.message,
    since: deprecation.since,
    for_removal: deprecation.for_removal,
    provenance: 'asserted',
  };
}

export function classRecords(namespace: string | null, declared: PhpClass): FrameworkApiSymbol[] {
  const qualified = namespace === null ? declared.name : `${namespace}\\${declared.name}`;
  const records: FrameworkApiSymbol[] = [
    assertedRecord(qualified, declared.kind, phpDeprecationTags(declared)),
  ];

  for (const method of declared.methods) {
    const record = assertedRecord(
      `${qualified}::${method.name}`,
      'member',
      phpDeprecationTags(method),
    );
    if (record.deprecated) {
      records.push(record);
    }
  }
  for (const promised of declared.documentedMethods) {
    records.push(assertedRecord(`${qualified}::${promised}`, 'member', []));
  }
  records.push(dynamicRecord(qualified));
  return records;
}

export const phpFrameworkApiAdapter: FrameworkApiAdapter = {
  ecosystem: 'php',

  resolveInstalled(searchRoot, packageName) {
    const found = findInstalledEntry(searchRoot, packageName);
    if (found === null) {
      return null;
    }
    try {
      if (!statSync(found.dir).isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }
    return { dir: found.dir, version: normalizeComposerVersion(found.entry.version as string) };
  },

  contentHash(input: FrameworkApiAdapterInput): string {
    const found = findInstalledEntry(input.searchRoot, input.package);
    const hash = createHash('sha256').update(`${input.package}@${input.version}`);
    hash.update(found?.entry.dist?.reference ?? '');
    return `sha256:${hash.digest('hex')}`;
  },

  index(input: FrameworkApiAdapterInput): FrameworkApiAdapterResult {
    const files = phpFiles(input.packageDir);
    if (files.length === 0) {
      return {
        indexed: false,
        reason: 'no-types',
        detail: `${input.package}@${input.version} has no readable PHP sources under ${projectRelative(input.projectRoot, input.packageDir)}`,
      };
    }

    const symbols: FrameworkApiSymbol[] = [];
    for (const file of files) {
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
        /* v8 ignore start -- the file was just enumerated, so reading it needs it to vanish mid-build; skipping it keeps the rest of the package indexed instead of failing the whole entry. */
      } catch {
        continue;
      }
      const scan = scanPhpFile(source);
      /* v8 ignore stop */
      for (const declared of scan.classes) {
        symbols.push(...classRecords(scan.namespace, declared));
      }
    }

    return {
      indexed: true,
      sources: [projectRelative(input.projectRoot, input.packageDir)],
      symbols,
    };
  },
};
