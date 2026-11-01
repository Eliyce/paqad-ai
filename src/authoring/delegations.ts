import { closeSync, fstatSync, readSync } from 'node:fs';
import { join } from 'node:path';

import { activationCutoff } from './activations.js';
import { AUTHORING_LEDGER_DIR } from './evidence.js';
import { openIfPresent, writeFileAtomic } from './fs-io.js';

export const DELEGATIONS_LEDGER = `${AUTHORING_LEDGER_DIR}/delegations.jsonl`;
export const DELEGATION_PRUNE_BYTES = 1_000_000;
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
): void {
  const fd = openIfPresent(join(projectRoot, DELEGATIONS_LEDGER));
  if (fd === null) return;
  try {
    visitDelegations(fd, visit);
  } finally {
    closeSync(fd);
  }
}

export function pruneDelegations(
  projectRoot: string,
  now: Date,
  darkWindowDays: number,
  force = false,
): number {
  const path = join(projectRoot, DELEGATIONS_LEDGER);
  const fd = openIfPresent(path);
  if (fd === null) return 0;
  const cutoff = activationCutoff(now, darkWindowDays);
  const kept: string[] = [];
  let dropped = 0;
  try {
    if (!force && fstatSync(fd).size <= DELEGATION_PRUNE_BYTES) return 0;
    visitDelegations(fd, (delegation) => {
      if (Date.parse(delegation.at) >= cutoff) kept.push(JSON.stringify(delegation));
      else dropped += 1;
    });
  } finally {
    closeSync(fd);
  }
  writeFileAtomic(path, kept.length === 0 ? '' : `${kept.join('\n')}\n`);
  return dropped;
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
