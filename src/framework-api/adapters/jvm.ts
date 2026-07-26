// The Java / Spring framework-API adapter (issue #398).
//
// The JVM is the one ecosystem here whose install tree is NOT in the project: Maven and
// Gradle resolve artifacts into per-user caches (`~/.m2/repository`,
// `~/.gradle/caches/modules-2`). So `searchRoot` locates the build file that declares the
// coordinate, and the artifact itself is looked up in those caches — read-only, and only
// ever for a coordinate the project's own snapshot declared (INV-3, INV-5).
//
// A coordinate is `group:artifact`, matching what the JVM ecosystem parser already emits
// from `pom.xml` and `build.gradle` (src/introspection/ecosystems/jvm.ts).

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

/** `version=3.5.0` in a jar's `META-INF/maven/**​/pom.properties`. */
const POM_VERSION_PATTERN = /^version=(.+)$/m;

/**
 * How many classes one jar contributes records for. spring-core alone ships ~2,800; the cap
 * keeps a fat uber-jar from dominating the index. Classes past it still get a wildcard from
 * their package, so nothing reads absent merely because it was not reached (INV-1).
 */
const MAX_CLASSES = 4000;

/** A `group:artifact` coordinate split into its parts, or null when it is not one. */
export function parseCoordinate(coordinate: string): { group: string; artifact: string } | null {
  const parts = coordinate.split(':');
  if (parts.length < 2 || parts[0] === '' || parts[1] === '') {
    return null;
  }
  return { group: parts[0] as string, artifact: parts[1] as string };
}

/** The candidate jar paths for a coordinate, newest-version-last, across both caches. */
export function jarCandidates(
  coordinate: { group: string; artifact: string },
  home: string,
): string[] {
  const found: string[] = [];

  // Maven: ~/.m2/repository/<group as path>/<artifact>/<version>/<artifact>-<version>.jar
  const mavenDir = join(home, '.m2', 'repository', ...coordinate.group.split('.'), coordinate.artifact);
  for (const version of listDirs(mavenDir)) {
    const jar = join(mavenDir, version, `${coordinate.artifact}-${version}.jar`);
    if (existsSync(jar)) {
      found.push(jar);
    }
  }

  // Gradle: ~/.gradle/caches/modules-2/files-2.1/<group>/<artifact>/<version>/<sha1>/<jar>
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

/** The subdirectories of `dir`, or an empty list when it does not exist. */
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

/** The version Maven stamped into the jar, read from its own `pom.properties` (FR-4). */
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

/** Read a jar off disk, or null when it cannot be read. */
function readJar(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    /* v8 ignore next 2 -- the path came from an existsSync hit, so this needs a race. */
    return null;
  }
}

/**
 * The jar that answers for this coordinate, and the version IT stamps on itself.
 *
 * When several versions are cached the newest by sort order wins, and the version comes
 * from the jar's own `pom.properties` rather than from its directory name (FR-4) — so the
 * index always records the version of the artifact it actually read, and `sources` names
 * the exact jar it read it from.
 */
function resolveJar(coordinate: {
  group: string;
  artifact: string;
}): { path: string; version: string } | null {
  for (const candidate of [...jarCandidates(coordinate, homedir())].reverse()) {
    const buffer = readJar(candidate);
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

/**
 * The coordinates an aggregator POM pulls in.
 *
 * Spring's `*-starter-*` artifacts ship a jar with no classes: they exist to pull other
 * modules in. Indexing one and stopping would record "no classes here" for the single most
 * common Spring dependency a project declares, so its sibling `.pom` is read and the
 * modules it aggregates are indexed instead. The POM is parsed by the SAME jvm ecosystem
 * parser stack detection already uses, rather than a second `<dependency>` regex (RULE-13).
 */
export function aggregatedCoordinates(pomXml: string): string[] {
  return jvmParser
    .parseManifest(pomXml, 'pom.xml')
    .packages.filter((entry) => !entry.isDev)
    .map((entry) => entry.name);
}

/** The `.pom` beside a resolved jar, or null when it is absent. */
function siblingPom(jarPath: string): string | null {
  try {
    return readFileSync(jarPath.replace(/\.jar$/, '.pom'), 'utf8');
  } catch {
    return null;
  }
}

/** The records one class contributes: the class, its deprecated members, its wildcard. */
function classRecords(className: string, parsed: NonNullable<ReturnType<typeof parseClassFile>>): FrameworkApiSymbol[] {
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
    // `searchRoot` must still be a real module root — a coordinate declared nowhere is not
    // this project's dependency, whatever happens to sit in the user's caches.
    try {
      if (!statSync(searchRoot).isDirectory()) {
        return null;
      }
      /* v8 ignore next 3 -- searchRoot is the project root the builder just walked. */
    } catch {
      return null;
    }
    const jar = resolveJar(coordinate);
    return jar === null ? null : { dir: jar.path, version: jar.version };
  },

  /**
   * Content-address the artifact: coordinate + resolved version + the jar's size and mtime.
   * A published jar is immutable, so this changes only when the resolved artifact does.
   */
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

    // No classes: this is an aggregator (a Spring `*-starter-*` or a BOM). Index what it
    // pulls in, so the coordinate a project actually declares still answers for the API it
    // gives that project.
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

/** How many of an aggregator's dependencies are followed. Bounds a fat BOM's fan-out. */
const MAX_AGGREGATED = 12;

/** One jar's records, or null when the artifact could not be read at all. */
function indexJar(jarPath: string): { symbols: FrameworkApiSymbol[]; classes: number } | null {
  const buffer = readJar(jarPath);
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
    // Inner and anonymous classes carry no API a plan would claim by name.
    if (!entry.name.endsWith('.class') || entry.name.includes('$')) {
      continue;
    }
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

/**
 * A cached artifact's path with the home directory folded to `~`, in the repo's
 * posix-everywhere form. The jar lives outside the project, so a project-relative path
 * would be a wall of `../` — and the index is read by people, not only by the query.
 */
function cachePath(jarPath: string): string {
  const home = homedir();
  return toPosixPath(jarPath.startsWith(home) ? `~${jarPath.slice(home.length)}` : jarPath);
}
