// Spec-generation pipeline — shared types and step contract (issue #512, Part B).
//
// The pipeline is a DETERMINISTIC step machine. The script owns sequencing and every gate;
// the three "model" steps (S2 questions, S3 task, S4 craft) are agent-run skills whose
// returned artifacts the script validates before advancing (paqad calls no LLM from Node).
// Every step writes one artifact; the next step is locked until that artifact exists and
// passes its check. These types are the artifact shapes and the step vocabulary.

/** The ordered pipeline steps (S0..S5). Sequencing is script-owned; the model never picks. */
export const PIPELINE_STEPS = [
  'ground', // S0 — assemble the business vocabulary/rules for the touched area
  'label', // S1 — rate clarity against the grounding (vague/okay/clear)
  'questions', // S2 — one batched round of plain-language questions (only if needed)
  'task', // S3 — an internal structured restatement of prompt + answers
  'craft', // S4 — write the spec in the freeze-accepted format, every line traced
  'finish', // S5 — freeze (A5-gated) or show a non-blocking readable review
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

/** The clarity label S1 produces, judged against the S0 grounding. */
export type ClarityLabel = 'vague' | 'okay' | 'clear';

/** A single fired clarity signal, recorded with the text span that triggered it (FR-3.3). */
export interface ClaritySignal {
  kind:
    | 'unresolved-vague-word'
    | 'no-measurable-outcome'
    | 'nothing-concrete'
    | 'too-short'
    | 'too-long'
    | 'uncertainty-marker';
  span: string;
}

/** S1 output — `label.json`. Deterministic function of prompt + grounding (FR-3.2). */
export interface LabelArtifact {
  label: ClarityLabel;
  signals: ClaritySignal[];
  /** Question budget the label unlocks (0 for `clear`). */
  question_budget: number;
}

/** A reference pulled during grounding — a pointer, never a copy (FR-2.2). */
export interface GroundingReference {
  kind: 'doc' | 'glossary' | 'rule';
  ref: string;
}

/** S0 output — `grounding.json`. References plus the vocabulary terms S1/S2 ground on. */
export interface GroundingArtifact {
  references: GroundingReference[];
  /** Business/domain terms the project defines (glossary + doc headings) — the S1/S2 lens. */
  terms: string[];
  /** True when the touched area has thin/no docs; downstream flags rather than assumes (FR-2.3). */
  sparse: boolean;
}

/** One question object — the FR-4.1 two-layer contract. */
export interface PipelineQuestion {
  /** What the user sees: plain, the project's vocabulary. */
  business_text: string;
  /** One plain sentence on why the answer matters. */
  why_it_matters: string;
  /** Answers phrased as OUTCOMES, never mechanisms (FR-4.1). */
  options: string[];
  /** Evidence the phrasing was grounded (a doc/glossary ref), or `null` when unconfirmable. */
  grounded_in: string | null;
  /** Internal, kept for the crafting step, never shown to the user. */
  technical_note?: string;
}

/** The result of the deterministic plain-language check over a question (FR-4.3). */
export interface PlainLanguageResult {
  ok: boolean;
  /** Terms that appear in none of the allowed sources (a term from the model's head). */
  flagged: string[];
}
