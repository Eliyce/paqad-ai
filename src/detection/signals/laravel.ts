import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Capability } from '@/core/types/domain.js';
import type { DetectionSignal } from '@/core/types/health.js';

interface JsonDependencies {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  require?: Record<string, string>;
}

export interface LaravelDetectionResult {
  signals: DetectionSignal[];
  capabilities: Capability[];
}

export function detectLaravelSignals(projectRoot: string): LaravelDetectionResult {
  const signals: DetectionSignal[] = [];
  const capabilities = new Set<Capability>();
  const composerPath = join(projectRoot, 'composer.json');
  const packageJsonPath = join(projectRoot, 'package.json');

  if (existsSync(join(projectRoot, 'artisan'))) {
    signals.push(signal('artisan file exists', 'artisan', 'laravel', 'high'));
  }

  if (existsSync(composerPath)) {
    const composer = readJsonFile(composerPath);
    const dependencies = {
      ...composer.dependencies,
      ...composer.require,
    };

    if (dependencies['laravel/framework'] !== undefined) {
      signals.push(
        signal('composer dependency laravel/framework', 'composer.json', 'laravel', 'high'),
      );
    }

    if (dependencies['inertiajs/inertia-laravel'] !== undefined) {
      capabilities.add('inertia');
      signals.push(
        signal('composer dependency inertiajs/inertia-laravel', 'composer.json', 'inertia', 'high'),
      );
    }

    if (dependencies['laravel/boost'] !== undefined) {
      capabilities.add('boost');
      signals.push(signal('composer dependency laravel/boost', 'composer.json', 'boost', 'high'));
    }

    if (dependencies['laravel/sail'] !== undefined) {
      capabilities.add('sail');
      signals.push(signal('composer dependency laravel/sail', 'composer.json', 'sail', 'high'));
    }
  }

  if (existsSync(join(projectRoot, 'app'))) {
    signals.push(signal('app directory exists', 'app', 'laravel', 'medium'));
  }

  if (existsSync(join(projectRoot, 'routes'))) {
    signals.push(signal('routes directory exists', 'routes', 'laravel', 'medium'));
  }

  if (existsSync(packageJsonPath)) {
    const packageJson = readJsonFile(packageJsonPath);
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (dependencies.react !== undefined) {
      capabilities.add('react');
      signals.push(signal('package dependency react', 'package.json', 'react', 'high'));
    }

    if (dependencies.vue !== undefined) {
      capabilities.add('vue');
      signals.push(signal('package dependency vue', 'package.json', 'vue', 'high'));
    }
  }

  if (existsSync(join(projectRoot, 'resources', 'js', 'App.tsx'))) {
    capabilities.add('react');
    signals.push(signal('React entrypoint found', 'resources/js/App.tsx', 'react', 'high'));
  }

  if (existsSync(join(projectRoot, 'config', 'boost.php'))) {
    capabilities.add('boost');
    signals.push(signal('boost config exists', 'config/boost.php', 'boost', 'high'));
  }

  return {
    signals,
    capabilities: Array.from(capabilities),
  };
}

function readJsonFile(path: string): JsonDependencies {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonDependencies;
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
