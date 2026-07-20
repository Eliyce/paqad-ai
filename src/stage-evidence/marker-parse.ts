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

import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { routeIsAffirmativelyNonFeature } from '@/pipeline/route-gate.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { normalizeArtifactPath } from './artifact-path.js';
import { checkBundleArtifacts } from './bundle-artifact.js';
import { recordMarkedStage, type MarkedStagePhase } from './live-writer.js';

/**
 * A `paqad:stage <stage> <start|end>` line, anchored to its own line. A stage-end may
 * carry an artifact the recorder hashes to prove the stage produced real work (issue
 * #320): `paqad:stage <stage> end -- <artifact-path>`. The path (group 3) is optional
 * and only meaningful on an `end`; `start` never takes one.
 */
const MARKER = /^[ \t>*-]*paqad:stage\s+([a-z_]+)\s+(start|end)(?:\s+--\s+(\S+))?\s*$/gim;

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
  /** Project-relative artifact path carried by a `... end -- <path>` marker (issue
   *  #320). Undefined for a bare marker or any `start`. */
  artifactPath?: string;
}

/** Pull assistant-authored text from a JSONL transcript, ignoring user/system/tool
 *  content so a quoted marker in the loaded contract or a tool result is not
 *  mistaken for one the agent emitted. Falls back to the raw text when the lines
 *  are not JSON (a plain-text transcript).
 *
 *  Exported because the narration audit (issue #409) needs exactly this notion of
 *  "what the agent actually said" — hook output and tool results are not the agent
 *  speaking. Two copies of this rule would let the audit and the marker parser
 *  disagree about the same transcript. */
export function extractAssistantText(raw: string): string {
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
    const marker: Marker = { stage: match[1], phase: match[2] as MarkedStagePhase };
    // An artifact path is only meaningful on an `end` — ignore one on a `start`.
    if (marker.phase === 'end' && match[3]) marker.artifactPath = match[3];
    out.push(marker);
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
    // Issue #390: never record markers — and so never auto-open a change-<ULID> bundle
    // + _session control — for a route we can prove is NOT feature-development. Only
    // feature-development may create feature-evidence. An absent route (Codex/Gemini,
    // which never write route state) is NOT proven non-feature, so it records as before.
    if (routeIsAffirmativelyNonFeature(input.projectRoot, sessionId)) return [];
    const dirName = currentFeature(input.projectRoot, sessionId);
    const existing = dirName ? readFeatureStageUnit(input.projectRoot, dirName) : [];
    const seen = new Set<string>();
    for (const row of existing) {
      if (typeof row.stage !== 'string') continue;
      if (row.kind === 'stage_start') seen.add(`${row.stage}:start`);
      if (row.kind === 'stage_end') seen.add(`${row.stage}:end`);
    }

    const recorded: Marker[] = [];
    for (const { stage, phase, artifactPath } of markers) {
      const key = `${stage}:${phase}`;
      if (seen.has(key)) continue;
      // Give a marker's artifact path the SAME boundary treatment as the CLI flag
      // (issue #350): normalize an in-tree path (absolute or relative) to project-
      // relative, and DROP a genuinely out-of-tree path rather than record it as a
      // false-absent digest. The parser is best-effort, so an out-of-tree path records
      // the boundary without an artifact (honestly inconclusive) instead of throwing.
      let normalizedArtifact: string | undefined;
      if (artifactPath) {
        // normalizeArtifactPath throws only ArtifactOutOfTreeError; drop the artifact on
        // an out-of-tree path so the boundary still records — honestly inconclusive,
        // never a false-absent digest.
        try {
          normalizedArtifact = normalizeArtifactPath(input.projectRoot, artifactPath);
        } catch {
          normalizedArtifact = undefined;
        }
        // Issue #394: a planning/specification/review stage-end proves itself ONLY with the
        // active bundle's rigid plan.json / specification.json / review.json. Drop any other
        // artifact (the same silent-drop treatment as an out-of-tree path) so the recorder
        // hashes no digest and the stage folds inconclusive — forcing `plan compile` /
        // `spec freeze` / `review record`.
        //
        // Issue #402: drop on `accepted` alone, NOT on `rigid`. A mutation stage's artifact
        // written into a bundle dir is rejected too, and gating this on `rigid` would enforce
        // that only for the `stage` CLI — leaving the chat-marker path (the primary Claude
        // Code path) accepting the very stray this issue is about. Both callers must agree.
        if (normalizedArtifact) {
          const check = checkBundleArtifacts(input.projectRoot, sessionId, stage, [
            normalizedArtifact,
          ]);
          if (check.accepted.length === 0) {
            normalizedArtifact = undefined;
          }
        }
      }
      if (
        recordMarkedStage(input.projectRoot, {
          sessionId,
          stage,
          phase,
          artifactPaths: normalizedArtifact ? [normalizedArtifact] : undefined,
          adapter: input.adapter,
          now: input.now,
        })
      ) {
        seen.add(key);
        recorded.push({ stage, phase, artifactPath });
      }
    }
    return recorded;
  } catch {
    return [];
  }
}
