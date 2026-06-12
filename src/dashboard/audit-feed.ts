import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

/**
 * Issue #146 — the `GET /api/audit` reader (spec section 6.1). Parses the
 * framework audit log (`.paqad/audit.log`) into a newest-first feed for the
 * Trust area. The canonical line shape is
 * `[ISO] LEVEL action key="value" …`, but the log is append-only and
 * tool-agnostic, so free-form lines are kept as raw entries rather than
 * dropped — the feed must show everything the trail contains.
 */

export interface AuditFeedEntry {
  /** ISO timestamp from the leading `[…]`, or null for a free-form line. */
  ts: string | null;
  /** Log level token (e.g. `INFO`), or null for a free-form line. */
  level: string | null;
  /** Action token after the level, or null for a free-form line. */
  action: string | null;
  /** The `actor="…"` field when present (e.g. `dashboard`). */
  actor: string | null;
  /** The unmodified log line. */
  raw: string;
}

export interface AuditFeedPage {
  /** Newest first. */
  entries: AuditFeedEntry[];
  /** Pass back as `cursor` for the next (older) page; null when exhausted. */
  nextCursor: number | null;
  /** Total log lines, so the client can show "n of total". */
  total: number;
}

export interface AuditFeedOptions {
  /** Page size; defaults to 200, capped at 1000. */
  limit?: number;
  /** Line offset from the end of the log (0 = newest), for paging. */
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

/** Read a newest-first page of the audit log. Missing log → empty feed. */
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
