import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { ULID_BODY, ulid } from '@/core/ids/ulid.js';
import { stripTrailingChars, toProjectRelativePath } from '@/core/path-utils.js';

export const DEBT_KINDS = ['bug', 'debt', 'gap', 'follow-up'] as const;
export const DEBT_SEVERITIES = ['low', 'medium', 'high'] as const;
export const DEBT_STATUSES = ['open', 'promoted', 'closed'] as const;

export type DebtKind = (typeof DEBT_KINDS)[number];
export type DebtSeverity = (typeof DEBT_SEVERITIES)[number];
export type DebtStatus = (typeof DEBT_STATUSES)[number];

export interface DebtFoundIn {
  change: string | null;
  issue: string | null;
  stage: string | null;
}

export interface TechDebtItem {
  id: string;
  title: string;
  kind: DebtKind;
  severity: DebtSeverity;
  status: DebtStatus;
  files: string[];
  found_in: DebtFoundIn;
  found_by: string;
  session: string | null;
  created_at: string;
  reopened_at: string | null;
  issue: string | null;
  closed_reason: string | null;
  body: string;
}

export interface AddDebtInput {
  title: string;
  kind: string;
  severity: string;
  files: string[];
  body?: string;
  foundBy?: string;
  foundIn?: Partial<DebtFoundIn>;
  session?: string | null;
}

export interface AddDebtResult {
  id: string;
  outcome: 'created' | 'existing' | 'reopened';
  item: TechDebtItem;
}

const TD_ID_PATTERN = new RegExp(`^TD-${ULID_BODY}$`);
const FRONT_MATTER_BOUNDARY = '---';
const BODY_HEADING = '## What';

export class TechDebtError extends Error {}

export function mintTechDebtId(): string {
  return `TD-${ulid()}`;
}

export function isTechDebtId(id: string): boolean {
  return TD_ID_PATTERN.test(id);
}

export function assertTechDebtId(id: string): void {
  if (!isTechDebtId(id)) {
    throw new TechDebtError(`"${id}" is not a tech-debt id; expected TD-<ULID>.`);
  }
}

export function techDebtDir(projectRoot: string): string {
  return join(projectRoot, PATHS.TECH_DEBT_DIR);
}

export function techDebtItemPath(projectRoot: string, id: string): string {
  assertTechDebtId(id);
  return join(techDebtDir(projectRoot), `${id}.md`);
}

export function normalizeDebtTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeDebtFiles(projectRoot: string, files: string[]): string[] {
  const normalized = files.map((file) => {
    const relativePath = toProjectRelativePath(projectRoot, file);
    if (relativePath === null) {
      throw new TechDebtError(`--file "${file}" resolves outside the project root.`);
    }
    return relativePath;
  });
  return [...new Set(normalized)].sort();
}

function dedupeKey(title: string, files: string[]): string {
  return JSON.stringify([normalizeDebtTitle(title), [...files].sort()]);
}

function oneOf<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new TechDebtError(`${flag} must be one of ${allowed.join(', ')}; got "${value}".`);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function serializeDebtItem(item: TechDebtItem): string {
  const frontMatter = {
    id: item.id,
    title: item.title,
    kind: item.kind,
    severity: item.severity,
    status: item.status,
    files: item.files,
    found_in: item.found_in,
    found_by: item.found_by,
    session: item.session,
    created_at: item.created_at,
    reopened_at: item.reopened_at,
    issue: item.issue,
    closed_reason: item.closed_reason,
  };
  const yaml = YAML.stringify(frontMatter, {
    defaultStringType: 'QUOTE_DOUBLE',
    defaultKeyType: 'PLAIN',
    lineWidth: 0,
  });
  const body = stripTrailingChars(item.body, ' \t\r\n');
  return `${FRONT_MATTER_BOUNDARY}\n${yaml}${FRONT_MATTER_BOUNDARY}\n\n${BODY_HEADING}\n\n${body}\n`;
}

export function parseDebtItem(text: string): TechDebtItem | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== FRONT_MATTER_BOUNDARY) {
    return null;
  }
  const closing = lines.indexOf(FRONT_MATTER_BOUNDARY, 1);
  if (closing === -1) {
    return null;
  }
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = YAML.parse(lines.slice(1, closing).join('\n'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const id = textOrNull(data.id);
  const title = textOrNull(data.title);
  if (id === null || !isTechDebtId(id) || title === null) {
    return null;
  }
  const kind = String(data.kind);
  const severity = String(data.severity);
  const status = String(data.status);
  if (
    !(DEBT_KINDS as readonly string[]).includes(kind) ||
    !(DEBT_SEVERITIES as readonly string[]).includes(severity) ||
    !(DEBT_STATUSES as readonly string[]).includes(status)
  ) {
    return null;
  }
  const foundIn =
    data.found_in !== null && typeof data.found_in === 'object'
      ? (data.found_in as Record<string, unknown>)
      : {};
  const rest = lines.slice(closing + 1);
  const headingAt = rest.indexOf(BODY_HEADING);
  const bodyLines = headingAt === -1 ? rest : rest.slice(headingAt + 1);
  return {
    id,
    title,
    kind: kind as DebtKind,
    severity: severity as DebtSeverity,
    status: status as DebtStatus,
    files: Array.isArray(data.files) ? data.files.filter((f) => typeof f === 'string') : [],
    found_in: {
      change: textOrNull(foundIn.change),
      issue: textOrNull(foundIn.issue),
      stage: textOrNull(foundIn.stage),
    },
    found_by: textOrNull(data.found_by) ?? 'orchestrator',
    session: textOrNull(data.session),
    created_at: textOrNull(data.created_at) ?? '',
    reopened_at: textOrNull(data.reopened_at),
    issue: textOrNull(data.issue),
    closed_reason: textOrNull(data.closed_reason),
    body: bodyLines.join('\n').trim(),
  };
}

export function readDebtItems(projectRoot: string): TechDebtItem[] {
  let names: string[];
  try {
    names = readdirSync(techDebtDir(projectRoot));
  } catch {
    return [];
  }
  const items: TechDebtItem[] = [];
  for (const name of names.filter((entry) => /^TD-.+\.md$/.test(entry)).sort()) {
    const item = parseDebtItem(readFileSync(join(techDebtDir(projectRoot), name), 'utf8'));
    if (item !== null && `${item.id}.md` === name) {
      items.push(item);
    }
  }
  return items;
}

export function readDebtItem(projectRoot: string, id: string): TechDebtItem {
  const path = techDebtItemPath(projectRoot, id);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new TechDebtError(`No tech-debt item ${id} under ${PATHS.TECH_DEBT_DIR}.`);
  }
  const item = parseDebtItem(text);
  if (item === null || item.id !== id) {
    throw new TechDebtError(`Tech-debt item ${id} has unreadable front matter.`);
  }
  return item;
}

export function writeDebtItem(projectRoot: string, item: TechDebtItem): void {
  const path = techDebtItemPath(projectRoot, item.id);
  mkdirSync(techDebtDir(projectRoot), { recursive: true });
  writeFileSync(path, serializeDebtItem(item));
}

export function addDebtItem(
  projectRoot: string,
  input: AddDebtInput,
  now: Date = new Date(),
): AddDebtResult {
  const title = input.title.trim();
  if (title.length === 0) {
    throw new TechDebtError('--title must not be empty.');
  }
  const kind = oneOf(input.kind, DEBT_KINDS, '--kind');
  const severity = oneOf(input.severity, DEBT_SEVERITIES, '--severity');
  const files = normalizeDebtFiles(projectRoot, input.files);
  const key = dedupeKey(title, files);
  const match = readDebtItems(projectRoot).find(
    (item) => dedupeKey(item.title, item.files) === key,
  );
  if (match !== undefined) {
    if (match.status !== 'closed') {
      return { id: match.id, outcome: 'existing', item: match };
    }
    const reopened: TechDebtItem = { ...match, status: 'open', reopened_at: now.toISOString() };
    writeDebtItem(projectRoot, reopened);
    return { id: reopened.id, outcome: 'reopened', item: reopened };
  }
  const item: TechDebtItem = {
    id: mintTechDebtId(),
    title,
    kind,
    severity,
    status: 'open',
    files,
    found_in: {
      change: input.foundIn?.change ?? null,
      issue: input.foundIn?.issue ?? null,
      stage: input.foundIn?.stage ?? null,
    },
    found_by: textOrNull(input.foundBy?.trim()) ?? 'orchestrator',
    session: input.session ?? null,
    created_at: now.toISOString(),
    reopened_at: null,
    issue: null,
    closed_reason: null,
    body: input.body ?? '',
  };
  writeDebtItem(projectRoot, item);
  return { id: item.id, outcome: 'created', item };
}

export function promoteDebtItem(projectRoot: string, id: string, issue: string): TechDebtItem {
  const ref = issue.trim();
  if (ref.length === 0) {
    throw new TechDebtError('--issue must not be empty.');
  }
  const item: TechDebtItem = { ...readDebtItem(projectRoot, id), status: 'promoted', issue: ref };
  writeDebtItem(projectRoot, item);
  return item;
}

export function closeDebtItem(projectRoot: string, id: string, reason: string): TechDebtItem {
  const why = reason.trim();
  if (why.length === 0) {
    throw new TechDebtError('--reason must not be empty.');
  }
  const item: TechDebtItem = {
    ...readDebtItem(projectRoot, id),
    status: 'closed',
    closed_reason: why,
  };
  writeDebtItem(projectRoot, item);
  return item;
}

export interface ListDebtFilter {
  status?: DebtStatus | 'all';
  change?: string | null;
}

export function listDebtItems(projectRoot: string, filter: ListDebtFilter = {}): TechDebtItem[] {
  const status = filter.status ?? 'open';
  return readDebtItems(projectRoot)
    .filter((item) => status === 'all' || item.status === status)
    .filter((item) => filter.change === undefined || item.found_in.change === filter.change)
    .sort(newestFirst);
}

export function newestFirst(a: TechDebtItem, b: TechDebtItem): number {
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}
