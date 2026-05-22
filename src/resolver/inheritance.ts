import { join, relative } from 'pathe';

import { getPrimaryStack } from '@/core/stack-profile.js';
import type { ActiveCapability } from '@/core/types/domain.js';
import type { RoutingConfig } from '@/core/types/routing.js';

import type { ArtifactType } from './artifact-types.js';
import { resolveCapabilityDirectories } from './capability-resolver.js';

export interface InheritanceDirectory {
  path: string;
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  source: string;
}

export function getInheritanceDirectories(
  runtimeRoot: string,
  routing: RoutingConfig,
  artifactType: ArtifactType,
): InheritanceDirectory[] {
  if (artifactType === 'hooks') {
    return [
      {
        path: join(runtimeRoot, 'hooks'),
        level: 0,
        source: relative(runtimeRoot, join(runtimeRoot, 'hooks')),
      },
    ];
  }

  if (artifactType === 'templates') {
    return [
      {
        path: join(runtimeRoot, 'templates'),
        level: 0,
        source: relative(runtimeRoot, join(runtimeRoot, 'templates')),
      },
    ];
  }

  const directoryName = resolveArtifactDirectoryName(artifactType);
  const activeCapabilities = deriveActiveCapabilities(routing);
  const matchedPacks = deriveMatchedPacks(routing);
  const traits = deriveTraits(routing);
  const directories: InheritanceDirectory[] = [
    {
      path: join(runtimeRoot, 'base', directoryName),
      level: 0,
      source: relative(runtimeRoot, join(runtimeRoot, 'base', directoryName)),
    },
    {
      path: join(runtimeRoot, 'capabilities', 'content', directoryName),
      level: 1,
      source: relative(runtimeRoot, join(runtimeRoot, 'capabilities', 'content', directoryName)),
    },
  ];

  if (activeCapabilities.includes('coding')) {
    directories.push(
      {
        path: join(runtimeRoot, 'capabilities', 'coding', directoryName),
        level: 2,
        source: relative(runtimeRoot, join(runtimeRoot, 'capabilities', 'coding', directoryName)),
      },
      {
        path: join(runtimeRoot, 'capabilities', 'coding', 'stacks', '_shared', directoryName),
        level: 3,
        source: relative(
          runtimeRoot,
          join(runtimeRoot, 'capabilities', 'coding', 'stacks', '_shared', directoryName),
        ),
      },
      ...matchedPacks.map((pack, index) => ({
        path: join(runtimeRoot, 'capabilities', 'coding', 'stacks', pack, directoryName),
        level: (4 + Math.min(index, 1)) as 4 | 5,
        source: relative(
          runtimeRoot,
          join(runtimeRoot, 'capabilities', 'coding', 'stacks', pack, directoryName),
        ),
      })),
      ...matchedPacks.flatMap((pack) =>
        resolveCapabilityDirectories(runtimeRoot, pack, traits, artifactType).map((path) => ({
          path,
          level: 5 as const,
          source: relative(runtimeRoot, path),
        })),
      ),
    );
  }

  if (activeCapabilities.includes('security')) {
    directories.push({
      path: join(runtimeRoot, 'capabilities', 'security', directoryName),
      level: 6,
      source: relative(runtimeRoot, join(runtimeRoot, 'capabilities', 'security', directoryName)),
    });
  }

  return directories;
}

function deriveActiveCapabilities(routing: RoutingConfig): ActiveCapability[] {
  if (Array.isArray(routing.active_capabilities) && routing.active_capabilities.length > 0) {
    return routing.active_capabilities;
  }

  if (routing.domain === 'coding') {
    return ['content', 'coding', 'security'];
  }

  return ['content'];
}

function deriveMatchedPacks(routing: RoutingConfig): string[] {
  if (Array.isArray(routing.matched_packs) && routing.matched_packs.length > 0) {
    return routing.matched_packs;
  }

  if (
    Array.isArray(routing.stack_profile?.frameworks) &&
    routing.stack_profile.frameworks.length > 0
  ) {
    return routing.stack_profile.frameworks;
  }

  if (typeof routing.stack === 'string') {
    return [routing.stack];
  }

  return [getPrimaryStack(routing)];
}

function deriveTraits(routing: RoutingConfig): string[] {
  if (Array.isArray(routing.capabilities)) {
    return routing.capabilities;
  }

  return routing.stack_profile?.traits ?? [];
}

function resolveArtifactDirectoryName(artifactType: ArtifactType): string {
  switch (artifactType) {
    case 'mcp-configs':
      return 'mcp';
    case 'patterns':
      return join('benchmarks', 'patterns');
    case 'anti-patterns':
      return join('benchmarks', 'anti-patterns');
    default:
      return artifactType;
  }
}
