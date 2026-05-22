import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import type { DetectionSignal } from '@/core/types/health.js';

export function detectFlutterSignals(projectRoot: string): DetectionSignal[] {
  const pubspecPath = join(projectRoot, 'pubspec.yaml');

  if (!existsSync(pubspecPath)) {
    return [];
  }

  const pubspec = parse(readFileSync(pubspecPath, 'utf8')) as {
    dependencies?: Record<string, unknown>;
  };

  if (pubspec.dependencies?.flutter === undefined) {
    return [];
  }

  return [
    {
      signal: 'pubspec.yaml declares flutter dependency',
      file: 'pubspec.yaml',
      implies: 'flutter',
      confidence: 'high',
    },
  ];
}
