import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export const CHECKS_RUNNING_CEILING_MS = 30 * 60 * 1000;

const CHECKS_RUN_COMMAND = /\bchecks\s+run\b/;

export interface ChecksRunningMarker {
  pid: number;
  session_id: string;
  change: string | null;
  started_at: string;
}

export interface ChecksMarkerProbe {
  now?: () => Date;
  isAlive?: (pid: number) => boolean;
  commandOf?: (pid: number) => string | null;
}

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'unknown';
}

export function checksRunningMarkerPath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, PATHS.CHECKS_DIR, 'running', `${safeSessionId(sessionId)}.json`);
}

export function writeChecksRunningMarker(projectRoot: string, marker: ChecksRunningMarker): string {
  const path = checksRunningMarkerPath(projectRoot, marker.session_id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  return path;
}

export function readChecksRunningMarker(
  projectRoot: string,
  sessionId: string,
): ChecksRunningMarker | null {
  try {
    const parsed = JSON.parse(
      readFileSync(checksRunningMarkerPath(projectRoot, sessionId), 'utf8'),
    ) as unknown;
    return isMarker(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearChecksRunningMarker(
  projectRoot: string,
  sessionId: string,
  pid: number,
): void {
  if (readChecksRunningMarker(projectRoot, sessionId)?.pid !== pid) {
    return;
  }
  rmSync(checksRunningMarkerPath(projectRoot, sessionId), { force: true });
}

export function liveChecksRunningMarker(
  projectRoot: string,
  sessionId: string,
  probe: ChecksMarkerProbe = {},
): ChecksRunningMarker | null {
  const marker = readChecksRunningMarker(projectRoot, sessionId);
  if (!marker || marker.session_id !== sessionId) {
    return null;
  }
  const age = (probe.now ?? (() => new Date()))().getTime() - Date.parse(marker.started_at);
  if (Number.isNaN(age) || age < 0 || age >= CHECKS_RUNNING_CEILING_MS) {
    return null;
  }
  if (!(probe.isAlive ?? processIsAlive)(marker.pid)) {
    return null;
  }
  const command = (probe.commandOf ?? processCommand)(marker.pid);
  return command !== null && CHECKS_RUN_COMMAND.test(command) ? marker : null;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function processCommand(pid: number): string | null {
  if (process.platform === 'win32') {
    return null;
  }
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function isMarker(value: unknown): value is ChecksRunningMarker {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const m = value as Record<string, unknown>;
  return (
    Number.isInteger(m.pid) &&
    (m.pid as number) > 0 &&
    typeof m.session_id === 'string' &&
    (m.change === null || typeof m.change === 'string') &&
    typeof m.started_at === 'string'
  );
}

export const AGENT_RUN_GRACE_MS = 3_000;

export interface AgentRunRecord {
  pid: number;
  start_time: string;
  pgid: number;
  agent_id: string;
  session: string | null;
  label: string;
}

export interface AgentRunProbe {
  startTimeOf?: (pid: number) => string | null;
  pgidOf?: (pid: number) => number | null;
  signal?: (target: number, signal: NodeJS.Signals | 0) => boolean;
  sleep?: (ms: number) => Promise<void>;
  protectedGroups?: readonly number[];
}

export function agentRunRecordDir(projectRoot: string): string {
  return join(projectRoot, PATHS.CHECKS_DIR, 'running', 'processes');
}

export function processGroupOf(pid: number): number | null {
  if (process.platform === 'win32') return null;
  try {
    const out = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const pgid = Number.parseInt(out, 10);
    return Number.isInteger(pgid) && pgid > 0 ? pgid : null;
  } catch {
    return null;
  }
}

export function writeAgentRunRecord(projectRoot: string, record: AgentRunRecord): string {
  const path = join(agentRunRecordDir(projectRoot), `${record.pid}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return path;
}

export function clearAgentRunRecord(projectRoot: string, pid: number): void {
  rmSync(join(agentRunRecordDir(projectRoot), `${pid}.json`), { force: true });
}

export function readAgentRunRecords(projectRoot: string): AgentRunRecord[] {
  let names: string[];
  try {
    names = readdirSync(agentRunRecordDir(projectRoot));
  } catch {
    return [];
  }
  const records: AgentRunRecord[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      const value = JSON.parse(
        readFileSync(join(agentRunRecordDir(projectRoot), name), 'utf8'),
      ) as Record<string, unknown>;
      if (
        Number.isInteger(value.pid) &&
        Number.isInteger(value.pgid) &&
        typeof value.start_time === 'string' &&
        typeof value.agent_id === 'string' &&
        `${String(value.pid)}.json` === name
      ) {
        records.push(value as unknown as AgentRunRecord);
      }
    } catch {
      continue;
    }
  }
  return records;
}

function defaultSignal(target: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(target, signal);
    return true;
  } catch {
    return false;
  }
}

function ownGroups(probe: AgentRunProbe): Set<number> {
  const groups = new Set<number>(probe.protectedGroups ?? []);
  for (const pid of [process.pid, process.ppid]) {
    const pgid = (probe.pgidOf ?? processGroupOf)(pid);
    if (pgid !== null) groups.add(pgid);
  }
  return groups;
}

export async function endAgentRuns(
  projectRoot: string,
  agentId: string,
  probe: AgentRunProbe = {},
): Promise<AgentRunRecord[]> {
  const startTimeOf = probe.startTimeOf ?? processStartTime;
  const signal = probe.signal ?? defaultSignal;
  const sleep = probe.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const protectedGroups = ownGroups(probe);
  const ended: AgentRunRecord[] = [];
  for (const record of readAgentRunRecords(projectRoot)) {
    if (record.agent_id !== agentId) continue;
    if (startTimeOf(record.pid) !== record.start_time) {
      clearAgentRunRecord(projectRoot, record.pid);
      continue;
    }
    if (protectedGroups.has(record.pgid)) continue;
    signal(-record.pgid, 'SIGTERM');
    for (let waited = 0; waited < AGENT_RUN_GRACE_MS; waited += 100) {
      if (!signal(-record.pgid, 0)) break;
      await sleep(100);
    }
    if (signal(-record.pgid, 0)) signal(-record.pgid, 'SIGKILL');
    clearAgentRunRecord(projectRoot, record.pid);
    ended.push(record);
  }
  return ended;
}

export function processStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'win32') return processIsAlive(pid) ? 'unknown' : null;
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
