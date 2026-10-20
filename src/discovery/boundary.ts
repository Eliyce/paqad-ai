import { readWorkflowState } from '@/pipeline/workflow-state.js';

import { readDiscoveryRun } from './run-store.js';
import { isKnownDiscoveryStage } from './stages.js';

export function activeDiscoveryRunForSession(
  projectRoot: string,
  sessionId: string,
): string | null {
  const state = readWorkflowState(projectRoot, sessionId);
  if (state.active?.workflow !== 'discovery') {
    return null;
  }
  return state.active.discoveryRunId ?? null;
}

export function isDiscoverySession(projectRoot: string, sessionId: string): boolean {
  return readWorkflowState(projectRoot, sessionId).active?.workflow === 'discovery';
}

export function ownsDiscoveryRun(projectRoot: string, sessionId: string, dirName: string): boolean {
  if (activeDiscoveryRunForSession(projectRoot, sessionId) !== dirName) {
    return false;
  }
  return readDiscoveryRun(projectRoot, dirName)?.session_id === sessionId;
}

export type DiscoveryBoundaryReason =
  | 'not-discovery-session'
  | 'no-active-run'
  | 'foreign-run'
  | 'unknown-stage'
  | 'source-mutation-blocked'
  | 'applicable';

export interface DiscoveryBoundaryInput {
  projectRoot: string;
  sessionId: string;
  action: 'stage' | 'artifact' | 'source-mutation' | 'read';
  runDirName?: string;
  stage?: string;
}

export interface DiscoveryBoundaryVerdict {
  applicable: boolean;
  block: boolean;
  reason: DiscoveryBoundaryReason;
  detail: string;
}

export function discoveryBoundaryVerdict(input: DiscoveryBoundaryInput): DiscoveryBoundaryVerdict {
  if (!isDiscoverySession(input.projectRoot, input.sessionId)) {
    return {
      applicable: false,
      block: false,
      reason: 'not-discovery-session',
      detail: 'the session is not on the Discovery workflow; the Discovery gate does not apply',
    };
  }

  if (input.action === 'read') {
    return {
      applicable: true,
      block: false,
      reason: 'applicable',
      detail: 'read is always allowed',
    };
  }

  if (input.action === 'source-mutation') {
    return {
      applicable: true,
      block: true,
      reason: 'source-mutation-blocked',
      detail:
        'Discovery is a no-code workflow: a source edit is out of its boundary. Hand off to ' +
        'feature-development to implement. This block is scoped to this Discovery session only.',
    };
  }

  const activeRun = activeDiscoveryRunForSession(input.projectRoot, input.sessionId);
  if (activeRun === null) {
    return {
      applicable: true,
      block: true,
      reason: 'no-active-run',
      detail: 'the Discovery session has no active run; start or resume one first',
    };
  }

  if (input.runDirName !== undefined && input.runDirName !== activeRun) {
    return {
      applicable: true,
      block: true,
      reason: 'foreign-run',
      detail: `action targets run ${input.runDirName}, but the session owns ${activeRun}`,
    };
  }

  if (
    input.action === 'stage' &&
    input.stage !== undefined &&
    !isKnownDiscoveryStage(input.stage)
  ) {
    return {
      applicable: true,
      block: true,
      reason: 'unknown-stage',
      detail: `${input.stage} is not one of the six Discovery stages`,
    };
  }

  return { applicable: true, block: false, reason: 'applicable', detail: 'action is in boundary' };
}
