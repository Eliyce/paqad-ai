import { extractAssistantText } from './marker-parse.js';
import { STAGE_NARRATION } from './narration.js';
import { STAGE_EVIDENCE_STAGES, isKnownStage, type StageId } from './stages.js';
import { type StageEvidenceSource } from './types.js';

const NARRATION_PREFIX = '▸ paqad';

export function isAgentNarratableStage(evidenceSource: StageEvidenceSource): boolean {
  return evidenceSource === 'live-mark' || evidenceSource === 'redo';
}

export interface AuditTurnNarrationInput {
  transcriptText: string;
  recorded: readonly string[];
}

export function auditTurnNarration(input: AuditTurnNarrationInput): StageId[] {
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

function paqadLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(NARRATION_PREFIX));
}

function mentionsStage(line: string, stage: StageId): boolean {
  const haystack = line.toLowerCase();
  return (
    haystack.includes(STAGE_NARRATION[stage].toLowerCase()) ||
    haystack.includes(stage.replace(/_/g, ' ')) ||
    haystack.includes(stage)
  );
}
