// When the HUD snapshot is rewritten (issue #639, Part 7).
//
// The snapshot is refreshed at the end of the paqad verbs that move a change and of the hooks
// that record it. Both paths come through `refreshHudSnapshot`, which stands down exactly where
// the HUD itself stands down (decision 5): a project that was never onboarded (no
// `.paqad/framework-path.txt`, the #636 signal) or a disabled paqad writes nothing at all.
// It never throws, so it can never change a hook's decision or a verb's exit code.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { isFrameworkEnabledForRoot } from '@/core/framework-enabled.js';

import { writeHudSnapshotSafe } from './snapshot.js';

/**
 * The verbs whose end refreshes the snapshot, as space-joined command paths. A path matches
 * when it equals one of these or starts with one followed by a space (so `spec pipeline
 * experts` covers `record`, `notes` and `synthesis`).
 */
export const HUD_REFRESH_VERBS: readonly string[] = [
  'decision create',
  'decision resolve',
  'rules load',
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
];

export function isHudRefreshVerb(commandPath: string): boolean {
  return HUD_REFRESH_VERBS.some(
    (verb) => commandPath === verb || commandPath.startsWith(`${verb} `),
  );
}

/** Refresh the snapshot when this project shows a HUD at all. Returns the written path or null. */
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
