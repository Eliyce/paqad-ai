import { execFileSync } from 'node:child_process';

import { readFeatureDelivery } from '@/feature-evidence/delivery.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';

export const CLOUD_CONTINUATION_NOTE =
  'Evidence starts in this cloud session; earlier steps were recorded on another machine.';

export type GitCount = (projectRoot: string, range: string) => number | null;

function defaultGitCount(projectRoot: string, range: string): number | null {
  try {
    const out = execFileSync('git', ['rev-list', '--count', range], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const count = Number(out.trim());
    return Number.isInteger(count) ? count : null;
  } catch {
    return null;
  }
}

export function cloudContinuationNote(
  projectRoot: string,
  dirName: string | null,
  sessionId: string | null,
  env: NodeJS.ProcessEnv = process.env,
  gitCount: GitCount = defaultGitCount,
): string | null {
  if (env.CLAUDE_CODE_REMOTE?.trim().toLowerCase() !== 'true') return null;
  if (!dirName || !sessionId) return null;
  const feature = readFeatureRecord(projectRoot, dirName);
  if (!feature || feature.session_id !== sessionId) return null;
  const delivery = readFeatureDelivery(projectRoot, dirName);
  const start = delivery.start_commit;
  const base = delivery.base_branch ?? feature.base_branch;
  if (!start || !base) return null;
  const count =
    gitCount(projectRoot, `${base}..${start}`) ?? gitCount(projectRoot, `origin/${base}..${start}`);
  return count !== null && count > 0 ? CLOUD_CONTINUATION_NOTE : null;
}
