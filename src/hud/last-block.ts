import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';

import { toProjectRelativePath } from '@/core/path-utils.js';

import { hudLastBlockPath, writeFileAtomic } from './files.js';

export const LAST_BLOCK_DIFF_MAX_BYTES = 2048;

export interface RuleStopRecord {
  rule: string;
  title: string | null;
  file: string;
  tool_use_id: string | null;
  managed: boolean;
  sole: boolean;
  at: string;
  diff: string;
  token: string;
  used: boolean;
  allowed_once: boolean;
  session: string;
}

export interface RuleStopInput {
  projectRoot: string;
  sessionId: string;
  rule: string;
  title?: string | null;
  file: string;
  toolUseId?: string | null;
  managed: boolean;
  sole?: boolean;
  toolInput?: unknown;
  now?: () => Date;
  token?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function prefixed(text: unknown, mark: '-' | '+'): string[] {
  return typeof text === 'string' && text !== ''
    ? text.split(/\r?\n/).map((line) => `${mark} ${line}`)
    : [];
}

function editLines(edit: Record<string, unknown> | null): string[] {
  if (!edit) return [];
  return [...prefixed(edit.old_string, '-'), ...prefixed(edit.new_string, '+')];
}

export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = '';
  let used = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out;
}

export function shortDiff(toolInput: unknown, maxBytes = LAST_BLOCK_DIFF_MAX_BYTES): string {
  const input = asRecord(toolInput);
  if (!input) return '';
  const edits = Array.isArray(input.edits) ? input.edits.map(asRecord) : [input];
  const lines = [
    ...edits.flatMap(editLines),
    ...prefixed(input.content, '+'),
    ...prefixed(input.new_source, '+'),
  ];
  return truncateUtf8(lines.join('\n'), maxBytes);
}

export function writeRuleStopRecord(input: RuleStopInput): RuleStopRecord {
  const record: RuleStopRecord = {
    rule: input.rule,
    title: input.title ?? null,
    file: input.file,
    tool_use_id: input.toolUseId ?? null,
    managed: input.managed,
    sole: input.sole === true,
    at: (input.now ?? (() => new Date()))().toISOString(),
    diff: shortDiff(input.toolInput),
    token: input.token ?? randomBytes(16).toString('hex'),
    used: false,
    allowed_once: false,
    session: input.sessionId,
  };
  writeFileAtomic(
    hudLastBlockPath(input.projectRoot, input.sessionId),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function parseRuleStopRecord(value: unknown): RuleStopRecord | null {
  const raw = asRecord(value);
  const rule = str(raw?.rule);
  const file = str(raw?.file);
  const at = str(raw?.at);
  const token = str(raw?.token);
  const session = str(raw?.session);
  if (!raw || !rule || !file || !at || !token || !session) return null;
  return {
    rule,
    title: str(raw.title),
    file,
    tool_use_id: str(raw.tool_use_id),
    managed: raw.managed === true,
    sole: raw.sole === true,
    at,
    diff: typeof raw.diff === 'string' ? raw.diff : '',
    token,
    used: raw.used === true,
    allowed_once: raw.allowed_once === true,
    session,
  };
}

export function readRuleStopRecord(projectRoot: string, sessionId: string): RuleStopRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(hudLastBlockPath(projectRoot, sessionId), 'utf8'));
  } catch {
    return null;
  }
  const record = parseRuleStopRecord(parsed);
  return record && record.session === sessionId ? record : null;
}

function writeRecord(projectRoot: string, record: RuleStopRecord): void {
  writeFileAtomic(
    hudLastBlockPath(projectRoot, record.session),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

export function markRuleStopAllowedOnce(projectRoot: string, record: RuleStopRecord): void {
  writeRecord(projectRoot, { ...record, used: true, allowed_once: true });
}

export interface AllowedOnceCall {
  toolUseId: string | null | undefined;
  rule: string;
  file: string;
}

export function takeAllowedOnce(
  projectRoot: string,
  sessionId: string,
  call: AllowedOnceCall,
): boolean {
  const record = readRuleStopRecord(projectRoot, sessionId);
  if (!record?.allowed_once || !call.toolUseId || record.tool_use_id !== call.toolUseId) {
    return false;
  }
  if (record.rule !== call.rule) return false;
  const recordFile = toProjectRelativePath(projectRoot, record.file);
  const callFile = toProjectRelativePath(projectRoot, call.file);
  if (recordFile === null || callFile === null || recordFile !== callFile) return false;
  writeRecord(projectRoot, { ...record, allowed_once: false });
  return true;
}

export function clearRuleStopRecord(projectRoot: string, sessionId: string): void {
  rmSync(hudLastBlockPath(projectRoot, sessionId), { force: true });
}
