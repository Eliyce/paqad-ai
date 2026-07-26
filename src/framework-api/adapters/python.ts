// The Python framework-API adapter (issue #398).
//
// Version comes from the installed distribution's own `dist-info/METADATA`, which is what
// pip wrote when it installed the wheel — never a `requirements.txt` constraint (FR-3).
// The surface comes from the package's `__init__.py` (and any `.pyi` stub beside a module,
// which is the typed declaration layer when one ships).
//
// The research note names Python's `ast` module for this, and `ast` needs a Python runtime
// this Node CLI cannot assume — the same reason the PHP adapter does not shell out to
// nikic/PHP-Parser. What is read here is therefore the declaration LINES, and the read is
// shaped so its limits cannot fabricate an absence: EVERY module carries a wildcard, which
// is strictly more conservative than detecting PEP 562 `__getattr__` modules alone, so an
// attribute this scan did not enumerate reads `unknown-dynamic`, never `absent` (INV-1).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readDeprecation } from '../deprecation.js';
import type {
  FrameworkApiAdapter,
  FrameworkApiAdapterInput,
  FrameworkApiAdapterResult,
  FrameworkApiSymbol,
} from '../types.js';

import { dynamicRecord, projectRelative } from './shared.js';

/** Where a virtualenv puts its packages, relative to the project root. */
const SITE_PACKAGES_ROOTS = [
  ['.venv', 'lib'],
  ['venv', 'lib'],
  ['env', 'lib'],
  ['site-packages'],
];

/** `Version: 3.1.2` in a wheel's METADATA. */
const METADATA_VERSION_PATTERN = /^Version:[ \t]*(.+)$/m;

/** `__all__ = ["a", "b"]`, across lines. */
const DUNDER_ALL_PATTERN = /^__all__\s*(?::[^=]+)?=\s*[[(]([\s\S]*?)[\])]/m;

/** A quoted name inside an `__all__` list. */
const QUOTED_NAME_PATTERN = /['"]([A-Za-z_]\w*)['"]/g;

/** A module-level `def` / `async def` / `class`, with the decorators above it. */
const DECLARATION_PATTERN =
  /^((?:@[^\n]*\n)*)(?:async[ \t]+)?(def|class)[ \t]+(\w+)/gm;

/** PEP 702: `@deprecated("…")`, optionally namespaced (`typing_extensions.deprecated`). */
const PEP702_PATTERN = /@(?:[\w.]+\.)?deprecated\s*\(\s*(?:['"]([^'"]*)['"])?/;

/** `warnings.warn("…", DeprecationWarning)` in a body, in either argument order. */
const DEPRECATION_WARNING_PATTERN =
  /warn\s*\(\s*(?:f?['"]([^'"]*)['"])?[\s\S]{0,160}?DeprecationWarning/;

/** Read a file, or null when it is missing or unreadable. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The distribution directory name pip writes for `packageName`, e.g. `flask-3.1.2.dist-info`.
 * Matched case- and separator-insensitively because a distribution named `Flask` installs as
 * `flask` and one named `typing-extensions` as `typing_extensions`.
 */
function normalizeDistName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '_');
}

/** Every directory that can hold installed distributions under `searchRoot`. */
function sitePackagesDirs(searchRoot: string): string[] {
  const roots: string[] = [];
  for (const segments of SITE_PACKAGES_ROOTS) {
    const base = join(searchRoot, ...segments);
    if (!existsSync(base)) {
      continue;
    }
    if (segments[segments.length - 1] === 'site-packages') {
      roots.push(base);
      continue;
    }
    // A virtualenv nests under `lib/python3.X/site-packages`; the minor version is the
    // interpreter's, so the directory is discovered rather than guessed.
    let versionDirs: string[] = [];
    try {
      versionDirs = readdirSync(base);
    } catch {
      /* v8 ignore next 2 -- `base` exists and was just listed; unreadable needs a race. */
      continue;
    }
    for (const versionDir of versionDirs) {
      const candidate = join(base, versionDir, 'site-packages');
      if (existsSync(candidate)) {
        roots.push(candidate);
      }
    }
  }
  return roots;
}

/** The `<dist>-<ver>.dist-info` directory for a package, with the version it records. */
function findDistInfo(
  searchRoot: string,
  packageName: string,
): { siteDir: string; distInfo: string; version: string } | null {
  const wanted = normalizeDistName(packageName);
  for (const siteDir of sitePackagesDirs(searchRoot)) {
    let entries: string[];
    try {
      entries = readdirSync(siteDir);
      /* v8 ignore next 3 -- the dir was just proven to exist; unreadable needs a race. */
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.dist-info')) {
        continue;
      }
      const base = entry.slice(0, -'.dist-info'.length);
      const dash = base.lastIndexOf('-');
      if (dash === -1 || normalizeDistName(base.slice(0, dash)) !== wanted) {
        continue;
      }
      const distInfo = join(siteDir, entry);
      const metadata = readText(join(distInfo, 'METADATA'));
      // The METADATA `Version:` field is the authority; the directory name only locates it.
      const version = metadata === null ? null : (METADATA_VERSION_PATTERN.exec(metadata)?.[1] ?? null);
      if (version !== null) {
        return { siteDir, distInfo, version: version.trim() };
      }
    }
  }
  return null;
}

/** The import package directory for a distribution (`flask` for `Flask`), if it ships one. */
function importPackageDir(siteDir: string, packageName: string): string | null {
  const candidates = [packageName, packageName.replace(/-/g, '_'), normalizeDistName(packageName)];
  for (const candidate of candidates) {
    const dir = join(siteDir, candidate);
    try {
      if (statSync(dir).isDirectory()) {
        return dir;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** The names a module's `__all__` declares, or an empty list when it declares none. */
export function readDunderAll(source: string): string[] {
  const block = DUNDER_ALL_PATTERN.exec(source)?.[1];
  if (block === undefined) {
    return [];
  }
  return [...block.matchAll(QUOTED_NAME_PATTERN)].map((match) => match[1] as string);
}

/**
 * The deprecation tags a Python declaration carries: a PEP 702 `@deprecated("…")` decorator
 * first (the typed, tool-readable form), then a `warnings.warn(…, DeprecationWarning)` in
 * the body. Shaped as JSDoc tags so {@link readDeprecation} normalizes them, exactly as the
 * node and PHP adapters do.
 */
export function pythonDeprecationTags(
  decorators: string,
  body: string,
): { name: string; text?: { text: string }[] }[] {
  const pep702 = PEP702_PATTERN.exec(decorators);
  if (pep702 !== null) {
    return [{ name: 'deprecated', text: [{ text: pep702[1] ?? '' }] }];
  }
  const warned = DEPRECATION_WARNING_PATTERN.exec(body);
  if (warned !== null) {
    return [{ name: 'deprecated', text: [{ text: warned[1] ?? '' }] }];
  }
  return [];
}

/** The body of a declaration: everything up to the next top-level declaration. */
function bodyFrom(source: string, start: number): string {
  const next = source.slice(start).search(/^(?:@|async[ \t]+def|def|class)\b/m);
  return next === -1 ? source.slice(start) : source.slice(start, start + next);
}

/**
 * The records one module contributes: its top-level `def`s and `class`es, each carrying
 * whatever deprecation marker it declared, plus the module's wildcard.
 */
export function moduleRecords(moduleName: string, source: string): FrameworkApiSymbol[] {
  const exported = new Set(readDunderAll(source));
  const records: FrameworkApiSymbol[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(DECLARATION_PATTERN)) {
    const name = match[3];
    if (name === undefined || match.index === undefined || name.startsWith('_')) {
      continue;
    }
    // An `__all__` is an explicit public surface: honour it when the module declares one.
    if (exported.size > 0 && !exported.has(name)) {
      continue;
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const deprecation = readDeprecation(
      pythonDeprecationTags(match[1] ?? '', bodyFrom(source, match.index + match[0].length)),
    );
    records.push({
      name: `${moduleName}.${name}`,
      kind: match[2] === 'class' ? 'class' : 'function',
      exists: true,
      deprecated: deprecation.deprecated,
      message: deprecation.message,
      since: deprecation.since,
      for_removal: deprecation.for_removal,
      provenance: 'asserted',
    });
  }

  // A name in `__all__` that no visible declaration backs is re-exported from a submodule.
  // It exists — the module promises it — but this scan cannot say where from, so it is
  // recorded as existing rather than dropped into a silent absence.
  for (const name of exported) {
    if (!seen.has(name)) {
      records.push({
        name: `${moduleName}.${name}`,
        kind: 'unknown',
        exists: true,
        deprecated: false,
        message: null,
        since: null,
        for_removal: false,
        provenance: 'asserted',
      });
    }
  }
  records.push(dynamicRecord(moduleName));
  return records;
}

export const pythonFrameworkApiAdapter: FrameworkApiAdapter = {
  ecosystem: 'python',

  resolveInstalled(searchRoot, packageName) {
    const dist = findDistInfo(searchRoot, packageName);
    if (dist === null) {
      return null;
    }
    const dir = importPackageDir(dist.siteDir, packageName) ?? dist.siteDir;
    return { dir, version: dist.version };
  },

  /**
   * Content-address the declaration inputs: package + resolved version + the bytes of the
   * module's own declaration entry. Within one published wheel those bytes are immutable,
   * so an equal hash means an equal surface and the stored entry is reused (FR-13 of #397).
   */
  contentHash(input: FrameworkApiAdapterInput): string {
    const hash = createHash('sha256').update(`${input.package}@${input.version}`);
    for (const entry of ['__init__.pyi', '__init__.py']) {
      const source = readText(join(input.packageDir, entry));
      if (source !== null) {
        hash.update(source);
        break;
      }
    }
    return `sha256:${hash.digest('hex')}`;
  },

  index(input: FrameworkApiAdapterInput): FrameworkApiAdapterResult {
    // A `.pyi` stub beside the module is the typed declaration layer and wins when present,
    // exactly as a `.d.ts` wins over JS in the node adapter.
    const entries: { file: string; source: string }[] = [];
    for (const name of ['__init__.pyi', '__init__.py']) {
      const source = readText(join(input.packageDir, name));
      if (source !== null) {
        entries.push({ file: join(input.packageDir, name), source });
        break;
      }
    }
    if (entries.length === 0) {
      return {
        indexed: false,
        reason: 'no-types',
        detail: `${input.package}@${input.version} ships no importable module at ${projectRelative(input.projectRoot, input.packageDir)}`,
      };
    }

    const moduleName = input.package.replace(/-/g, '_');
    const symbols: FrameworkApiSymbol[] = [];
    for (const entry of entries) {
      symbols.push(...moduleRecords(moduleName, entry.source));
    }

    return {
      indexed: true,
      sources: entries.map((entry) => projectRelative(input.projectRoot, entry.file)),
      symbols,
    };
  },
};
