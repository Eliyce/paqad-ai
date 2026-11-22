import { homedir } from 'node:os';
import { join } from 'node:path';

import { releaseFileLock, tryAcquireFileLock } from '@/background/single-flight-lock.js';

import { appendFeatureStageRow } from '@/feature-evidence/stage-ledger.js';
import { HEAVY_RUN_RECLAIM_KIND } from '@/stage-evidence/types.js';

import {
  CHECKS_RUNNING_CEILING_MS,
  processGroupOf,
  processStartTime,
  writeAgentRunRecord,
} from './running-marker.js';

export const HEAVY_RUN_LOCK_RELATIVE = join('.paqad-ai', 'locks', 'heavy-run.json');

export const HEAVY_RUN_POLL_MS = 2_000;

export function heavyRunLockPath(home: string = homedir()): string {
  return join(home, HEAVY_RUN_LOCK_RELATIVE);
}

export interface HeavyRunHolder {
  pid: number;
  start_time: string | null;
  agent_id: string | null;
  session: string | null;
  project: string;
  label: string;
}

export interface HeavyRunProbe {
  startTimeOf?: (pid: number) => string | null;
}

export interface AcquireHeavyRunOptions {
  projectRoot: string;
  label: string;
  lockPath?: string;
  pid?: number;
  agentId?: string | null;
  session?: string | null;
  probe?: HeavyRunProbe;
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
  onWait?: (holder: HeavyRunHolder | null) => void;
  onReclaim?: (holder: HeavyRunHolder) => void;
}

export interface HeavyRunLease {
  holder: HeavyRunHolder;
  release: () => void;
}

export function heavyRunHolderGone(holder: HeavyRunHolder, probe: HeavyRunProbe = {}): boolean {
  const now = (probe.startTimeOf ?? processStartTime)(holder.pid);
  if (now === null) return true;
  return holder.start_time !== null && now !== holder.start_time;
}

export function parseHeavyRunHolder(text: string): HeavyRunHolder | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (!Number.isInteger(value.pid) || (value.pid as number) <= 0) return null;
    if (typeof value.project !== 'string') return null;
    return {
      pid: value.pid as number,
      start_time: typeof value.start_time === 'string' ? value.start_time : null,
      agent_id: typeof value.agent_id === 'string' ? value.agent_id : null,
      session: typeof value.session === 'string' ? value.session : null,
      project: value.project,
      label: typeof value.label === 'string' ? value.label : 'heavy run',
    };
  } catch {
    return null;
  }
}

export function describeHeavyRunHolder(holder: HeavyRunHolder | null): string {
  if (holder === null) return 'another heavy run';
  const who = holder.agent_id
    ? `agent ${holder.agent_id}`
    : `session ${holder.session ?? 'unknown'}`;
  return `${holder.label} (pid ${holder.pid}, ${who}, project ${holder.project})`;
}

function sameHolder(a: HeavyRunHolder, b: HeavyRunHolder): boolean {
  return a.pid === b.pid && a.start_time === b.start_time && a.project === b.project;
}

export async function acquireHeavyRunLock(options: AcquireHeavyRunOptions): Promise<HeavyRunLease> {
  const path = options.lockPath ?? heavyRunLockPath();
  const pid = options.pid ?? process.pid;
  const probe = options.probe ?? {};
  const holder: HeavyRunHolder = {
    pid,
    start_time: (probe.startTimeOf ?? processStartTime)(pid),
    agent_id: options.agentId ?? process.env.SE_AGENT_ID ?? null,
    session: options.session ?? process.env.SE_SESSION ?? null,
    project: options.projectRoot,
    label: options.label,
  };
  const nowMs = options.nowMs ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = nowMs() + (options.waitMs ?? CHECKS_RUNNING_CEILING_MS);
  let told = false;
  for (;;) {
    const outcome = tryAcquireFileLock(path, {
      body: holder,
      parse: parseHeavyRunHolder,
      holderGone: (current) => heavyRunHolderGone(current, probe),
    });
    if (outcome.acquired) {
      if (outcome.reclaimed) options.onReclaim?.(outcome.reclaimed);
      return {
        holder,
        release: () => releaseFileLock(path, holder, parseHeavyRunHolder, sameHolder),
      };
    }
    if (!told) {
      options.onWait?.(outcome.holder);
      told = true;
    }
    if (nowMs() >= deadline) {
      throw new Error(
        `waited ${Math.round((options.waitMs ?? CHECKS_RUNNING_CEILING_MS) / 60_000)} minutes for ${describeHeavyRunHolder(outcome.holder)} to finish`,
      );
    }
    await sleep(options.pollMs ?? HEAVY_RUN_POLL_MS);
  }
}

export function recordHeavyRunReclaim(
  projectRoot: string,
  sessionId: string,
  dirName: string | null,
  holder: HeavyRunHolder,
): void {
  if (!dirName) return;
  try {
    appendFeatureStageRow(projectRoot, sessionId, dirName, {
      kind: HEAVY_RUN_RECLAIM_KIND,
      agent: 'paqad-ai',
      holder_pid: holder.pid,
      ...(holder.agent_id ? { agent_id: holder.agent_id } : {}),
      reason: describeHeavyRunHolder(holder),
    });
  } catch {
    return;
  }
}

export function recordAgentRun(projectRoot: string, sessionId: string | null, label: string): void {
  const agentId = process.env.SE_AGENT_ID?.trim();
  if (!agentId) return;
  const startTime = processStartTime(process.pid);
  const pgid = processGroupOf(process.pid);
  if (startTime === null || pgid === null) return;
  try {
    writeAgentRunRecord(projectRoot, {
      pid: process.pid,
      start_time: startTime,
      pgid,
      agent_id: agentId,
      session: sessionId,
      label,
    });
  } catch {
    return;
  }
}
