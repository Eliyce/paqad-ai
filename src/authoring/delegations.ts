import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

import { activationCutoff } from './activations.js';
import { AUTHORING_LEDGER_DIR } from './evidence.js';
import { openIfPresent } from './fs-io.js';

export const DELEGATIONS_LEDGER = `${AUTHORING_LEDGER_DIR}/delegations.jsonl`;
export const DELEGATION_PRUNE_BYTES = 1_000_000;
export const DELEGATION_COMPACTING_SUFFIX = '.compacting';
export const DELEGATION_LOCK_SUFFIX = '.lock';
export const DELEGATION_STALE_LOCK_MS = 60_000;
const DELEGATION_TAIL_PASSES = 3;
const CHUNK_BYTES = 64 * 1024;

export interface AgentDelegation {
  agent: string;
  request_id: string | null;
  session_id: string | null;
  at: string;
  tokens: number | null;
  duration_ms: number | null;
  status: string;
}

function parseDelegation(line: string): AgentDelegation | null {
  if (line.trim() === '') return null;
  try {
    const row = JSON.parse(line) as Partial<AgentDelegation>;
    return typeof row.agent === 'string' && typeof row.at === 'string'
      ? (row as AgentDelegation)
      : null;
  } catch {
    return null;
  }
}

function visitDelegations(fd: number, visit: (delegation: AgentDelegation) => void): void {
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let rest = '';
  for (;;) {
    const read = readSync(fd, buffer, 0, CHUNK_BYTES, null);
    if (read === 0) break;
    const text = rest + buffer.subarray(0, read).toString('utf8');
    const lines = text.split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      const delegation = parseDelegation(line);
      if (delegation) visit(delegation);
    }
  }
  const last = parseDelegation(rest);
  if (last) visit(last);
}

export function forEachDelegation(
  projectRoot: string,
  visit: (delegation: AgentDelegation) => void,
): boolean {
  const path = join(projectRoot, DELEGATIONS_LEDGER);
  let ledgerFound = false;
  for (const file of [`${path}${DELEGATION_COMPACTING_SUFFIX}`, path]) {
    const fd = openIfPresent(file);
    if (fd === null) continue;
    if (file === path) ledgerFound = true;
    try {
      visitDelegations(fd, visit);
    } finally {
      closeSync(fd);
    }
  }
  return ledgerFound;
}

function takeLock(lock: string, now: Date): boolean {
  try {
    closeSync(openSync(lock, 'wx'));
    return true;
  } catch {
    try {
      if (now.getTime() - statSync(lock).mtimeMs > DELEGATION_STALE_LOCK_MS) {
        rmSync(lock, { force: true });
      }
    } catch {
      return false;
    }
    return false;
  }
}

function readFrom(path: string, start: number): string {
  const fd = openIfPresent(path);
  if (fd === null) return '';
  try {
    const size = fstatSync(fd).size;
    if (size <= start) return '';
    const buffer = Buffer.alloc(size - start);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, start + offset);
      if (read === 0) break;
      offset += read;
    }
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function completeLines(text: string): string {
  const end = text.lastIndexOf('\n');
  return end === -1 ? '' : text.slice(0, end + 1);
}

function ledgerSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

export function pruneDelegations(
  projectRoot: string,
  now: Date,
  darkWindowDays: number,
  force = false,
): number {
  const path = join(projectRoot, DELEGATIONS_LEDGER);
  const compacting = `${path}${DELEGATION_COMPACTING_SUFFIX}`;
  const leftover = existsSync(compacting);
  if (!leftover) {
    const size = ledgerSize(path);
    if (size === null || (!force && size <= DELEGATION_PRUNE_BYTES)) return 0;
  }
  const lock = `${path}${DELEGATION_LOCK_SUFFIX}`;
  if (!takeLock(lock, now)) return 0;
  try {
    if (!existsSync(compacting)) {
      try {
        renameSync(path, compacting);
      } catch {
        return 0;
      }
    }
    const cutoff = activationCutoff(now, darkWindowDays);
    const head = completeLines(readFrom(compacting, 0));
    const kept: string[] = [];
    let dropped = 0;
    for (const line of head.split('\n')) {
      const delegation = parseDelegation(line);
      if (delegation === null) continue;
      if (Date.parse(delegation.at) >= cutoff) kept.push(JSON.stringify(delegation));
      else dropped += 1;
    }
    appendFileSync(path, kept.length === 0 ? '' : `${kept.join('\n')}\n`, 'utf8');
    let offset = Buffer.byteLength(head);
    for (let pass = 0; pass < DELEGATION_TAIL_PASSES; pass += 1) {
      const tail = completeLines(readFrom(compacting, offset));
      if (tail === '') break;
      appendFileSync(path, tail, 'utf8');
      offset += Buffer.byteLength(tail);
    }
    rmSync(compacting, { force: true });
    return dropped;
  } finally {
    rmSync(lock, { force: true });
  }
}

export function lastDelegatedByAgent(projectRoot: string): Map<string, string> {
  const last = new Map<string, string>();
  forEachDelegation(projectRoot, (delegation) => {
    const previous = last.get(delegation.agent);
    if (previous === undefined || delegation.at > previous) {
      last.set(delegation.agent, delegation.at);
    }
  });
  return last;
}
