import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Capability } from '@/core/types/domain.js';
import type { DetectionSignal } from '@/core/types/health.js';

interface JsonDependencies {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface VueDetectionResult {
  signals: DetectionSignal[];
  capabilities: Capability[];
}

export function detectVueSignals(projectRoot: string): VueDetectionResult {
  const signals: DetectionSignal[] = [];
  const capabilities = new Set<Capability>();
  const packageJsonPath = join(projectRoot, 'package.json');

  const packageJson = existsSync(packageJsonPath) ? readJsonFile(packageJsonPath) : null;
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  if (dependencies.vue !== undefined) {
    signals.push(signal('package dependency vue', 'package.json', 'vue', 'high'));
  }

  if (dependencies.nuxt !== undefined) {
    capabilities.add('nuxt');
    signals.push(signal('package dependency nuxt', 'package.json', 'vue', 'high'));
  }

  if (dependencies.quasar !== undefined || dependencies['@quasar/app-vite'] !== undefined) {
    capabilities.add('quasar');
    signals.push(signal('Quasar dependency detected', 'package.json', 'vue', 'high'));
  }

  if (dependencies['@vitejs/plugin-vue'] !== undefined) {
    capabilities.add('vite-spa');
    signals.push(signal('package dependency @vitejs/plugin-vue', 'package.json', 'vue', 'high'));
  }

  if (dependencies['vue-router'] !== undefined) {
    signals.push(signal('package dependency vue-router', 'package.json', 'vue', 'medium'));
  }

  if (dependencies.pinia !== undefined || dependencies.vuex !== undefined) {
    signals.push(signal('Vue state library detected', 'package.json', 'vue', 'medium'));
  }

  if (dependencies.tailwindcss !== undefined) {
    capabilities.add('tailwind');
  }

  if (existsSync(join(projectRoot, 'src', 'App.vue'))) {
    signals.push(signal('Vue App entrypoint found', 'src/App.vue', 'vue', 'high'));
  }

  if (
    existsSync(join(projectRoot, 'nuxt.config.ts')) ||
    existsSync(join(projectRoot, 'nuxt.config.js'))
  ) {
    capabilities.add('nuxt');
    signals.push(signal('Nuxt config found', 'nuxt.config.ts', 'vue', 'high'));
  }

  if (
    fileIncludes(projectRoot, 'vite.config.ts', 'pluginVue') ||
    fileIncludes(projectRoot, 'vite.config.ts', '@vitejs/plugin-vue')
  ) {
    capabilities.add('vite-spa');
    signals.push(signal('vite config uses Vue plugin', 'vite.config.ts', 'vue', 'medium'));
  }

  if (
    capabilities.size === 0 &&
    (fileIncludes(projectRoot, 'vite.config.ts', 'vite') ||
      dependencies.vite !== undefined ||
      dependencies['@vitejs/plugin-vue'] !== undefined)
  ) {
    capabilities.add('vite-spa');
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
