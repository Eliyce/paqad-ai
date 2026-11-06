import type { Lane } from '@/core/types/routing.js';
import { foldFeature } from '@/feature-evidence/stage-ledger.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import type { ResolvedDesignSignOff } from '@/git-workflow/types.js';
import { resolveEffectiveLane } from '@/stage-evidence/effective-lane.js';

import { FREEZE_NEXT_LINE, FREEZE_NEXT_V2_LINE } from './copy.js';
import { readHld } from './store.js';

export function designSignOffApplies(config: ResolvedDesignSignOff, lane: Lane | null): boolean {
  return config.enabled && lane !== null && (config.lanes as readonly string[]).includes(lane);
}

export function designSignOffWaits(config: ResolvedDesignSignOff, lane: Lane | null): boolean {
  return designSignOffApplies(config, lane) && config.wait_for_approval;
}

export function loadDesignSignOff(projectRoot: string): ResolvedDesignSignOff {
  return loadGitWorkflow(projectRoot).config.design_sign_off;
}

export function changeLane(projectRoot: string, sessionId: string, dirName: string): Lane {
  return resolveEffectiveLane(
    projectRoot,
    undefined,
    foldFeature(projectRoot, sessionId, dirName).lane,
  );
}

export function freezeNudge(
  projectRoot: string,
  sessionId: string,
  dirName: string,
): string | null {
  if (
    !designSignOffApplies(
      loadDesignSignOff(projectRoot),
      changeLane(projectRoot, sessionId, dirName),
    )
  ) {
    return null;
  }
  return readHld(projectRoot, dirName)?.state === 'changes_requested'
    ? FREEZE_NEXT_V2_LINE
    : FREEZE_NEXT_LINE;
}
