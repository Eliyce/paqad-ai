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

const SITE_PACKAGES_ROOTS = [['.venv', 'lib'], ['venv', 'lib'], ['env', 'lib'], ['site-packages']];

const METADATA_VERSION_PATTERN = /^Version:[ \t]*(.+)$/m;

const DUNDER_ALL_PATTERN = /^__all__\s*(?::[^=]+)?=\s*[[(]([\s\S]*?)[\])]/m;

const QUOTED_NAME_PATTERN = /['"]([A-Za-z_]\w*)['"]/g;

const DECLARATION_PATTERN = /^((?:@[^\n]*\n)*)(?:async[ \t]+)?(def|class)[ \t]+(\w+)/gm;

const PEP702_PATTERN = /@(?:[\w.]+\.)?deprecated\s*\(\s*(?:['"]([^'"]*)['"])?/;

const DEPRECATION_WARNING_PATTERN =
  /warn\s*\(\s*(?:f?['"]([^'"]*)['"])?[\s\S]{0,160}?DeprecationWarning/;

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function normalizeDistName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '_');
}

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
    let versionDirs: string[];
    try {
      versionDirs = readdirSync(base);
      /* v8 ignore start -- `base` was just proven to exist; an unreadable one needs a race. */
    } catch {
      continue;
    }
    /* v8 ignore stop */
    for (const versionDir of versionDirs) {
      const candidate = join(base, versionDir, 'site-packages');
      if (existsSync(candidate)) {
        roots.push(candidate);
      }
    }
  }
  return roots;
}

function findDistInfo(
  searchRoot: string,
  packageName: string,
): { siteDir: string; distInfo: string; version: string } | null {
  const wanted = normalizeDistName(packageName);
  for (const siteDir of sitePackagesDirs(searchRoot)) {
    let entries: string[];
    try {
      entries = readdirSync(siteDir);
      /* v8 ignore start -- the dir was just proven to exist; unreadable needs a race. */
    } catch {
      continue;
    }
    /* v8 ignore stop */
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
      const version =
        metadata === null ? null : (METADATA_VERSION_PATTERN.exec(metadata)?.[1] ?? null);
      if (version !== null) {
        return { siteDir, distInfo, version: version.trim() };
      }
    }
  }
  return null;
}

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

export function readDunderAll(source: string): string[] {
  const block = DUNDER_ALL_PATTERN.exec(source)?.[1];
  if (block === undefined) {
    return [];
  }
  return [...block.matchAll(QUOTED_NAME_PATTERN)].map((match) => match[1] as string);
}

export function pythonDeprecationTags(
  decorators: string,
  body: string,
): { name: string; text?: { text: string }[] }[] {
  const pep702 = PEP702_PATTERN.exec(decorators);
  if (pep702 !== null) {
    /* v8 ignore next -- a bare `@deprecated()` with no message still matches with an empty group. */
    return [{ name: 'deprecated', text: [{ text: pep702[1] ?? '' }] }];
  }
  const warned = DEPRECATION_WARNING_PATTERN.exec(body);
  if (warned !== null) {
    /* v8 ignore next -- same: the message group participates even when empty. */
    return [{ name: 'deprecated', text: [{ text: warned[1] ?? '' }] }];
  }
  return [];
}

function bodyFrom(source: string, start: number): string {
  const next = source.slice(start).search(/^(?:@|async[ \t]+def|def|class)\b/m);
  return next === -1 ? source.slice(start) : source.slice(start, start + next);
}

export function moduleRecords(moduleName: string, source: string): FrameworkApiSymbol[] {
  const exported = new Set(readDunderAll(source));
  const records: FrameworkApiSymbol[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(DECLARATION_PATTERN)) {
    const name = match[3];
    if (name === undefined || match.index === undefined || name.startsWith('_')) {
      continue;
    }
    if (exported.size > 0 && !exported.has(name)) {
      continue;
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const deprecation = readDeprecation(
      /* v8 ignore next -- the decorator group is always present, empty when there are none. */
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
