import { join } from 'pathe';

import type { ArtifactType } from './artifact-types.js';

export function resolveCapabilityDirectories(
  runtimeRoot: string,
  stack: string,
  capabilities: string[],
  artifactType: ArtifactType,
): string[] {
  const directoryName = resolveCapabilityArtifactDirectory(artifactType);

  return capabilities.map((capability) =>
    join(
      runtimeRoot,
      'capabilities',
      'coding',
      'stacks',
      stack,
      'capabilities',
      capability,
      directoryName,
    ),
  );
}

function resolveCapabilityArtifactDirectory(artifactType: ArtifactType): string {
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
