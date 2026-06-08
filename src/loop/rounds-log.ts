import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  BUILD_CHECK_FIX_ROUNDS_SCHEMA_VERSION,
  type BuildCheckFixOutcome,
  type BuildCheckFixRoundsLog,
} from '@/core/types/build-check-fix.js';

// Issue #108 — the internal rounds log. Persisted for the agent's own stop
// decision and for debugging; it is never surfaced round-by-round to the
// person. Lives alongside the per-round verification evidence.
export const BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH = '.paqad/session/build-check-fix-rounds.json';

export function buildRoundsLog(
  outcome: BuildCheckFixOutcome,
  updatedAt: string,
): BuildCheckFixRoundsLog {
  return {
    schema_version: BUILD_CHECK_FIX_ROUNDS_SCHEMA_VERSION,
    lane: outcome.lane,
    status: outcome.status,
    max_rounds: outcome.max_rounds,
    rounds_used: outcome.rounds_used,
    updated_at: updatedAt,
    rounds: outcome.rounds,
    stuck_report: outcome.stuck_report,
  };
}

export interface WriteBuildCheckFixRoundsLogOptions {
  project_root: string;
}

export async function writeBuildCheckFixRoundsLog(
  log: BuildCheckFixRoundsLog,
  options: WriteBuildCheckFixRoundsLogOptions,
): Promise<string> {
  const targetPath = join(options.project_root, BUILD_CHECK_FIX_ROUNDS_RELATIVE_PATH);
  await mkdir(dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const payload = `${JSON.stringify(log, null, 2)}\n`;
  await writeFile(tempPath, payload, 'utf8');
  await rename(tempPath, targetPath);

  return targetPath;
}
