import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Capability } from '@/core/types/domain.js';
import type { DetectionSignal } from '@/core/types/health.js';

interface JsonDependencies {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface ReactDetectionResult {
  signals: DetectionSignal[];
  capabilities: Capability[];
}

export function detectReactSignals(projectRoot: string): ReactDetectionResult {
  const signals: DetectionSignal[] = [];
  const capabilities = new Set<Capability>();
  const packageJsonPath = join(projectRoot, 'package.json');

  const packageJson = existsSync(packageJsonPath) ? readJsonFile(packageJsonPath) : null;
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  if (dependencies.react !== undefined) {
    signals.push(signal('package dependency react', 'package.json', 'react', 'high'));
  }

  if (dependencies['react-dom'] !== undefined) {
    signals.push(signal('package dependency react-dom', 'package.json', 'react', 'high'));
  }

  if (dependencies.next !== undefined) {
    capabilities.add('next');
    signals.push(signal('package dependency next', 'package.json', 'react', 'high'));
  }

  if (dependencies.remix !== undefined || dependencies['@remix-run/react'] !== undefined) {
    capabilities.add('remix');
    signals.push(signal('Remix dependency detected', 'package.json', 'react', 'high'));
  }

  if (dependencies.gatsby !== undefined) {
    capabilities.add('gatsby');
    signals.push(signal('package dependency gatsby', 'package.json', 'react', 'high'));
  }

  if (dependencies.tailwindcss !== undefined) {
    capabilities.add('tailwind');
  }

  if (dependencies['@vitejs/plugin-react'] !== undefined) {
    capabilities.add('vite-spa');
    signals.push(
      signal('package dependency @vitejs/plugin-react', 'package.json', 'react', 'medium'),
    );
  }

  if (fileIncludes(projectRoot, 'vite.config.ts', '@vitejs/plugin-react')) {
    capabilities.add('vite-spa');
    signals.push(
      signal('vite config uses @vitejs/plugin-react', 'vite.config.ts', 'react', 'medium'),
    );
  }

  if (
    existsSync(join(projectRoot, 'src', 'App.tsx')) ||
    existsSync(join(projectRoot, 'src', 'App.jsx'))
  ) {
    signals.push(signal('React App entrypoint found', 'src/App.tsx', 'react', 'medium'));
  }

  if (
    existsSync(join(projectRoot, 'src', 'main.tsx')) ||
    existsSync(join(projectRoot, 'src', 'index.tsx')) ||
    existsSync(join(projectRoot, 'src', 'main.jsx')) ||
    existsSync(join(projectRoot, 'src', 'index.jsx'))
  ) {
    signals.push(signal('React main entrypoint found', 'src/main.tsx', 'react', 'low'));
  }

  if (
    fileIncludes(projectRoot, 'tsconfig.json', '"jsx"') &&
    fileIncludes(projectRoot, 'tsconfig.json', 'react-jsx')
  ) {
    signals.push(
      signal('tsconfig jsx runtime set to react-jsx', 'tsconfig.json', 'react', 'medium'),
    );
  }

  if (
    hasAnyExistingFile(projectRoot, [
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
    ])
  ) {
    const eslintFile = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json'].find(
      (file) => existsSync(join(projectRoot, file)),
    );
    if (eslintFile && fileIncludes(projectRoot, eslintFile, 'react')) {
      signals.push(signal('ESLint React plugin configuration found', eslintFile, 'react', 'low'));
    }
  }

  if (
    capabilities.size === 0 &&
    (fileIncludes(projectRoot, 'vite.config.ts', 'vite') ||
      dependencies.vite !== undefined ||
      dependencies['@vitejs/plugin-react'] !== undefined)
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

function hasAnyExistingFile(projectRoot: string, candidates: string[]): boolean {
  return candidates.some((candidate) => existsSync(join(projectRoot, candidate)));
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
