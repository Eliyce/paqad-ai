export const TEAM_FILE_SCHEMA_VERSION = 1;

export const NOT_A_SETTING_LINE = '# Not a paqad setting, so paqad ignores it (kept as written):';

const SCHEMA_KEY = /^schema_version[ \t]*:(?:[ \t]|$)/u;
const LEGACY_KEY = /^paqad_version[ \t]*:(?:[ \t]|$)/u;
const SEMVER = /^\d+\.\d+\.\d+/u;
const POSITIVE_INTEGER = /^[1-9]\d*$/u;
const LINE_END = /\r?\n$/u;

export type TeamFileStamp =
  | { kind: 'current'; version: number }
  | { kind: 'legacy' }
  | { kind: 'none' }
  | { kind: 'malformed' };

export function parseStampInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 ? value : null;
  return typeof value === 'string' && POSITIVE_INTEGER.test(value) ? Number(value) : null;
}

export function isHigherStamp(found: unknown, running: number): boolean {
  const parsed = parseStampInteger(found);
  return parsed !== null && parsed > running;
}

interface RawLine {
  body: string;
  end: string;
}

function rawLines(text: string): RawLine[] {
  return text
    .split(/(?<=\n)/u)
    .filter((line) => line !== '')
    .map((line) => {
      const end = LINE_END.exec(line)?.[0] ?? '';
      return { body: line.slice(0, line.length - end.length), end };
    });
}

function withoutBom(body: string): string {
  return body.startsWith('﻿') ? body.slice(1) : body;
}

function scalarAfterColon(body: string): { value: string; comment: string } {
  const rest = body.slice(body.indexOf(':') + 1);
  const match = /^(.*?)([ \t]+#.*)?$/u.exec(rest);
  return { value: (match?.[1] ?? '').trim(), comment: match?.[2] ?? '' };
}

function legacyValue(raw: string): string {
  return raw.replace(/^(["'])(.*)\1$/u, '$2');
}

function findLine(lines: readonly RawLine[], key: RegExp): number {
  return lines.findIndex((line) => key.test(withoutBom(line.body)));
}

function stampOf(lines: readonly RawLine[]): TeamFileStamp {
  const schema = findLine(lines, SCHEMA_KEY);
  if (schema >= 0) {
    const version = parseStampInteger(scalarAfterColon(lines[schema]!.body).value);
    return version === null ? { kind: 'malformed' } : { kind: 'current', version };
  }
  const legacy = findLine(lines, LEGACY_KEY);
  if (legacy < 0) return { kind: 'none' };
  return SEMVER.test(legacyValue(scalarAfterColon(lines[legacy]!.body).value))
    ? { kind: 'legacy' }
    : { kind: 'malformed' };
}

export function readTeamFileStamp(text: string): TeamFileStamp {
  return stampOf(rawLines(text));
}

export function isNewerTeamFile(text: string): boolean {
  const stamp = readTeamFileStamp(text);
  return stamp.kind === 'current' && isHigherStamp(stamp.version, TEAM_FILE_SCHEMA_VERSION);
}

export function newerTeamFileLine(file: string): string {
  return `${file} was written by a newer paqad, so it wasn't changed. Update paqad-ai.`;
}

function removeLineAt(lines: RawLine[], index: number): void {
  lines.splice(index, 1);
  const before = lines[index - 1];
  const after = lines[index];
  const emptied = after === undefined || after.body.trim() === '';
  if (before?.body.trim() !== NOT_A_SETTING_LINE || !emptied) return;
  lines.splice(index - 1, 1);
  if (lines[index - 2]?.body.trim() === '') lines.splice(index - 2, 1);
}

function swappedLine(line: RawLine, version: number): RawLine {
  const bom = line.body.startsWith('﻿') ? '﻿' : '';
  const { comment } = scalarAfterColon(line.body);
  return { body: `${bom}schema_version: ${version}${comment}`, end: line.end };
}

export function swapTeamFileStamp(text: string): string {
  const lines = rawLines(text);
  const stamp = stampOf(lines);
  if (stamp.kind === 'malformed' || stamp.kind === 'none') return text;
  if (stamp.kind === 'current' && isHigherStamp(stamp.version, TEAM_FILE_SCHEMA_VERSION)) {
    return text;
  }
  const legacy = findLine(lines, LEGACY_KEY);
  if (legacy < 0) return text;
  if (stamp.kind === 'legacy') {
    lines[legacy] = swappedLine(lines[legacy]!, TEAM_FILE_SCHEMA_VERSION);
    return lines.map((line) => `${line.body}${line.end}`).join('');
  }
  const schema = findLine(lines, SCHEMA_KEY);
  if (legacy < schema) {
    lines[legacy] = swappedLine(lines[legacy]!, stamp.version);
    removeLineAt(lines, schema);
  } else {
    lines.splice(legacy, 1);
  }
  return lines.map((line) => `${line.body}${line.end}`).join('');
}

export function unreadableStampLine(file: string): string {
  return `${file} has a schema_version or paqad_version line paqad can't read, so it wasn't changed. Fix that line, then try again.`;
}

export function renderWriteBlock(text: string, file: string): string | null {
  if (isNewerTeamFile(text)) return newerTeamFileLine(file);
  return readTeamFileStamp(text).kind === 'malformed' ? unreadableStampLine(file) : null;
}
