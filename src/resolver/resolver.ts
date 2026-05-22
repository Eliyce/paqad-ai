import fg from 'fast-glob';
import { basename, extname, relative } from 'pathe';

import type { ResolvedArtifact, ResolvedArtifacts } from '@/core/types/resolution.js';
import type { RoutingConfig } from '@/core/types/routing.js';

import {
  ARTIFACT_OUTPUT_KEYS,
  ARTIFACT_TYPES,
  COLLISION_MAP,
  type ArtifactType,
} from './artifact-types.js';
import { type ContextDeduplicator } from './deduplicator.js';
import { getInheritanceDirectories } from './inheritance.js';

const RULE_SEED_PRIORITY = [
  'constitution',
  'security',
  'pentest',
  'design-system',
  'content-rules',
  'testing',
  'documentation',
  'performance',
  'pipeline',
  'canonical-docs',
  'architecture',
  'code-quality',
  'git',
  'api-design',
  'environment',
  'foundation',
  'conventions',
  'inertia',
  'react',
  'vue',
  'tailwind',
  'boost',
] as const;

export interface ResolverOptions {
  runtimeRoot: string;
}

export class Resolver {
  readonly runtimeRoot: string;

  constructor(options: ResolverOptions) {
    this.runtimeRoot = options.runtimeRoot;
  }

  async resolve(
    routing: RoutingConfig,
    deduplicator?: ContextDeduplicator,
  ): Promise<ResolvedArtifacts> {
    const result: ResolvedArtifacts = {
      rules: [],
      skills: [],
      agents: [],
      hooks: [],
      templates: [],
      patterns: [],
      antiPatterns: [],
      checklists: [],
      mcpConfigs: [],
    };

    for (const artifactType of ARTIFACT_TYPES) {
      const outputKey = ARTIFACT_OUTPUT_KEYS[artifactType];
      const resolved = await this.resolveArtifactType(routing, artifactType);

      if (deduplicator) {
        const dedupArtifacts = resolved.map((a: ResolvedArtifact) => ({
          path: a.path,
          type: artifactType,
        }));
        const { artifacts: deduplicated } = await deduplicator.deduplicate(
          this.runtimeRoot,
          dedupArtifacts,
        );
        const resolvedByPath = new Map(resolved.map((a: ResolvedArtifact) => [a.path, a]));
        result[outputKey] = deduplicated
          .map((a) => resolvedByPath.get(a.path))
          .filter((a): a is ResolvedArtifact => a !== undefined);
      } else {
        result[outputKey] = resolved;
      }
    }

    return result;
  }

  async resolveArtifactType(
    routing: RoutingConfig,
    artifactType: ArtifactType,
  ): Promise<ResolvedArtifact[]> {
    const directories = getInheritanceDirectories(this.runtimeRoot, routing, artifactType);
    const entries: ResolvedArtifact[] = [];
    const overrides = new Map<string, ResolvedArtifact>();

    for (const directory of directories) {
      const files = await fg('**/*', {
        cwd: directory.path,
        onlyFiles: true,
        absolute: true,
        dot: false,
      });

      for (const file of files.sort()) {
        const artifact: ResolvedArtifact = {
          path: file,
          level: directory.level,
          source: relative(this.runtimeRoot, file),
        };

        if (COLLISION_MAP[artifactType] === 'additive-merge') {
          entries.push(artifact);
          continue;
        }

        overrides.set(relative(directory.path, file), artifact);
      }
    }

    const resolved =
      COLLISION_MAP[artifactType] === 'additive-merge' ? entries : Array.from(overrides.values());

    if (artifactType === 'rules') {
      return resolved.sort(compareRuleSeedOrder);
    }

    return resolved;
  }
}

function compareRuleSeedOrder(left: ResolvedArtifact, right: ResolvedArtifact): number {
  const leftPriority = getRulePriority(left.path);
  const rightPriority = getRulePriority(right.path);

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.source.localeCompare(right.source);
}

function getRulePriority(filePath: string): number {
  const name = basename(filePath, extname(filePath));
  const index = RULE_SEED_PRIORITY.indexOf(name as (typeof RULE_SEED_PRIORITY)[number]);

  return index === -1 ? RULE_SEED_PRIORITY.length : index;
}
