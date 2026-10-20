import { visualEvidenceReminder } from '@/visual-evidence/reminder.js';

import { CAPABILITY_IMPLS, type CapabilityOutcome } from './capability.js';
import { capabilitiesForSeam, type CapabilityPayload, type CapabilitySeam } from './registry.js';

export interface CapabilityGateInput {
  projectRoot: string;
  seam: CapabilitySeam;
  env?: NodeJS.ProcessEnv;
  payload?: CapabilityPayload;
}

export interface CapabilityGateResult {
  block: boolean;
  summary: string;
  narration: string;
  context: string;
}

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
    return '';
  }
}

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
