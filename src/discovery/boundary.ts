// Discovery workflow boundary + ownership (issue #597).
//
// The DECISION layer for Discovery isolation (DW-09, DW-10): given a SESSION's own state, it decides
// whether a Discovery gate applies to an action and which run (if any) that session owns. It returns
// not-applicable for a non-Discovery session, so a Discovery gate built on it can never enforce a
// Discovery checklist on — or block — a feature-development or project-question session (INV-4).
//
// WIRING STATUS (honest): this is the decision function a Discovery native hook will call; wiring it
// into the shared host-hook chain (a `PreToolUse`/`Stop` handler that consults `discoveryBoundaryVerdict`
// and `validateDiscoveryArtifact`) is a follow-up under #596. Until then these functions have no
// runtime caller other than the CLI, so the boundary is NOT yet an enforced pre-mutation gate — it is
// tested decision logic ready to be wired. Isolation still holds by absence (with no active gate there
// is nothing to leak), and the per-session design below is what keeps it correct once wired.
//
// Ownership is proven ONLY by the session's own workflow-state anchor plus the run's own owner
// stamp — never a repo-level active pointer, the latest directory, or a cache-read id (INV-5). A
// session with no Discovery anchor owns no run here, full stop.

import { readWorkflowState } from '@/pipeline/workflow-state.js';

import { readDiscoveryRun } from './run-store.js';
import { isKnownDiscoveryStage } from './stages.js';

/** The run dir name the session is actively on, or null when it is not on a Discovery run. */
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

/** True when the session's ACTIVE workflow is Discovery. */
export function isDiscoverySession(projectRoot: string, sessionId: string): boolean {
  return readWorkflowState(projectRoot, sessionId).active?.workflow === 'discovery';
}

/**
 * Whether `sessionId` owns `dirName`: the session must be actively on that exact run AND the run's
 * own `run.json` owner must be that session. Both conditions come from the session's own state and
 * the run record — no borrowed or cached identity. A run whose owner differs (e.g. before a
 * validated ownership transfer) is NOT owned here.
 */
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
  /** The action a hook is about to take: a stage boundary, an artifact write, or a source edit. */
  action: 'stage' | 'artifact' | 'source-mutation' | 'read';
  /** The run the action targets (for stage/artifact actions), if any. */
  runDirName?: string;
  /** The stage the action targets (for a stage action), if any. */
  stage?: string;
}

export interface DiscoveryBoundaryVerdict {
  /** True when a Discovery gate should act on this action; false = not-applicable (return silently). */
  applicable: boolean;
  /** True when the action must be blocked (a Discovery-scoped block, never a cross-workflow one). */
  block: boolean;
  reason: DiscoveryBoundaryReason;
  detail: string;
}

/**
 * Resolve, from the session's own state, whether the Discovery boundary applies to an action and
 * whether it must block. The contract:
 *
 *  - A NON-Discovery session ⇒ `applicable: false` (the Discovery gate does nothing; it never
 *    enforces a Discovery checklist on a feature-dev / project-question session — DW-09).
 *  - A Discovery session attempting a SOURCE mutation ⇒ blocked, but scoped to THIS session only
 *    (Discovery is a no-code workflow — DW-10). It never blocks a legitimate feature session.
 *  - A stage/artifact action on a run the session does not own ⇒ blocked as `foreign-run`.
 *  - A read is always allowed (an unrelated read-only question stays usable — DW-15/AC-8).
 */
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
