import type { Confidence, Derivation } from './site-map.js';

export const SITE_MAP_ANSWERS_SCHEMA_VERSION = 1;

export const SITE_MAP_ANSWER_CATEGORIES = [
  'app-kind',
  'actors-roles',
  'sensitive-surface',
  'journey-priority',
  'labels-language',
  'grouping',
  'tool-access',
  'journey-scope',
] as const;
export type SiteMapAnswerCategory = (typeof SITE_MAP_ANSWER_CATEGORIES)[number];

export type AnswerDecidedBy = 'human' | 'default';

export interface SiteMapAnswer {
  question_id: string;
  category: SiteMapAnswerCategory;
  question: string;
  answer: string;
  decided_by: AnswerDecidedBy;
  anchors: string[];
}

export interface SiteMapAnswersFile {
  schema_version: number;
  generated_by: string;
  answers: SiteMapAnswer[];
}

export interface CandidateQuestion {
  question_id: string;
  category: SiteMapAnswerCategory;
  question: string;
  anchors: string[];
  recommended_default: { answer: string; reason: string };
}

export interface QuestionReconciliation {
  to_ask: CandidateQuestion[];
  reused: SiteMapAnswer[];
  reopened: string[];
}

export interface AnswerProvenance {
  derivation: Derivation;
  confidence: Confidence;
}
