import { join } from 'node:path';

import type { StackSnapshot } from '@/core/types/introspection.js';
import { buildDetectedStackProfile } from '@/core/stack-profile.js';
import { prefixRepositoryPath, discoverRepositoryContext } from '@/repository/discovery.js';

import { StackSnapshotCache } from './cache.js';
import { createDefaultEcosystemParserRegistry } from './ecosystems/registry.js';
import { detectEnvironmentTraits } from './environment-traits.js';

export class StackIntrospector {
  private readonly cache = new StackSnapshotCache();
  private readonly parserRegistry = createDefaultEcosystemParserRegistry();

  /**
   * Build a stack snapshot for `projectRoot`.
   *
   * @param options.persist When `false`, the freshly computed snapshot is **not** written to
   *   the on-disk cache (`.paqad/`). Defaults to `true` (the historical behaviour). Read-only
   *   callers such as the onboarding dry-run preview (PQD-103) pass `false` so the snapshot can
   *   be computed without touching disk. The cache is still *read* either way.
   */
  async snapshot(projectRoot: string, options: { persist?: boolean } = {}): Promise<StackSnapshot> {
    const persist = options.persist ?? true;
    const repository = await discoverRepositoryContext(projectRoot);
    const candidateRoots = repository.projects.map((project) => project.root);
    const currentHashes = await this.cache.hashFiles(
      projectRoot,
      buildRepositoryHashInputs(candidateRoots, this.parserRegistry.getKnownFiles()),
    );
    const cached = await this.cache.read(projectRoot);

    if (cached !== null && JSON.stringify(cached.source_hashes) === JSON.stringify(currentHashes)) {
      return cached;
    }

    const toolchains: StackSnapshot['toolchains'] = [];
    const packages: StackSnapshot['packages'] = [];
    const environmentSources: StackSnapshot['profile']['sources'] = [];
    const environmentTraits = new Set<string>();

    for (const project of repository.projects) {
      const absoluteRoot = project.root === '.' ? projectRoot : join(projectRoot, project.root);
      const results = await this.parserRegistry.parseProject(absoluteRoot);

      for (const result of results) {
        toolchains.push({
          ...result.toolchain,
          lockfile: prefixRepositoryPath(project.root, result.toolchain.lockfile),
        });
        packages.push(
          ...result.packages.map((pkg) => ({
            ...pkg,
            root: project.root,
          })),
        );
      }

      const packageNames = packages
        .filter((pkg) => pkg.root === project.root)
        .map((pkg) => pkg.name);
      const environment = detectEnvironmentTraits(absoluteRoot, { packageNames });
      for (const trait of environment.traits) {
        environmentTraits.add(trait);
      }
      environmentSources.push(
        ...environment.sources.map((source) => ({
          ...source,
          file: prefixRepositoryPath(project.root, source.file),
        })),
      );
    }

    const hashedSources = Object.keys(currentHashes)
      .sort()
      .map((file) => ({
        file,
        kind: classifySourceKind(file),
        detail:
          classifySourceKind(file) === 'config'
            ? 'Used for environment trait detection'
            : 'Used for stack detection and version resolution',
      }));
    const sources = dedupeSources([...hashedSources, ...environmentSources]);
    const snapshot: StackSnapshot = {
      generated_at: new Date().toISOString(),
      source_hashes: currentHashes,
      toolchains: dedupeToolchains(toolchains),
      packages,
      profile: buildDetectedStackProfile({
        toolchains: dedupeToolchains(toolchains),
        packages,
        sources,
        detectedTraits: Array.from(environmentTraits).sort(),
      }),
      repository,
    };

    if (persist) {
      await this.cache.write(projectRoot, snapshot);
    }

    return snapshot;
  }
}

function buildRepositoryHashInputs(candidateRoots: string[], knownFiles: string[]): string[] {
  const inputs = new Set<string>();
  const extraFiles = [
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
    'Dockerfile',
    'Dockerfile.dev',
    'Dockerfile.prod',
    'docker',
    '.docker',
  ];

  for (const root of candidateRoots.length > 0 ? candidateRoots : ['.']) {
    for (const file of [...knownFiles, ...extraFiles]) {
      inputs.add(prefixRepositoryPath(root, file));
    }
  }

  return Array.from(inputs).sort();
}

function dedupeToolchains(toolchains: StackSnapshot['toolchains']): StackSnapshot['toolchains'] {
  const seen = new Set<string>();

  return toolchains.filter((toolchain) => {
    const key = `${toolchain.ecosystem}:${toolchain.package_manager}:${toolchain.lockfile}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function classifySourceKind(file: string): 'manifest' | 'lockfile' | 'config' {
  if (file.endsWith('.lock') || file.includes('lock')) {
    return 'lockfile';
  }

  if (
    file === 'docker-compose.yml' ||
    file === 'docker-compose.yaml' ||
    file === 'compose.yml' ||
    file === 'compose.yaml' ||
    file === 'Dockerfile' ||
    file === 'Dockerfile.dev' ||
    file === 'Dockerfile.prod' ||
    file === 'docker' ||
    file === '.docker'
  ) {
    return 'config';
  }

  return 'manifest';
}

function dedupeSources(
  sources: Array<{
    file: string;
    kind: 'manifest' | 'lockfile' | 'config' | 'heuristic' | 'fallback';
    detail: string;
  }>,
): typeof sources {
  const seen = new Set<string>();

  return sources.filter((source) => {
    const key = `${source.file}:${source.kind}:${source.detail}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
