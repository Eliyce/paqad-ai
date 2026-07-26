// The PHP / Laravel framework-API adapter (issue #398).
//
// Same three steps as the node adapter, against a different declaration layer: resolve the
// version composer actually installed, read the declarations that ship in `vendor/`, and
// normalize `{exists, deprecated, message, since, for_removal, provenance}`.
//
// Two Laravel-specific facts shape what gets stored. Facades resolve through
// `__callStatic`, so reflection would report only `__callStatic` — but every facade carries
// `@method static … name(...)` docblocks written precisely for tooling, and those are read
// as the facade's real members (AC-3). And Laravel tags deprecations sparsely: a real
// v13.18.0 install carries 39 `@deprecated` docblocks and zero `#[\Deprecated]` attributes
// across the whole framework, which is why the version-pinned Upgrade Guide is wired in as
// the `doc-derived` backstop (see `laravel-upgrade-guide.ts`).

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

/** One entry of composer's installed-package manifest, narrowed to what is needed here. */
interface ComposerInstalledEntry {
  name?: string;
  version?: string;
  version_normalized?: string;
  'install-path'?: string;
  dist?: { reference?: string };
}

/**
 * How many `.php` files one package is scanned for. Laravel's framework ships ~2,000, all
 * of which are read; the cap only exists so a pathological vendor tree cannot turn an index
 * build into an unbounded walk (AC-7 of Phase B). A package past the cap keeps every class
 * it did read, and each of those still carries its wildcard, so nothing reads absent that
 * was merely not reached — the package's blocked-free entry simply covers less.
 */
const MAX_FILES = 6000;

/** Directories that never hold a package's own declarations. */
const SKIPPED_DIRS = new Set(['tests', 'test', 'node_modules', 'vendor', '.git', 'stubs']);

/** Composer writes `v13.18.0`; a plan writes `13.18.0`. Store the plain form. */
export function normalizeComposerVersion(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

/** Read and parse a JSON file, or null when it is missing or malformed. */
function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * The installed entry for `packageName` under `searchRoot`.
 *
 * `vendor/composer/installed.json` is the authority: it records what composer actually put
 * on disk, including the `install-path` for a package installed somewhere other than
 * `vendor/<name>`. `composer.lock` is the fallback for a lockfile-only checkout, and a
 * `composer.json` constraint is never consulted — a range is not a version (FR-2).
 */
function findInstalledEntry(
  searchRoot: string,
  packageName: string,
): { entry: ComposerInstalledEntry; dir: string } | null {
  const composerDir = join(searchRoot, 'vendor', 'composer');
  const installed = readJson<{ packages?: ComposerInstalledEntry[] } | ComposerInstalledEntry[]>(
    join(composerDir, 'installed.json'),
  );
  // composer 1 wrote a bare array; composer 2 wraps it in `{ packages, dev }`.
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

/** Every `.php` file under `dir`, breadth-bounded by {@link MAX_FILES}. */
function phpFiles(dir: string): string[] {
  const found: string[] = [];
  const queue = [dir];
  while (queue.length > 0 && found.length < MAX_FILES) {
    const current = queue.shift() as string;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
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

/** A record for a symbol that resolved, carrying whatever deprecation it declared. */
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

/**
 * The records one scanned class contributes.
 *
 * The class itself is stored under its fully-qualified name, which the segment-aware
 * matcher answers for both `Str` and `Illuminate\Support\Str`. Members follow the node
 * adapter's shape: only the DEPRECATED ones are stored, plus the facade members a
 * `@method` docblock promises, plus the container's wildcard — so a member this scan never
 * saw reads `unknown-dynamic`, never `absent` (INV-1).
 */
export function classRecords(namespace: string | null, declared: PhpClass): FrameworkApiSymbol[] {
  const qualified = namespace === null ? declared.name : `${namespace}\\${declared.name}`;
  const records: FrameworkApiSymbol[] = [
    assertedRecord(qualified, declared.kind, phpDeprecationTags(declared)),
  ];

  for (const method of declared.methods) {
    const record = assertedRecord(`${qualified}::${method.name}`, 'member', phpDeprecationTags(method));
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
      // Recorded in the lockfile but absent from `vendor/` — the builder reports
      // `not-installed`, which is the honest answer after a `composer.json` edit with no
      // install, rather than an entry built from nothing.
      return null;
    }
    return { dir: found.dir, version: normalizeComposerVersion(found.entry.version as string) };
  },

  /**
   * Content-address the declaration inputs. Composer records an immutable `dist.reference`
   * (the source commit) for every installed package, so package + version + reference is
   * exactly "these bytes"; a package installed from a path repository with no reference
   * falls back to package + version, which still invalidates on every version change.
   */
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
        /* v8 ignore next 4 -- the file was just enumerated, so reading it needs it to vanish mid-build; skipping it keeps the rest of the package indexed instead of failing the whole entry. */
      } catch {
        continue;
      }
      const scan = scanPhpFile(source);
      for (const declared of scan.classes) {
        symbols.push(...classRecords(scan.namespace, declared));
      }
    }

    // The source list names the tree that was read, not its ~2,000 files: the index is a
    // read artifact, and a per-file list would dwarf the records it is meant to explain.
    return {
      indexed: true,
      sources: [projectRelative(input.projectRoot, input.packageDir)],
      symbols,
    };
  },
};
