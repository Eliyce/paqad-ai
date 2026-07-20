// Turn-narration audit (issue #409) — the deterministic backstop for the VOICE.
//
// The stage-evidence ledger already proves a stage ran. Nothing proved the developer
// was ever TOLD. On Claude Code Desktop the hooks' `{systemMessage}` narration is
// recorded as a hook attachment and never rendered, so a change could complete with a
// perfect evidence bundle and a silent chat — recorded but unnarrated, the exact
// inverse of the narrated-but-unrecorded gap (#389).
//
// This module closes that loop. It reads the turn transcript, works out which stages
// were narrated in the agent's own VISIBLE text, and reports the recorded stages that
// were not. Hook output never counts: `extractAssistantText` (reused from the marker
// parser, so the two can never disagree about the same transcript) reads only assistant
// message content, and a `{systemMessage}` payload is not assistant message content.
//
// The finding is ADVISORY by contract. An unnarrated turn is a voice defect, not a
// broken change, so it must never turn a passing verdict into a failing one or block a
// turn — a session wedged over a cosmetic miss would be a worse bug than the silence.

import { extractAssistantText } from './marker-parse.js';
import { STAGE_NARRATION } from './narration.js';
import { STAGE_EVIDENCE_STAGES, isKnownStage, type StageId } from './stages.js';

/** The branded prefix every narration line carries. Text without it is not paqad speaking. */
const NARRATION_PREFIX = '▸ paqad';

export interface AuditTurnNarrationInput {
  /** Raw transcript (JSONL, or plain text for hosts that write one). */
  transcriptText: string;
  /** Stage ids recorded during this turn, in any order. */
  recorded: readonly string[];
}

/**
 * The stages recorded this turn that carry no matching visible narration line, in
 * canonical stage order.
 *
 * A stage counts as narrated when some `▸ paqad` line in the agent's visible text
 * mentions it — either by the canonical narration text the contract asks for, or by the
 * stage's own name, which gives an agent that phrases the line its own way reasonable
 * latitude without accepting silence.
 *
 * Fail-open by design: an empty, unreadable, or malformed transcript, and an unknown
 * stage id, all yield no finding rather than an error (INV-3).
 */
export function auditTurnNarration(input: AuditTurnNarrationInput): StageId[] {
  // No transcript is "cannot tell", not "said nothing" — never accuse on absent evidence.
  if (!input.transcriptText) return [];

  const pending = new Set(input.recorded.filter(isKnownStage));
  if (pending.size === 0) return [];

  const narrationLines = paqadLines(extractAssistantText(input.transcriptText));

  return STAGE_EVIDENCE_STAGES.filter(
    (stage): stage is StageId =>
      pending.has(stage as StageId) &&
      !narrationLines.some((line) => mentionsStage(line, stage as StageId)),
  );
}

/**
 * The model-facing instruction attached when a turn recorded stages it never spoke.
 * It names the silent stages and asks for the receipt in the one place Desktop reliably
 * renders — the final message — so the fix is unambiguous. Empty when nothing is silent,
 * so a caller can treat `''` as "no advisory".
 */
export function unnarratedAdvisory(stages: readonly StageId[]): string {
  if (stages.length === 0) return '';
  const names = stages.join(', ');
  return (
    `${NARRATION_PREFIX} · you recorded ${stages.length === 1 ? 'a stage' : 'stages'} you never ` +
    `said out loud: ${names}.\n` +
    'The hook narration does not render on Claude Code Desktop, so the developer saw nothing. ' +
    'Include the end-of-change receipt and one `▸ paqad` line per stage above in your VISIBLE ' +
    'reply, in the final message of this turn — text emitted between tool calls is not ' +
    'reliably rendered.'
  );
}

/** Every `▸ paqad` line in `text`, trimmed. Non-narration prose is ignored. */
function paqadLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(NARRATION_PREFIX));
}

/** True when `line` names `stage`, by canonical narration text or by stage name. */
function mentionsStage(line: string, stage: StageId): boolean {
  const haystack = line.toLowerCase();
  return (
    haystack.includes(STAGE_NARRATION[stage].toLowerCase()) ||
    haystack.includes(stage.replace(/_/g, ' ')) ||
    haystack.includes(stage)
  );
}
