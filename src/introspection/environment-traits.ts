import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DetectionSignal } from '@/core/types/health.js';
import type { StackSourceReference } from '@/core/types/introspection.js';

export interface EnvironmentTraitDetection {
  traits: string[];
  sources: StackSourceReference[];
  signals: DetectionSignal[];
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

export function detectEnvironmentTraits(
  projectRoot: string,
  options?: { packageNames?: string[] },
): EnvironmentTraitDetection {
  const packageNames = new Set(options?.packageNames ?? []);
  const traits = new Set<string>();
  const sources: StackSourceReference[] = [];
  const signals: DetectionSignal[] = [];

  for (const file of COMPOSE_FILES) {
    if (existsSync(join(projectRoot, file))) {
      traits.add('compose');
      sources.push({
        file,
        kind: 'config',
        detail: 'Detected docker compose environment from compose configuration',
      });
      signals.push({
        signal: 'compose file exists',
        file,
        implies: 'compose',
        confidence: 'high',
      });
      break;
    }
  }

  const dockerFiles = listDockerIndicators(projectRoot);
  if (dockerFiles.length > 0) {
    traits.add('docker');
    for (const file of dockerFiles) {
      sources.push({
        file,
        kind: 'config',
        detail: 'Detected docker environment from Docker build assets',
      });
      signals.push({
        signal: 'docker build asset exists',
        file,
        implies: 'docker',
        confidence: 'medium',
      });
    }
  }

  if (packageNames.has('laravel/sail')) {
    traits.add('sail');
    sources.push({
      file: 'composer.json',
      kind: 'manifest',
      detail: 'Detected laravel sail from composer dependency',
    });
    signals.push({
      signal: 'composer dependency laravel/sail',
      file: 'composer.json',
      implies: 'sail',
      confidence: 'high',
    });
  } else if (referencesSailBinary(projectRoot)) {
    traits.add('sail');
    sources.push({
      file: detectSailReferenceFile(projectRoot) ?? 'project files',
      kind: 'heuristic',
      detail: 'Detected laravel sail from vendor/bin/sail reference',
    });
    signals.push({
      signal: 'vendor/bin/sail reference found',
      file: detectSailReferenceFile(projectRoot) ?? 'project files',
      implies: 'sail',
      confidence: 'medium',
    });
  }

  return {
    traits: Array.from(traits).sort(),
    sources,
    signals,
  };
}

function listDockerIndicators(projectRoot: string): string[] {
  const indicators: string[] = [];
  const directFiles = ['Dockerfile', 'Dockerfile.dev', 'Dockerfile.prod'];
  for (const file of directFiles) {
    if (existsSync(join(projectRoot, file))) {
      indicators.push(file);
    }
  }

  if (existsSync(join(projectRoot, 'docker'))) {
    indicators.push('docker/');
  }
  if (existsSync(join(projectRoot, '.docker'))) {
    indicators.push('.docker/');
  }

  return indicators;
}

function referencesSailBinary(projectRoot: string): boolean {
  return detectSailReferenceFile(projectRoot) !== null;
}

function detectSailReferenceFile(projectRoot: string): string | null {
  const candidates = ['composer.json', 'package.json'];

  for (const relativePath of candidates) {
    try {
      const content = readFileSync(join(projectRoot, relativePath), 'utf8');
      if (content.includes('vendor/bin/sail')) {
        return relativePath;
      }
    } catch {
      continue;
    }
  }

  return null;
}
