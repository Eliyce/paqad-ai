// Stage-marker parser (RCA fix, Step 3 — the D2 Stop/retrospective path).
//
// The non-mutation stages (planning, specification-as-thinking, review) produce no
// file edit, so the PreToolUse writer can't see them. Instead the agent emits a
// machine-parseable control line — `paqad:stage <stage> <start|end>` — as part of
// the narration contract. At Stop this parses the turn transcript and records each
// marker through the SAME recorder verbs (via recordMarkedStage), so the ROW is
// script-minted (clock + validation) even though the boundary token came from the
// model. Best-effort and idempotent: a marker already in the ledger is skipped, so
// re-parsing a growing transcript on every Stop never double-records.

import { currentOrdinal, readSessionUnit } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { recordMarkedStage, type MarkedStagePhase } from './live-writer.js';
import { STAGE_EVIDENCE_DOC_TYPE } from './types.js';

/** A `paqad:stage <stage> <start|end>` line, anchored to its own line. */
const MARKER = /^[ \t>*-]*paqad:stage\s+([a-z_]+)\s+(start|end)\s*$/gim;

export interface MarkerParseInput {
  projectRoot: string;
  /** Raw transcript text; the hook reads the file and passes it (keeps this module
   *  pure/fs-free so the dts bundle stays clean). */
  transcriptText?: string;
  sessionId?: string | null;
  /** Provider whose completion hook is parsing (`claude-code`, `codex-cli`,
   *  `gemini-cli`). Threaded onto every recorded row so a cross-provider ledger
   *  attributes each stage to the host that ran it (issue #265). Absent → the
   *  recorder defaults to `claude-code`, preserving the original Stop path. */
  adapter?: string;
  now?: () => Date;
}

export interface Marker {
  stage: string;
  phase: MarkedStagePhase;
}

/** Pull assistant-authored text from a JSONL transcript, ignoring user/system/tool
 *  content so a quoted marker in the loaded contract or a tool result is not
 *  mistaken for one the agent emitted. Falls back to the raw text when the lines
 *  are not JSON (a plain-text transcript). */
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
      content?: unknown;
      // Claude Code nests the turn under `message`; Codex rollout jsonl nests it
      // under `payload` (`{type:'response_item', payload:{type:'message',
      // role:'assistant', content:[{type:'output_text', text}]}}`, issue #313).
      message?: { role?: string; content?: unknown };
      payload?: { role?: string; content?: unknown };
    };
    const container = record.message ?? record.payload;
    const role = container?.role ?? record.role ?? record.type;
    if (role !== 'assistant') continue;
    const content = container?.content ?? record.content;
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

/** All stage markers in the text, in order of appearance. */
export function extractMarkers(text: string): Marker[] {
  const out: Marker[] = [];
  MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER.exec(text)) !== null) {
    out.push({ stage: match[1], phase: match[2] as MarkedStagePhase });
  }
  return out;
}

/**
 * Parse the transcript and record every not-yet-recorded stage marker. Returns the
 * markers a new row was written for — the caller narrates them to the user (the
 * ledger write must never be silent; issue #307 scope). Never throws (best-effort
 * at both the Stop and pre-mutation seams).
 */
export function parseAndRecordMarkers(input: MarkerParseInput): Marker[] {
  try {
    const raw = input.transcriptText;
    if (!raw) return [];
    const markers = extractMarkers(extractAssistantText(raw));
    if (markers.length === 0) return [];

    const sessionId = resolveSessionId(input.projectRoot, input.sessionId);
    const ordinal = currentOrdinal(input.projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId);
    const existing =
      ordinal > 0
        ? readSessionUnit(input.projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId, ordinal)
        : [];
    const seen = new Set<string>();
    for (const row of existing) {
      if (typeof row.stage !== 'string') continue;
      if (row.kind === 'stage_start') seen.add(`${row.stage}:start`);
      if (row.kind === 'stage_end') seen.add(`${row.stage}:end`);
    }

    const recorded: Marker[] = [];
    for (const { stage, phase } of markers) {
      const key = `${stage}:${phase}`;
      if (seen.has(key)) continue;
      if (
        recordMarkedStage(input.projectRoot, {
          sessionId,
          stage,
          phase,
          adapter: input.adapter,
          now: input.now,
        })
      ) {
        seen.add(key);
        recorded.push({ stage, phase });
      }
    }
    return recorded;
  } catch {
    return [];
  }
}
