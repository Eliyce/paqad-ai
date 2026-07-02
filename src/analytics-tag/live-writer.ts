// Analytics-tag live writer (issue #241) — the Claude PreToolUse tier. Mirrors
// src/stage-evidence/live-writer.ts: a mutating edit hands paqad the file being written and
// its new content; this scans that content for analytics call sites (via the shared
// extractor) and script-mints a `tag_added` row for each NEW tag introduced. Idempotent
// against the current ledger unit, best-effort (never throws), and flag-gated: nothing is
// recorded when analytics is disabled.

import { isAbsolute, relative } from 'node:path';

import { currentOrdinal, readSessionUnit } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { extractCallSites } from '@/analytics/call-sites.js';

import { recordAnalyticsTag } from './recorder.js';
import { ANALYTICS_TAG_DOC_TYPE, type AnalyticsTagRow } from './types.js';

export interface LiveAnalyticsTagInput {
  projectRoot: string;
  sessionId?: string | null;
  /** The file being mutated (absolute or repo-relative). */
  targetPath: string;
  /** The new content being written (Write) or the added text (Edit new_string). */
  newText: string;
  adapter?: string;
  /** The `analytics_instrumentation` flag state; nothing is recorded when false. */
  analyticsEnabled?: boolean;
  now?: () => Date;
}

/** Normalize a target path to a repo-relative, POSIX-separated form for the row. */
function toRepoRelative(projectRoot: string, targetPath: string): string {
  const rel = isAbsolute(targetPath) ? relative(projectRoot, targetPath) : targetPath;
  return rel.replace(/\\/g, '/');
}

/** Stable identity of a recorded tag row, for idempotent de-dup. */
function rowKey(tagName: string, provider: string | null, path: string | null): string {
  return `${tagName}:${provider ?? ''}:${path ?? ''}`;
}

/**
 * Record a `tag_added` row for every analytics call site newly introduced by this edit.
 * Returns the number of rows written (0 when disabled, no call sites, or all already
 * recorded). Never throws.
 */
export function recordLiveAnalyticsTags(input: LiveAnalyticsTagInput): number {
  if (!input.analyticsEnabled) {
    return 0;
  }
  try {
    const source = toRepoRelative(input.projectRoot, input.targetPath);
    // Framework-internal files never carry product analytics; skip them.
    if (source.startsWith('.paqad/') || source === '' || source.startsWith('..')) {
      return 0;
    }
    const callSites = extractCallSites(input.newText);
    if (callSites.length === 0) return 0;

    const sessionId = resolveSessionId(input.projectRoot, input.sessionId);
    const ordinal = currentOrdinal(input.projectRoot, ANALYTICS_TAG_DOC_TYPE, sessionId);
    const existing =
      ordinal > 0
        ? (readSessionUnit(
            input.projectRoot,
            ANALYTICS_TAG_DOC_TYPE,
            sessionId,
            ordinal,
          ) as unknown as AnalyticsTagRow[])
        : [];
    const seen = new Set<string>();
    for (const row of existing) {
      if (row.kind === 'tag_added' && typeof row.tag_name === 'string') {
        seen.add(rowKey(row.tag_name, row.tag_provider ?? null, row.source_path ?? null));
      }
    }

    let recorded = 0;
    for (const site of callSites) {
      const key = rowKey(site.eventName, site.provider, source);
      if (seen.has(key)) continue;
      const row = recordAnalyticsTag(
        input.projectRoot,
        { tagName: site.eventName, tagProvider: site.provider, sourcePath: source },
        {
          sessionId,
          adapter: input.adapter ?? 'claude-code',
          analyticsEnabled: true,
          now: input.now,
        },
      );
      if (row) {
        seen.add(key);
        recorded += 1;
      }
    }
    return recorded;
    /* v8 ignore start -- defensive: a live writer must never throw into the edit path */
  } catch {
    return 0;
  }
  /* v8 ignore stop */
}
