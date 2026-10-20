import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export interface AuditFeedEntry {
  ts: string | null;
  level: string | null;
  action: string | null;
  actor: string | null;
  raw: string;
}

export interface AuditFeedPage {
  entries: AuditFeedEntry[];
  nextCursor: number | null;
  total: number;
}

export interface AuditFeedOptions {
  limit?: number;
  cursor?: number;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

const LINE_PATTERN = /^\[([^\]]+)\]\s+(\S+)\s+(\S+)(?:\s+(.*))?$/;
const ACTOR_PATTERN = /(?:^|\s)actor="([^"]*)"/;

function parseLine(raw: string): AuditFeedEntry {
  const match = LINE_PATTERN.exec(raw);
  if (match === null) {
    return { ts: null, level: null, action: null, actor: null, raw };
  }
  const actor = ACTOR_PATTERN.exec(match[4] ?? '');
  return {
    ts: match[1],
    level: match[2],
    action: match[3],
    actor: actor === null ? null : actor[1],
    raw,
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

function clampCursor(cursor: number | undefined): number {
  if (cursor === undefined || !Number.isFinite(cursor) || cursor < 0) {
    return 0;
  }
  return Math.floor(cursor);
}

export function readAuditFeed(projectRoot: string, options: AuditFeedOptions = {}): AuditFeedPage {
  const path = join(projectRoot, PATHS.AUDIT_LOG);
  if (!existsSync(path)) {
    return { entries: [], nextCursor: null, total: 0 };
  }

  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const newestFirst = lines.reverse();

  const limit = clampLimit(options.limit);
  const cursor = clampCursor(options.cursor);
  const entries = newestFirst.slice(cursor, cursor + limit).map(parseLine);
  const consumed = cursor + entries.length;

  return {
    entries,
    nextCursor: consumed < newestFirst.length ? consumed : null,
    total: newestFirst.length,
  };
}
