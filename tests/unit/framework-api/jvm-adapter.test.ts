import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  aggregatedCoordinates,
  jarCandidates,
  jvmFrameworkApiAdapter,
  parseCoordinate,
  versionFromJar,
} from '@/framework-api/adapters/jvm.js';
import { queryFrameworkApi } from '@/framework-api/query.js';
import type { FrameworkApiIndex } from '@/framework-api/types.js';

import { buildClassFile, buildZip, type ClassFixture } from './jar-fixtures.js';

let root: string;
let home: string;

interface JarFixture {
  /** The `version=` line written into the jar pom.properties. */
  version?: string;
  classes?: ClassFixture[];
  /** A sibling `.pom` naming the modules this artifact aggregates. */
  pom?: string;
}

/** Write a jar (and optionally its POM) into the fake Maven repository. */
function installMaven(coordinate: string, version: string, fixture: JarFixture): string {
  const [group, artifact] = coordinate.split(':') as [string, string];
  const dir = join(home, '.m2', 'repository', ...group.split('.'), artifact, version);
  mkdirSync(dir, { recursive: true });
  const jar = join(dir, `${artifact}-${version}.jar`);
  writeFileSync(jar, buildJar(artifact, fixture.version ?? version, fixture.classes ?? []));
  if (fixture.pom !== undefined) {
    writeFileSync(join(dir, `${artifact}-${version}.pom`), fixture.pom);
  }
  return jar;
}

/** Write a jar into the fake Gradle module cache. */
function installGradle(coordinate: string, version: string, fixture: JarFixture): string {
  const [group, artifact] = coordinate.split(':') as [string, string];
  const dir = join(
    home,
    '.gradle',
    'caches',
    'modules-2',
    'files-2.1',
    group,
    artifact,
    version,
    'abc123',
  );
  mkdirSync(dir, { recursive: true });
  const jar = join(dir, `${artifact}-${version}.jar`);
  writeFileSync(jar, buildJar(artifact, fixture.version ?? version, fixture.classes ?? []));
  return jar;
}

function buildJar(artifact: string, version: string, classes: ClassFixture[]): Buffer {
  return buildZip([
    {
      name: `META-INF/maven/com.acme/${artifact}/pom.properties`,
      data: Buffer.from(`groupId=com.acme\nartifactId=${artifact}\nversion=${version}\n`),
    },
    ...classes.map((fixture) => ({
      name: `${fixture.name}.class`,
      data: buildClassFile(fixture),
    })),
  ]);
}

let realHome: string | undefined;
let realProfile: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-framework-api-jvm-'));
  home = mkdtempSync(join(tmpdir(), 'paqad-framework-api-home-'));
  // `os.homedir()` reads HOME on posix and USERPROFILE on Windows, so both are pointed at
  // the fixture — the same cross-platform contract the repo relies on elsewhere.
  realHome = process.env.HOME;
  realProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  expect(os.homedir()).toBe(home);
});

afterEach(() => {
  if (realHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = realHome;
  }
  if (realProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = realProfile;
  }
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('parseCoordinate', () => {
  it('splits a group:artifact coordinate', () => {
    expect(parseCoordinate('org.springframework.boot:spring-boot')).toEqual({
      group: 'org.springframework.boot',
      artifact: 'spring-boot',
    });
  });

  it('rejects anything that is not one', () => {
    expect(parseCoordinate('react')).toBeNull();
    expect(parseCoordinate(':artifact')).toBeNull();
    expect(parseCoordinate('group:')).toBeNull();
  });
});

describe('jarCandidates', () => {
  it('finds jars in both the Maven repository and the Gradle module cache', () => {
    installMaven('com.acme:widget', '1.0.0', {});
    installGradle('com.acme:widget', '2.0.0', {});
    const candidates = jarCandidates({ group: 'com.acme', artifact: 'widget' }, home);
    expect(candidates).toHaveLength(2);
    expect(candidates.some((path) => path.includes('.m2'))).toBe(true);
    expect(candidates.some((path) => path.includes('.gradle'))).toBe(true);
  });

  it('returns nothing when neither cache holds the coordinate', () => {
    expect(jarCandidates({ group: 'com.acme', artifact: 'ghost' }, home)).toEqual([]);
  });
});

describe('versionFromJar', () => {
  it('reads the version Maven stamped into the artifact (FR-4)', () => {
    expect(versionFromJar(buildJar('widget', '3.2.1', []))).toBe('3.2.1');
  });

  it('returns null for a jar with no pom.properties', () => {
    expect(versionFromJar(buildZip([{ name: 'a.txt', data: Buffer.from('a') }]))).toBeNull();
  });

  it('returns null for something that is not a jar', () => {
    expect(versionFromJar(Buffer.from('not a jar'))).toBeNull();
  });

  it('returns null when the pom.properties entry cannot be read', () => {
    const jar = buildZip([
      {
        name: 'META-INF/maven/com.acme/widget/pom.properties',
        data: Buffer.from('version=1.0.0\n'),
        method: 12,
      },
    ]);
    expect(versionFromJar(jar)).toBeNull();
  });

  it('returns null when pom.properties carries no version line', () => {
    const jar = buildZip([
      {
        name: 'META-INF/maven/com.acme/widget/pom.properties',
        data: Buffer.from('groupId=com.acme\n'),
      },
    ]);
    expect(versionFromJar(jar)).toBeNull();
  });
});

describe('aggregatedCoordinates', () => {
  it('reads what a starter POM pulls in', () => {
    expect(
      aggregatedCoordinates(`<project>
  <dependencies>
    <dependency>
      <groupId>com.acme</groupId>
      <artifactId>core</artifactId>
      <version>1.4.0</version>
    </dependency>
  </dependencies>
</project>`),
    ).toEqual(['com.acme:core']);
  });
});

describe('jvmFrameworkApiAdapter.resolveInstalled', () => {
  it('resolves the newest cached artifact and reads its stamped version', () => {
    installMaven('com.acme:widget', '1.0.0', {});
    installMaven('com.acme:widget', '2.0.0', {});
    expect(jvmFrameworkApiAdapter.resolveInstalled(root, 'com.acme:widget')?.version).toBe('2.0.0');
  });

  it('returns null for a coordinate that is in neither cache', () => {
    expect(jvmFrameworkApiAdapter.resolveInstalled(root, 'com.acme:ghost')).toBeNull();
  });

  it('returns null for a package name that is not a coordinate', () => {
    expect(jvmFrameworkApiAdapter.resolveInstalled(root, 'react')).toBeNull();
  });

  it('returns null when the module root does not exist', () => {
    installMaven('com.acme:widget', '1.0.0', {});
    expect(
      jvmFrameworkApiAdapter.resolveInstalled(join(root, 'nope'), 'com.acme:widget'),
    ).toBeNull();
  });

  it('returns null when the module root is a file rather than a directory', () => {
    installMaven('com.acme:widget', '1.0.0', {});
    const file = join(root, 'build.gradle');
    writeFileSync(file, 'plugins {}');
    expect(jvmFrameworkApiAdapter.resolveInstalled(file, 'com.acme:widget')).toBeNull();
  });

  it('skips a cached artifact whose bytes are not a jar', () => {
    const jar = installMaven('com.acme:widget', '1.0.0', {});
    writeFileSync(jar, 'not a jar at all');
    expect(jvmFrameworkApiAdapter.resolveInstalled(root, 'com.acme:widget')).toBeNull();
  });
});

describe('jvmFrameworkApiAdapter.contentHash', () => {
  it('is stable for an unchanged artifact', () => {
    const jar = installMaven('com.acme:widget', '1.0.0', {});
    const input = {
      projectRoot: root,
      searchRoot: root,
      package: 'com.acme:widget',
      version: '1.0.0',
      packageDir: jar,
    };
    expect(jvmFrameworkApiAdapter.contentHash(input)).toBe(
      jvmFrameworkApiAdapter.contentHash(input),
    );
  });

  it('still hashes when the artifact cannot be stat-ed', () => {
    expect(
      jvmFrameworkApiAdapter.contentHash({
        projectRoot: root,
        searchRoot: root,
        package: 'com.acme:widget',
        version: '1.0.0',
        packageDir: join(root, 'missing.jar'),
      }),
    ).toMatch(/^sha256:/);
  });
});

describe('jvmFrameworkApiAdapter.index', () => {
  function indexOf(coordinate: string, version: string) {
    const resolved = jvmFrameworkApiAdapter.resolveInstalled(root, coordinate);
    if (resolved === null) {
      throw new Error(`${coordinate} did not resolve`);
    }
    return jvmFrameworkApiAdapter.index({
      projectRoot: root,
      searchRoot: root,
      package: coordinate,
      version,
      packageDir: resolved.dir,
    });
  }

  it('records classes and their deprecated members (AC-1, AC-2)', () => {
    installMaven('com.acme:widget', '1.0.0', {
      classes: [
        {
          name: 'com/acme/Widget',
          methods: [
            { name: 'legacy', deprecated: { since: '0.9', forRemoval: true } },
            { name: 'go' },
          ],
        },
      ],
    });
    const result = indexOf('com.acme:widget', '1.0.0');
    expect(result.indexed).toBe(true);
    if (!result.indexed) {
      return;
    }
    expect(result.symbols.map((record) => record.name)).toEqual([
      'com.acme.Widget',
      'com.acme.Widget.legacy',
      'com.acme.Widget.*',
    ]);
    expect(result.symbols[1]).toMatchObject({ deprecated: true, since: '0.9', for_removal: true });
    expect(result.sources[0]?.startsWith('~/')).toBe(true);
  });

  it('skips inner classes, which carry no API a plan claims by name', () => {
    installMaven('com.acme:widget', '1.0.0', {
      classes: [{ name: 'com/acme/Widget' }, { name: 'com/acme/Widget$Inner' }],
    });
    const result = indexOf('com.acme:widget', '1.0.0');
    if (!result.indexed) {
      throw new Error('expected an indexed result');
    }
    expect(result.symbols.map((record) => record.name)).not.toContain('com.acme.Widget$Inner');
  });

  it('indexes what an aggregator POM pulls in, rather than reporting an empty starter', () => {
    installMaven('com.acme:core', '1.4.0', { classes: [{ name: 'com/acme/Core' }] });
    installMaven('com.acme:starter', '1.0.0', {
      pom: `<project><dependencies><dependency><groupId>com.acme</groupId><artifactId>core</artifactId><version>1.4.0</version></dependency></dependencies></project>`,
    });
    const result = indexOf('com.acme:starter', '1.0.0');
    expect(result.indexed).toBe(true);
    if (!result.indexed) {
      return;
    }
    expect(result.symbols.map((record) => record.name)).toContain('com.acme.Core');
    expect(result.sources).toHaveLength(2);
  });

  it('blocks a class-free artifact that ships no POM to follow', () => {
    installMaven('com.acme:empty', '1.0.0', {});
    expect(indexOf('com.acme:empty', '1.0.0')).toMatchObject({
      indexed: false,
      reason: 'no-types',
    });
  });

  it('blocks an aggregator whose modules are not cached', () => {
    installMaven('com.acme:starter', '1.0.0', {
      pom: `<project><dependencies><dependency><groupId>com.acme</groupId><artifactId>absent</artifactId><version>1.0.0</version></dependency></dependencies></project>`,
    });
    expect(indexOf('com.acme:starter', '1.0.0')).toMatchObject({
      indexed: false,
      reason: 'not-installed',
    });
  });

  it('blocks an artifact whose bytes cannot be read as a jar', () => {
    const jar = join(root, 'broken.jar');
    writeFileSync(jar, 'not a jar');
    expect(
      jvmFrameworkApiAdapter.index({
        projectRoot: root,
        searchRoot: root,
        package: 'com.acme:widget',
        version: '1.0.0',
        packageDir: jar,
      }),
    ).toMatchObject({ indexed: false, reason: 'parser-unavailable' });
  });

  it('skips an aggregated dependency whose own artifact holds no classes', () => {
    installMaven('com.acme:core', '1.4.0', { classes: [{ name: 'com/acme/Core' }] });
    installMaven('com.acme:hollow', '1.0.0', {});
    installMaven('com.acme:starter', '1.0.0', {
      pom: `<project><dependencies>
        <dependency><groupId>com.acme</groupId><artifactId>hollow</artifactId><version>1.0.0</version></dependency>
        <dependency><groupId>com.acme</groupId><artifactId>core</artifactId><version>1.4.0</version></dependency>
        <dependency><groupId>com.acme</groupId><artifactId>ghost</artifactId><version>9.9.9</version></dependency>
        <dependency><groupId>broken-coordinate</groupId></dependency>
      </dependencies></project>`,
    });
    const result = indexOf('com.acme:starter', '1.0.0');
    if (!result.indexed) {
      throw new Error('expected an indexed result');
    }
    expect(result.sources).toHaveLength(2);
  });
});

describe('the JVM entry answered through the query (AC-4)', () => {
  it('blocks on a deprecated member and warns on an unlisted one', () => {
    installMaven('com.acme:widget', '1.0.0', {
      classes: [
        { name: 'com/acme/Widget', methods: [{ name: 'legacy', deprecated: { since: '0.9' } }] },
      ],
    });
    const resolved = jvmFrameworkApiAdapter.resolveInstalled(root, 'com.acme:widget');
    const result = jvmFrameworkApiAdapter.index({
      projectRoot: root,
      searchRoot: root,
      package: 'com.acme:widget',
      version: '1.0.0',
      packageDir: resolved!.dir,
    });
    if (!result.indexed) {
      throw new Error('expected an indexed result');
    }
    const index: FrameworkApiIndex = {
      schema_version: 1,
      header: { generated_at: '2026-07-26T00:00:00.000Z', schema_version: 1 },
      packages: [
        {
          package: 'com.acme:widget',
          version: '1.0.0',
          ecosystem: 'jvm',
          root: '.',
          content_hash: 'sha256:test',
          sources: result.sources,
          symbols: result.symbols,
        },
      ],
      blocked: [],
    };
    expect(queryFrameworkApi(index, 'com.acme:widget', 'Widget.legacy').verdict).toBe('deprecated');
    expect(queryFrameworkApi(index, 'com.acme:widget', 'com.acme.Widget.whatever').verdict).toBe(
      'unknown-dynamic',
    );
  });
});

describe('jvmFrameworkApiAdapter.index — artifacts that only partly read', () => {
  /** A jar holding entries the class reader cannot use, beside one it can. */
  function mixedJar(): Buffer {
    return buildZip([
      {
        name: 'META-INF/maven/com.acme/mixed/pom.properties',
        data: Buffer.from('version=4.0.0\n'),
      },
      // Not a class file at all: parseClassFile returns null and it is skipped.
      { name: 'com/acme/Garbage.class', data: Buffer.from('not a class file') },
      // Stored with a method the entry reader does not implement: skipped too.
      { name: 'com/acme/Packed.class', data: Buffer.from('whatever'), method: 12 },
      {
        name: 'com/acme/Real.class',
        data: buildClassFile({
          name: 'com/acme/Real',
          classDeprecated: { since: '3.0', forRemoval: true },
        }),
      },
    ]);
  }

  it('keeps the classes it could read and silently skips the ones it could not', () => {
    const jar = join(root, 'mixed.jar');
    writeFileSync(jar, mixedJar());
    const result = jvmFrameworkApiAdapter.index({
      projectRoot: root,
      searchRoot: root,
      package: 'com.acme:mixed',
      version: '4.0.0',
      packageDir: jar,
    });
    expect(result.indexed).toBe(true);
    if (!result.indexed) {
      return;
    }
    expect(result.symbols.map((record) => record.name)).toEqual([
      'com.acme.Real',
      'com.acme.Real.*',
    ]);
    expect(result.symbols[0]).toMatchObject({
      deprecated: true,
      since: '3.0',
      for_removal: true,
      message: 'marked @Deprecated in the installed artifact',
    });
  });

  it('records a jar outside the home directory by its real path', () => {
    const jar = join(root, 'mixed.jar');
    writeFileSync(jar, mixedJar());
    const result = jvmFrameworkApiAdapter.index({
      projectRoot: root,
      searchRoot: root,
      package: 'com.acme:mixed',
      version: '4.0.0',
      packageDir: jar,
    });
    if (!result.indexed) {
      throw new Error('expected an indexed result');
    }
    expect(result.sources[0]?.startsWith('~/')).toBe(false);
  });
});
