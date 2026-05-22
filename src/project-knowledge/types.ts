export const ANSWER_GROUNDING_STATES = ['observed', 'inferred', 'missing-evidence'] as const;
export type AnswerGroundingState = (typeof ANSWER_GROUNDING_STATES)[number];

export const ANSWER_MODES = ['quick', 'explain', 'trace'] as const;
export type AnswerMode = (typeof ANSWER_MODES)[number];

export const CITATION_SOURCE_CLASSES = [
  'canonical-doc',
  'generated-instruction',
  'framework-state',
  'manifest',
  'workflow',
  'code',
] as const;
export type CitationSourceClass = (typeof CITATION_SOURCE_CLASSES)[number];

export interface Citation {
  path: string;
  source_class: CitationSourceClass;
  excerpt?: string;
}

export interface FreshnessMetadata {
  stale_sources: string[];
  drift_detected: boolean;
  generated_at?: string;
  note?: string;
}

export interface Contradiction {
  source_a: string;
  source_b: string;
  description: string;
}

export interface KnowledgeAnswer {
  answer: string;
  grounding_state: AnswerGroundingState;
  citations: Citation[];
  freshness: FreshnessMetadata | null;
  contradictions: Contradiction[];
  next_actions: string[];
  mode: AnswerMode;
  confidence_basis: string;
}

export interface AnswerQuery {
  question: string;
  mode: AnswerMode;
  project_root: string;
  mcp_first?: boolean;
}
