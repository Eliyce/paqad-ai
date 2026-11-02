import { closeSync, fstatSync, readSync } from 'node:fs';
import { join } from 'node:path';

import { AUTHORING_LEDGER_DIR } from './evidence.js';
import { openIfPresent, writeFileAtomic } from './fs-io.js';

export const ACTIVATIONS_LEDGER = `${AUTHORING_LEDGER_DIR}/activations.jsonl`;
export const ACTIVATION_PRUNE_BYTES = 1_000_000;
const DAY_MS = 86_400_000;
const CHUNK_BYTES = 64 * 1024;

export interface SkillActivation {
  skill: string;
  request_id: string | null;
  session_id: string | null;
  at: string;
  source: 'Skill-tool' | 'SKILL.md-read';
}

function parseActivation(line: string): SkillActivation | null {
  if (line.trim() === '') return null;
  try {
    const row = JSON.parse(line) as Partial<SkillActivation>;
    return typeof row.skill === 'string' && typeof row.at === 'string'
      ? (row as SkillActivation)
      : null;
  } catch {
    return null;
  }
}

function visitActivations(fd: number, visit: (activation: SkillActivation) => void): void {
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let rest = '';
  for (;;) {
    const read = readSync(fd, buffer, 0, CHUNK_BYTES, null);
    if (read === 0) break;
    const text = rest + buffer.subarray(0, read).toString('utf8');
    const lines = text.split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      const activation = parseActivation(line);
      if (activation) visit(activation);
    }
  }
  const last = parseActivation(rest);
  if (last) visit(last);
}

export function forEachActivation(
  projectRoot: string,
  visit: (activation: SkillActivation) => void,
): boolean {
  const fd = openIfPresent(join(projectRoot, ACTIVATIONS_LEDGER));
  if (fd === null) return false;
  try {
    visitActivations(fd, visit);
  } finally {
    closeSync(fd);
  }
  return true;
}

export function activationCutoff(now: Date, darkWindowDays: number): number {
  return now.getTime() - 2 * darkWindowDays * DAY_MS;
}

export function pruneActivations(
  projectRoot: string,
  now: Date,
  darkWindowDays: number,
  force = false,
): number {
  const path = join(projectRoot, ACTIVATIONS_LEDGER);
  const fd = openIfPresent(path);
  if (fd === null) return 0;
  const cutoff = activationCutoff(now, darkWindowDays);
  const kept: string[] = [];
  let dropped = 0;
  try {
    if (!force && fstatSync(fd).size <= ACTIVATION_PRUNE_BYTES) return 0;
    visitActivations(fd, (activation) => {
      if (Date.parse(activation.at) >= cutoff) kept.push(JSON.stringify(activation));
      else dropped += 1;
    });
  } finally {
    closeSync(fd);
  }
  writeFileAtomic(path, kept.length === 0 ? '' : `${kept.join('\n')}\n`);
  return dropped;
}

export function lastFiredBySkill(projectRoot: string): Map<string, string> {
  const last = new Map<string, string>();
  forEachActivation(projectRoot, (activation) => {
    const previous = last.get(activation.skill);
    if (previous === undefined || activation.at > previous)
      last.set(activation.skill, activation.at);
  });
  return last;
}
