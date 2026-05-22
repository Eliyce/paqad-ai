import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import type { DetectionSignal } from '@/core/types/health.js';

export function detectShortVideoSignals(projectRoot: string): DetectionSignal[] {
  const profilePath = join(projectRoot, '.paqad', 'project-profile.yaml');
  const markerPath = join(projectRoot, '.short-video-project');
  const signals: DetectionSignal[] = [];

  if (existsSync(profilePath)) {
    const profile = parse(readFileSync(profilePath, 'utf8')) as {
      routing?: { domain?: string; stack?: string };
      stack_profile?: { frameworks?: string[] };
    };

    if (
      profile.routing?.domain === 'content' &&
      (profile.stack_profile?.frameworks?.includes('short-video') ||
        profile.routing.stack === 'short-video')
    ) {
      signals.push({
        signal: 'project profile declares content/short-video',
        file: '.paqad/project-profile.yaml',
        implies: 'short-video',
        confidence: 'high',
      });
    }
  }

  if (existsSync(markerPath)) {
    signals.push({
      signal: 'short-video marker file exists',
      file: '.short-video-project',
      implies: 'short-video',
      confidence: 'medium',
    });
  }

  return signals;
}
