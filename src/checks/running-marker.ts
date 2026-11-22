import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
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
  home?: string;
}

export const AGENT_RUN_RECORDS_RELATIVE = join('.paqad-ai', 'runs');

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export function agentRunRecordDir(projectRoot: string, home: string = homedir()): string {
  const project = createHash('sha256').update(projectRoot).digest('hex').slice(0, 16);
  return join(home, AGENT_RUN_RECORDS_RELATIVE, project);
}

function ownerOnly(mode: number, uid: number): boolean {
  const me = typeof process.getuid === 'function' ? process.getuid() : uid;
  return uid === me && (mode & 0o077) === 0;
}

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const path of [dirname(dir), dir]) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${path} is not a directory`);
    if ((stat.mode & 0o077) !== 0) chmodSync(path, 0o700);
  }
}

function readPrivateFile(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !ownerOnly(stat.mode, stat.uid)) return null;
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
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

export function writeAgentRunRecord(
  projectRoot: string,
  record: AgentRunRecord,
  home?: string,
): string {
  const dir = agentRunRecordDir(projectRoot, home);
  ensurePrivateDir(dir);
  const path = join(dir, `${record.pid}.json`);
  rmSync(path, { force: true });
  const fd = openSync(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, `${JSON.stringify({ ...record, project: projectRoot }, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  return path;
}

export function clearAgentRunRecord(projectRoot: string, pid: number, home?: string): void {
  rmSync(join(agentRunRecordDir(projectRoot, home), `${pid}.json`), { force: true });
}

export function readAgentRunRecords(projectRoot: string, home?: string): AgentRunRecord[] {
  const dir = agentRunRecordDir(projectRoot, home);
  let names: string[];
  try {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || !ownerOnly(stat.mode, stat.uid)) return [];
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const records: AgentRunRecord[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      const text = readPrivateFile(join(dir, name));
      if (text === null) continue;
      const value = JSON.parse(text) as Record<string, unknown>;
      if (
        Number.isInteger(value.pid) &&
        Number.isInteger(value.pgid) &&
        typeof value.start_time === 'string' &&
        typeof value.agent_id === 'string' &&
        value.project === projectRoot &&
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
  const pgidOf = probe.pgidOf ?? processGroupOf;
  const protectedGroups = ownGroups(probe);
  const ended: AgentRunRecord[] = [];
  for (const record of readAgentRunRecords(projectRoot, probe.home)) {
    if (record.agent_id !== agentId) continue;
    if (startTimeOf(record.pid) !== record.start_time) {
      clearAgentRunRecord(projectRoot, record.pid, probe.home);
      continue;
    }
    if (record.pgid <= 1 || pgidOf(record.pid) !== record.pgid) continue;
    if (protectedGroups.has(record.pgid)) continue;
    signal(-record.pgid, 'SIGTERM');
    for (let waited = 0; waited < AGENT_RUN_GRACE_MS; waited += 100) {
      if (!signal(-record.pgid, 0)) break;
      await sleep(100);
    }
    if (signal(-record.pgid, 0)) signal(-record.pgid, 'SIGKILL');
    clearAgentRunRecord(projectRoot, record.pid, probe.home);
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
