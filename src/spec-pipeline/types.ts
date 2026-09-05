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

/** Which grounding source produced the artifact — recorded so a run is honest (#520, FR-2.1). */
export type GroundingPath = 'rag' | 'docs-fallback';

/** S0 output — `grounding.json`. References plus the vocabulary terms S1/S2 ground on. */
export interface GroundingArtifact {
  references: GroundingReference[];
  /** Business/domain terms the project defines (glossary + doc headings) — the S1/S2 lens. */
  terms: string[];
  /** True when the touched area has thin/no docs; downstream flags rather than assumes (FR-2.3). */
  sparse: boolean;
  /**
   * Which path produced this grounding (#520, FR-2.1): `rag` when semantic retrieval supplied
   * the terms/references, `docs-fallback` when it came from the docs glob (RAG off or empty).
   */
  path: GroundingPath;
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

/**
 * One ledger-answered question (issue #517, FR-4.5). The answer was injected from a prior
 * resolved decision, so it carries the ledger `source` it came from — never a fabricated
 * answer, always auditable in the readable spec (AC-5).
 */
export interface AutoAnswer {
  /** The plain-language question that was auto-answered (its `business_text`). */
  question: string;
  /** The recorded answer injected from the ledger (a prior decision's chosen option). */
  answer: string;
  /** The ledger reference the answer came from (a resolved decision id). */
  source: string;
}

/**
 * S2 output — `questions.json`. The surviving batch the user is asked, plus the questions the
 * ledger already answered and the FR-7.6 counts. `questions[]` is the only hard-required field
 * (INV-3): an agent batch carrying just `questions[]` still validates, and the record command
 * enriches it with the auto-answer result before the artifact is persisted.
 */
export interface QuestionsArtifact {
  /** The surviving questions actually handed to the user (ledger-answerable ones removed). */
  questions: PipelineQuestion[];
  /** Questions answered from the ledger before the batch reached the user. */
  auto_answered: AutoAnswer[];
  /** How many questions were asked of the user (the surviving batch size). */
  asked: number;
  /** How many the user answered. */
  answered: number;
  /** How many were deferred. */
  deferred: number;
}
