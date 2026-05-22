import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Capability } from '@/core/types/domain.js';
import type { DetectionSignal } from '@/core/types/health.js';

interface JsonDependencies {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface SvelteDetectionResult {
  signals: DetectionSignal[];
  capabilities: Capability[];
}

export function detectSvelteSignals(projectRoot: string): SvelteDetectionResult {
  const signals: DetectionSignal[] = [];
  const capabilities = new Set<Capability>();
  const packageJsonPath = join(projectRoot, 'package.json');

  const packageJson = existsSync(packageJsonPath) ? readJsonFile(packageJsonPath) : null;
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  if (dependencies.svelte !== undefined) {
    signals.push(signal('package dependency svelte', 'package.json', 'svelte', 'high'));
  }

  if (dependencies['@sveltejs/kit'] !== undefined) {
    signals.push(signal('package dependency @sveltejs/kit', 'package.json', 'svelte', 'high'));
  }

  if (dependencies['@sveltejs/vite-plugin-svelte'] !== undefined) {
    signals.push(
      signal('package dependency @sveltejs/vite-plugin-svelte', 'package.json', 'svelte', 'high'),
    );
  }

  if (dependencies.tailwindcss !== undefined) {
    capabilities.add('tailwind');
  }

  if (
    existsSync(join(projectRoot, 'svelte.config.js')) ||
    existsSync(join(projectRoot, 'svelte.config.ts'))
  ) {
    signals.push(signal('Svelte config found', 'svelte.config.js', 'svelte', 'high'));
  }

  // SvelteKit file-based routing convention
  if (existsSync(join(projectRoot, 'src', 'routes'))) {
    signals.push(signal('SvelteKit routes directory found', 'src/routes', 'svelte', 'medium'));
  }

  // SvelteKit app shell
  if (existsSync(join(projectRoot, 'src', 'app.html'))) {
    signals.push(signal('SvelteKit app.html found', 'src/app.html', 'svelte', 'medium'));
  }

  if (
    fileIncludes(projectRoot, 'vite.config.ts', '@sveltejs/vite-plugin-svelte') ||
    fileIncludes(projectRoot, 'vite.config.js', '@sveltejs/vite-plugin-svelte')
  ) {
    signals.push(signal('vite config uses Svelte plugin', 'vite.config.ts', 'svelte', 'medium'));
  }

  return {
    signals,
    capabilities: Array.from(capabilities),
  };
}

function readJsonFile(path: string): JsonDependencies {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonDependencies;
}

function fileIncludes(projectRoot: string, relativePath: string, pattern: string): boolean {
  const path = join(projectRoot, relativePath);
  return existsSync(path) && readFileSync(path, 'utf8').includes(pattern);
}

function signal(
  description: string,
  file: string,
  implies: string,
  confidence: DetectionSignal['confidence'],
): DetectionSignal {
  return {
    signal: description,
    file,
    implies,
    confidence,
  };
}
