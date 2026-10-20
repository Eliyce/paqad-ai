export const PIPELINE_STEPS = [
  'ground',
  'label',
  'experts',
  'questions',
  'task',
  'craft',
  'finish',
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export type ClarityLabel = 'vague' | 'okay' | 'clear';

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

export interface LabelArtifact {
  label: ClarityLabel;
  signals: ClaritySignal[];
  question_budget: number;
}

export interface GroundingReference {
  kind: 'doc' | 'glossary' | 'rule';
  ref: string;
}

export type GroundingPath = 'rag' | 'docs-fallback';

export interface VocabularyEntry {
  term: string;
  definition?: string;
  kind: 'glossary' | 'role' | 'flow' | 'rule' | 'technical';
  source: string;
}

export interface GroundingArtifact {
  references: GroundingReference[];
  terms: string[];
  vocabulary?: VocabularyEntry[];
  sparse: boolean;
  path: GroundingPath;
}

export interface PipelineQuestion {
  business_text: string;
  why_it_matters: string;
  options: string[];
  grounded_in: string | null;
  technical_note?: string;
}

export interface PlainLanguageResult {
  ok: boolean;
  flagged: string[];
}

export interface AutoAnswer {
  question: string;
  answer: string;
  source: string;
}

export interface QuestionsArtifact {
  questions: PipelineQuestion[];
  auto_answered: AutoAnswer[];
  asked: number;
  answered: number;
  deferred: number;
  deferred_from_experts?: PipelineQuestion[];
}
