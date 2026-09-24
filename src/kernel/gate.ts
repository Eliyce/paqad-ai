// The Capability Kernel executor (buildout F3 — the host seam).
//
// ONE entry point the host hook (`runtime/hooks/capability-gate.mjs`) calls at a
// lifecycle seam. It iterates the registry's capabilities for that seam, runs each
// folded-in capability's `evaluate()`, and reduces the outcomes to a single
// block/allow decision plus the text to surface. This generalises the
// single-purpose rule-script-enforce path into the shared seam every contract
// will bind through.
//
// Aggregation: any blocking outcome blocks the host (exit 2 on the .mjs side). The
// stderr carries the blocking findings (what the model must fix); stdout carries
// the advisory (warn) findings when nothing blocks. A capability's evaluate may
// throw on an infra error — the gate lets it propagate so the .mjs soft-fails to
// exit 0 (a broken install must never wedge the agent; the verdict is then simply
// "could not run", never a false "all clear").

import { visualEvidenceReminder } from '@/visual-evidence/reminder.js';

import { CAPABILITY_IMPLS, type CapabilityOutcome } from './capability.js';
import { capabilitiesForSeam, type CapabilityPayload, type CapabilitySeam } from './registry.js';

export interface CapabilityGateInput {
  projectRoot: string;
  seam: CapabilitySeam;
  env?: NodeJS.ProcessEnv;
  /** The host tool/turn payload (parsed from stdin by the seam). Passed through to
   *  each capability; most ignore it. Optional so a payload-less call is valid. */
  payload?: CapabilityPayload;
}

export interface CapabilityGateResult {
  /** True when at least one capability returned a blocking outcome. */
  block: boolean;
  /** Findings to surface: the blocking ones when `block`, else the advisory ones.
   *  Empty when no capability reported anything. */
  summary: string;
  /** User-visible `▸ paqad` narration for side-effect work capabilities did during
   *  evaluation (e.g. stage markers recorded to the ledger). Surfaced through the
   *  host's user-message channel independent of block/allow — narration and ledger
   *  are both non-negotiable (issue #307). Empty when there is nothing to narrate. */
  narration: string;
  /** Model-facing, non-blocking context for this edit (issue #579): the first-frontend-edit
   *  visual-evidence reminder. The host appends it to the block reason, or passes it as
   *  additionalContext on the allow path; never a user-facing message. Empty when none. */
  context: string;
}

/**
 * The first-frontend-edit visual-evidence reminder (issue #579), or '' when there is none. It is
 * advisory context only, so a throw anywhere on its path (config, profile, pack registry, session)
 * degrades to no reminder instead of throwing out of the gate and dropping a blocking outcome.
 */
function reminderContext(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  payload: CapabilityPayload | undefined,
): string {
  try {
    return (
      visualEvidenceReminder({
        projectRoot,
        targetPaths: payload?.targetPaths ?? (payload?.targetPath ? [payload.targetPath] : []),
        sessionId: payload?.sessionId ?? env.CLAUDE_SESSION_ID ?? null,
      }) ?? ''
    );
  } catch {
    // Advisory only: the fallback is "no reminder"; the capability verdicts above still stand.
    return '';
  }
}

/**
 * Run every kernel-bound capability registered at `seam` and reduce their outcomes
 * to one gate decision. Capabilities without an impl in CAPABILITY_IMPLS are
 * skipped (they still bind through their legacy path until folded in here).
 */
export async function runCapabilityGate(input: CapabilityGateInput): Promise<CapabilityGateResult> {
  const { projectRoot, seam, env = process.env, payload } = input;
  const outcomes: CapabilityOutcome[] = [];
  const narrations: string[] = [];
  for (const descriptor of capabilitiesForSeam(seam)) {
    const capability = CAPABILITY_IMPLS.get(descriptor.id);
    if (!capability) {
      continue;
    }
    const outcome = await capability.evaluate({ projectRoot, seam, env, payload });
    if (outcome.narration) {
      narrations.push(outcome.narration);
    }
    if (outcome.ran && outcome.summary) {
      outcomes.push(outcome);
    }
  }
  const narration = narrations.join('\n');
  const context = seam === 'pre-mutation' ? reminderContext(projectRoot, env, payload) : '';
  const blocking = outcomes.filter((outcome) => outcome.blocking);
  if (blocking.length > 0) {
    return {
      block: true,
      summary: blocking.map((outcome) => outcome.summary).join('\n'),
      narration,
      context,
    };
  }
  return {
    block: false,
    summary: outcomes.map((outcome) => outcome.summary).join('\n'),
    narration,
    context,
  };
}
