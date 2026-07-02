// Analytics-tag marker parser (issue #241). Mirrors src/stage-evidence/marker-parse.ts.
//
// A tag write on Codex/Gemini (no PreToolUse seam) — and on Claude at completion as a
// backstop — is surfaced by a machine-parseable control line the agent emits when it
// instruments: `paqad:analytics-tag <name> [<provider> [<path>]]`. At completion this
// parses the turn transcript and records each marker through the SAME recorder verb, so the
// ROW is script-minted (clock + validation) even though the boundary token came from the
// model. Best-effort, idempotent, and flag-gated: a marker already in the ledger is skipped,
// and nothing is recorded when analytics is disabled.

import { currentOrdinal, readSessionUnit } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { recordAnalyticsTag } from './recorder.js';
import { ANALYTICS_TAG_DOC_TYPE, type AnalyticsTagRow } from './types.js';

/** A `paqad:analytics-tag <name> [<provider> [<path>]]` line, anchored to its own line. */
const MARKER = /^[ \t>*-]*paqad:analytics-tag\s+(\S+)(?:\s+(\S+))?(?:\s+(\S+))?\s*$/gim;

export interface AnalyticsMarkerParseInput {
  projectRoot: string;
  /** Raw transcript text; the hook reads the file and passes it (keeps this module fs-free). */
  transcriptText?: string;
  sessionId?: string | null;
  /** Provider whose completion hook is parsing (claude-code, codex-cli, gemini-cli). */
  adapter?: string;
  /** The `analytics_instrumentation` flag state; nothing is recorded when false. */
  analyticsEnabled?: boolean;
  now?: () => Date;
}

interface AnalyticsMarker {
  tagName: string;
  tagProvider: string | null;
  sourcePath: string | null;
}

/** Pull assistant-authored text from a JSONL transcript, ignoring user/system/tool content
 *  so a quoted marker in a loaded contract or a tool result is not mistaken for one the
 *  agent emitted. Falls back to the raw text when the lines are not JSON. */
function extractAssistantText(raw: string): string {
  const parts: string[] = [];
  let sawJson = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    sawJson = true;
    const record = obj as {
      type?: string;
      role?: string;
      message?: { role?: string; content?: unknown };
    };
    const role = record.message?.role ?? record.role ?? record.type;
    if (role !== 'assistant') continue;
    const content = record.message?.content ?? (record as { content?: unknown }).content;
    parts.push(collectText(content));
  }
  return sawJson ? parts.join('\n') : raw;
}

/** Flatten a message `content` (string, or array of `{type:'text',text}` blocks). */
function collectText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) =>
      block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : '',
    )
    .join('\n');
}

/** All analytics-tag markers in the text, in order of appearance. */
export function extractAnalyticsMarkers(text: string): AnalyticsMarker[] {
  const out: AnalyticsMarker[] = [];
  MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER.exec(text)) !== null) {
    out.push({
      tagName: match[1],
      tagProvider: match[2] ?? null,
      sourcePath: match[3] ?? null,
    });
  }
  return out;
}

/** Stable identity of a recorded tag row, for idempotent de-dup. */
function rowKey(tagName: string, provider: string | null, path: string | null): string {
  return `${tagName}:${provider ?? ''}:${path ?? ''}`;
}

/**
 * Parse the transcript and record every not-yet-recorded analytics-tag marker. Returns the
 * number of new rows written. Never throws (best-effort at the completion seam), and records
 * nothing when analytics is disabled.
 */
export function parseAndRecordAnalyticsTags(input: AnalyticsMarkerParseInput): number {
  if (!input.analyticsEnabled) {
    return 0;
  }
  try {
    const raw = input.transcriptText;
    if (!raw) return 0;
    const markers = extractAnalyticsMarkers(extractAssistantText(raw));
    if (markers.length === 0) return 0;

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
    for (const marker of markers) {
      const key = rowKey(marker.tagName, marker.tagProvider, marker.sourcePath);
      if (seen.has(key)) continue;
      const row = recordAnalyticsTag(
        input.projectRoot,
        {
          tagName: marker.tagName,
          tagProvider: marker.tagProvider,
          sourcePath: marker.sourcePath,
        },
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
    /* v8 ignore start -- defensive: marker parsing must never throw at the completion seam */
  } catch {
    return 0;
  }
  /* v8 ignore stop */
}
