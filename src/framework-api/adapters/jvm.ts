import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { toPosixPath } from '@/core/path-utils.js';
import { jvmParser } from '@/introspection/ecosystems/jvm.js';

import type {
  FrameworkApiAdapter,
  FrameworkApiAdapterInput,
  FrameworkApiAdapterResult,
  FrameworkApiSymbol,
} from '../types.js';

import { parseClassFile } from './class-file.js';
import { readZipDirectory, readZipEntry } from './jar.js';
import { dynamicRecord } from './shared.js';

const POM_VERSION_PATTERN = /^version=(.+)$/m;

const MAX_CLASSES = 4000;

export function parseCoordinate(coordinate: string): { group: string; artifact: string } | null {
  const parts = coordinate.split(':');
  if (parts.length < 2 || parts[0] === '' || parts[1] === '') {
    return null;
  }
  return { group: parts[0] as string, artifact: parts[1] as string };
}

export function jarCandidates(
  coordinate: { group: string; artifact: string },
  home: string,
): string[] {
  const found: string[] = [];

  const mavenDir = join(
    home,
    '.m2',
    'repository',
    ...coordinate.group.split('.'),
    coordinate.artifact,
  );
  for (const version of listDirs(mavenDir)) {
    const jar = join(mavenDir, version, `${coordinate.artifact}-${version}.jar`);
    if (existsSync(jar)) {
      found.push(jar);
    }
  }

  const gradleDir = join(
    home,
    '.gradle',
    'caches',
    'modules-2',
    'files-2.1',
    coordinate.group,
    coordinate.artifact,
  );
  for (const version of listDirs(gradleDir)) {
    const versionDir = join(gradleDir, version);
    for (const hashDir of listDirs(versionDir)) {
      const jar = join(versionDir, hashDir, `${coordinate.artifact}-${version}.jar`);
      if (existsSync(jar)) {
        found.push(jar);
      }
    }
  }

  return found.sort();
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function versionFromJar(buffer: Buffer): string | null {
  const directory = readZipDirectory(buffer);
  if (directory === null) {
    return null;
  }
  const entry = directory.find(
    (candidate) =>
      candidate.name.startsWith('META-INF/maven/') && candidate.name.endsWith('/pom.properties'),
  );
  if (entry === undefined) {
    return null;
  }
  const bytes = readZipEntry(buffer, entry);
  if (bytes === null) {
    return null;
  }
  return POM_VERSION_PATTERN.exec(bytes.toString('utf8'))?.[1]?.trim() ?? null;
}

function readJar(path: string): Buffer | null {
  try {
    return readFileSync(path);
    /* v8 ignore next 3 -- every caller passes a path an existsSync or statSync hit just proved, so reaching this needs the artifact to vanish mid-build. */
  } catch {
    return null;
  }
}

function resolveJar(coordinate: {
  group: string;
  artifact: string;
}): { path: string; version: string } | null {
  for (const candidate of [...jarCandidates(coordinate, homedir())].reverse()) {
    const buffer = readJar(candidate);
    /* v8 ignore next 3 -- readJar only fails on a path that existed a moment ago; an unreadable candidate is skipped rather than failing the whole resolve. */
    if (buffer === null) {
      continue;
    }
    const version = versionFromJar(buffer);
    if (version !== null) {
      return { path: candidate, version };
    }
  }
  return null;
}

export function aggregatedCoordinates(pomXml: string): string[] {
  return jvmParser
    .parseManifest(pomXml, 'pom.xml')
    .packages.filter((entry) => !entry.isDev)
    .map((entry) => entry.name);
}

function siblingPom(jarPath: string): string | null {
  try {
    return readFileSync(jarPath.replace(/\.jar$/, '.pom'), 'utf8');
  } catch {
    return null;
  }
}

function classRecords(
  className: string,
  parsed: NonNullable<ReturnType<typeof parseClassFile>>,
): FrameworkApiSymbol[] {
  const records: FrameworkApiSymbol[] = [
    {
      name: className,
      kind: 'class',
      exists: true,
      deprecated: parsed.deprecated,
      message: parsed.deprecated ? 'marked @Deprecated in the installed artifact' : null,
      since: parsed.since,
      for_removal: parsed.for_removal,
      provenance: 'asserted',
    },
  ];
  for (const member of parsed.members) {
    if (!member.deprecated) {
      continue;
    }
    records.push({
      name: `${className}.${member.name}`,
      kind: 'member',
      exists: true,
      deprecated: true,
      message: 'marked @Deprecated in the installed artifact',
      since: member.since,
      for_removal: member.for_removal,
      provenance: 'asserted',
    });
  }
  records.push(dynamicRecord(className));
  return records;
}

export const jvmFrameworkApiAdapter: FrameworkApiAdapter = {
  ecosystem: 'jvm',

  resolveInstalled(searchRoot, packageName) {
    const coordinate = parseCoordinate(packageName);
    if (coordinate === null) {
      return null;
    }
    try {
      if (!statSync(searchRoot).isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }
    const jar = resolveJar(coordinate);
    return jar === null ? null : { dir: jar.path, version: jar.version };
  },

  contentHash(input: FrameworkApiAdapterInput): string {
    const hash = createHash('sha256').update(`${input.package}@${input.version}`);
    try {
      const stats = statSync(input.packageDir);
      hash.update(`${stats.size}:${stats.mtimeMs}`);
      /* v8 ignore next 3 -- the jar was just read by resolveInstalled; this needs a race. */
    } catch {
      hash.update('unstat');
    }
    return `sha256:${hash.digest('hex')}`;
  },

  index(input: FrameworkApiAdapterInput): FrameworkApiAdapterResult {
    const own = indexJar(input.packageDir);
    if (own === null) {
      return {
        indexed: false,
        reason: 'parser-unavailable',
        detail: `${input.package}@${input.version} is not a jar this reader understands (zip64, unreadable, or a non-zip artifact)`,
      };
    }
    if (own.classes > 0) {
      return { indexed: true, sources: [cachePath(input.packageDir)], symbols: own.symbols };
    }

    const pom = siblingPom(input.packageDir);
    if (pom === null) {
      return {
        indexed: false,
        reason: 'no-types',
        detail: `${input.package}@${input.version} contains no classes and ships no POM to resolve what it aggregates`,
      };
    }

    const symbols: FrameworkApiSymbol[] = [];
    const sources: string[] = [cachePath(input.packageDir)];
    for (const dependency of aggregatedCoordinates(pom).slice(0, MAX_AGGREGATED)) {
      const coordinate = parseCoordinate(dependency);
      /* v8 ignore next 3 -- the ecosystem parser only ever emits `group:artifact`, so this cannot trip today; it keeps a future parser change from indexing a malformed coordinate. */
      if (coordinate === null) {
        continue;
      }
      const jar = resolveJar(coordinate);
      if (jar === null) {
        continue;
      }
      const aggregated = indexJar(jar.path);
      if (aggregated === null || aggregated.classes === 0) {
        continue;
      }
      sources.push(cachePath(jar.path));
      symbols.push(...aggregated.symbols);
    }

    if (symbols.length === 0) {
      return {
        indexed: false,
        reason: 'not-installed',
        detail: `${input.package}@${input.version} aggregates other modules, none of which are in the local Maven or Gradle cache — run your build once so they resolve`,
      };
    }
    return { indexed: true, sources, symbols };
  },
};

const MAX_AGGREGATED = 12;

function indexJar(jarPath: string): { symbols: FrameworkApiSymbol[]; classes: number } | null {
  const buffer = readJar(jarPath);
  /* v8 ignore next 3 -- readJar returns null only for a path that existed moments earlier. */
  if (buffer === null) {
    return null;
  }
  const directory = readZipDirectory(buffer);
  if (directory === null) {
    return null;
  }
  const symbols: FrameworkApiSymbol[] = [];
  let classes = 0;
  for (const entry of directory) {
    if (!entry.name.endsWith('.class') || entry.name.includes('$')) {
      continue;
    }
    /* v8 ignore next 3 -- the cap only bites on a jar with more than 4,000 top-level classes; a fixture that large would dominate the suite's runtime to prove a bound. */
    if (classes >= MAX_CLASSES) {
      break;
    }
    const bytes = readZipEntry(buffer, entry);
    if (bytes === null) {
      continue;
    }
    const parsed = parseClassFile(bytes);
    if (parsed === null) {
      continue;
    }
    classes += 1;
    symbols.push(...classRecords(parsed.name.replace(/\//g, '.'), parsed));
  }
  return { symbols, classes };
}

function cachePath(jarPath: string): string {
  const home = homedir();
  return toPosixPath(jarPath.startsWith(home) ? `~${jarPath.slice(home.length)}` : jarPath);
}
