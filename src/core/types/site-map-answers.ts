// Types for the persisted site-map creation answers (issue #466, Part A: one-step creation
// with inline questions). The single creation action and the actual asking are AI-driven at
// author time; this artifact is the durable record of the decisions the person made, so a
// later re-creation or documentation-sync does not re-ask a settled question (OSC-18), and so
// each map element can honestly show whether a human decided it (OSC-19) or it fell to the
// documented default (OSC-14). Persisted as `docs/site-map/answers.yaml`, validated by the
// committed schema in src/validators/schemas/site-map-answers.schema.json.

import type { Confidence, Derivation } from './site-map.js';

/** Bumped when the persisted answers shape changes; the store rejects a mismatched file. */
export const SITE_MAP_ANSWERS_SCHEMA_VERSION = 1;

/**
 * The closed list of things the creation flow is allowed to ask about (OSC-16). The flow MUST
 * NOT invent questions outside these categories, so the persisted answer carries which one it
 * settled:
 *  - `app-kind`          — which application shape, only when auto-detection is ambiguous.
 *  - `actors-roles`      — who uses the app and which guards each role satisfies.
 *  - `sensitive-surface` — whether an unguarded, reachable surface is intended to be public.
 *  - `journey-priority`  — which proposed journeys are real and which matter most (top-N).
 *  - `labels-language`   — which human label to show for a keyed string, or the default locale.
 *  - `grouping`          — how to name or group areas (districts) when auto-grouping is low.
 */
export const SITE_MAP_ANSWER_CATEGORIES = [
  'app-kind',
  'actors-roles',
  'sensitive-surface',
  'journey-priority',
  'labels-language',
  'grouping',
] as const;
export type SiteMapAnswerCategory = (typeof SITE_MAP_ANSWER_CATEGORIES)[number];

/**
 * Who settled the value. `human` is a person's confirmed choice (OSC-19); `default` is the
 * documented best guess taken because the run was non-interactive or the person skipped the
 * question (OSC-13/OSC-14). The distinction drives {@link provenanceOf} so a defaulted element
 * is never shown as user-confirmed.
 */
export type AnswerDecidedBy = 'human' | 'default';

/** One persisted answer to one creation-time question. */
export interface SiteMapAnswer {
  /** Stable identity of the question this answers; reconciliation keys on it. */
  question_id: string;
  /** Which of the closed categories (OSC-16) the question belongs to. */
  category: SiteMapAnswerCategory;
  /** The plain-language question that was asked (OSC-17), kept so the answer stays reviewable. */
  question: string;
  /** The chosen value (an option id or free text). */
  answer: string;
  /** Whether a person decided it (OSC-19) or it fell to the documented default (OSC-13/14). */
  decided_by: AnswerDecidedBy;
  /**
   * The `file:line` code anchors that motivated the question. A change to this set reopens the
   * question on the next run (OSC-18), so a settled answer is never silently applied to code it
   * no longer describes. Stored sorted so equality is order-independent.
   */
  anchors: string[];
}

/** The persisted answers artifact (`docs/site-map/answers.yaml`). */
export interface SiteMapAnswersFile {
  schema_version: number;
  generated_by: string;
  answers: SiteMapAnswer[];
}

/**
 * A question the creation flow is about to ask, computed from the assembled map before asking.
 * Reconciliation matches it against persisted answers by `question_id` and current `anchors`.
 */
export interface CandidateQuestion {
  question_id: string;
  category: SiteMapAnswerCategory;
  /** The plain-language question, stating why it is asked (OSC-17). */
  question: string;
  /** The current `file:line` anchors motivating it; compared against a persisted answer's. */
  anchors: string[];
  /** A recommended default with its reason, so the person can accept quickly (OSC-10). */
  recommended_default: { answer: string; reason: string };
}

/** The outcome of reconciling candidate questions against the persisted answers. */
export interface QuestionReconciliation {
  /** Questions still to ask this run: never answered, or reopened by changed code (OSC-18). */
  to_ask: CandidateQuestion[];
  /** Persisted human answers reused as-is (OSC-19): normal confidence, human provenance. */
  reused: SiteMapAnswer[];
  /** Ids of persisted human answers whose motivating anchors changed, so they are re-asked. */
  reopened: string[];
}

/** How a persisted answer maps onto a map element's provenance (the honesty seam, OSC-14/19). */
export interface AnswerProvenance {
  derivation: Derivation;
  confidence: Confidence;
}
