import { isManagedEnv } from '@/core/framework-enabled.js';
import { appendHooksLog } from '@/core/logging/hooks-log.js';
import { hudLastBlockPath } from '@/hud/files.js';
import { clearRuleStopRecord, writeRuleStopRecord } from '@/hud/last-block.js';
import { visualEvidenceReminder } from '@/visual-evidence/reminder.js';

import { CAPABILITY_IMPLS, type CapabilityOutcome } from './capability.js';
import { capabilitiesForSeam, type CapabilityPayload, type CapabilitySeam } from './registry.js';

export interface CapabilityGateInput {
  projectRoot: string;
  seam: CapabilitySeam;
  env?: NodeJS.ProcessEnv;
  payload?: CapabilityPayload;
  entryLoaded?: () => boolean;
  startedAt?: number;
  now?: () => number;
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

function errorKind(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return error instanceof Error ? error.name : 'unknown';
}

function callerLoadedFramework(entryLoaded: (() => boolean) | undefined): boolean {
  try {
    return entryLoaded?.() === true;
  } catch {
    return false;
  }
}

function syncRuleStopRecord(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  payload: CapabilityPayload | undefined,
  blocking: CapabilityOutcome[],
  entryLoaded: (() => boolean) | undefined,
): void {
  const sessionId = payload?.sessionId ?? env.CLAUDE_SESSION_ID;
  if (!sessionId) return;
  const violation = blocking.flatMap((outcome) => outcome.violations ?? [])[0];
  const sole =
    blocking.length === 1 &&
    (blocking[0]?.violations?.length ?? 0) > 0 &&
    callerLoadedFramework(entryLoaded);
  try {
    if (!violation) {
      if (blocking.length === 0) clearRuleStopRecord(projectRoot, sessionId);
      return;
    }
    writeRuleStopRecord({
      projectRoot,
      sessionId,
      rule: violation.rule_id,
      title: violation.title ?? null,
      file: violation.file,
      toolUseId: payload?.toolUseId ?? null,
      managed: isManagedEnv(env),
      sole,
      toolInput: payload?.toolInput,
    });
  } catch (error) {
    appendHooksLog(
      projectRoot,
      `capability-gate rule-stop record not written: ${errorKind(error)} ${hudLastBlockPath(projectRoot, sessionId)}`,
    );
  }
}

export async function runCapabilityGate(input: CapabilityGateInput): Promise<CapabilityGateResult> {
  const { projectRoot, seam, env = process.env, payload, entryLoaded, startedAt, now } = input;
  const outcomes: CapabilityOutcome[] = [];
  const narrations: string[] = [];
  const contexts: string[] = [];
  for (const descriptor of capabilitiesForSeam(seam)) {
    const capability = CAPABILITY_IMPLS.get(descriptor.id);
    if (!capability) {
      continue;
    }
    const outcome = await capability.evaluate({
      projectRoot,
      seam,
      env,
      payload,
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(now ? { now } : {}),
    });
    if (outcome.narration) {
      narrations.push(outcome.narration);
    }
    if (outcome.context) {
      contexts.push(outcome.context);
    }
    if (outcome.ran && outcome.summary) {
      outcomes.push(outcome);
    }
  }
  const narration = narrations.join('\n');
  const context =
    seam === 'pre-mutation'
      ? [...contexts, reminderContext(projectRoot, env, payload)].filter(Boolean).join('\n')
      : '';
  const blocking = outcomes.filter((outcome) => outcome.blocking);
  if (seam === 'pre-mutation') {
    syncRuleStopRecord(projectRoot, env, payload, blocking, entryLoaded);
  }
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
