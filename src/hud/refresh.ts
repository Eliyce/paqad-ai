import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { isFrameworkEnabledForRoot } from '@/core/framework-enabled.js';

import { writeHudSnapshotSafe } from './snapshot.js';

export const HUD_REFRESH_VERBS: readonly string[] = [
  'decision create',
  'decision resolve',
  'rules load',
  'rules override',
  'lane set',
  'route set',
  'stage',
  'plan compile',
  'spec pipeline experts',
  'spec freeze',
  'review record',
  'checks run',
  'delivery-link',
  'deliver',
  'debt add',
  'debt promote',
  'debt close',
];

export function isHudRefreshVerb(commandPath: string): boolean {
  return HUD_REFRESH_VERBS.some(
    (verb) => commandPath === verb || commandPath.startsWith(`${verb} `),
  );
}

export function refreshHudSnapshot(
  projectRoot: string,
  sessionHint: string | null,
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  try {
    if (!existsSync(join(projectRoot, PATHS.FRAMEWORK_PATH))) return null;
    if (!isFrameworkEnabledForRoot(projectRoot, env)) return null;
  } catch {
    return null;
  }
  return writeHudSnapshotSafe(projectRoot, sessionHint, source);
}
