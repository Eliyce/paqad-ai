// Clarity labeling against grounding (issue #512, S1 / FR-3).
//
// The clarity label (vague/okay/clear) is a DETERMINISTIC function of the prompt AND the S0
// grounding — never the model's self-assessment (FR-3.2), and it costs zero model tokens
// (FR-3-T4). Clarity is relative to what the project already documents: a vague-looking word
// the docs define does not count as vague (FR-3.1), and a named thing that maps to nothing
// real still counts as unclear (FR-3-T2). Every fired signal is recorded with the text span
// that triggered it (FR-3.3).

import type { ClarityLabel, ClaritySignal, GroundingArtifact, LabelArtifact } from './types.js';

/** Vague adjectives/verbs that signal an unmeasurable ask unless the docs define them. */
const VAGUE_WORDS = [
  'cleaner',
  'clean',
  'better',
  'nicer',
  'nice',
  'improve',
  'improved',
  'robust',
  'simple',
  'simpler',
  'modern',
  'good',
  'proper',
  'reasonable',
  'appropriate',
  'flexible',
  'scalable',
  'seamless',
  'smooth',
  'stuff',
  'things',
];

/** Verbs that name a measurable, observable outcome. */
const OUTCOME_VERBS = [
  'return',
  'returns',
  'show',
  'shows',
  'display',
  'save',
  'saves',
  'store',
  'reject',
  'rejects',
  'create',
  'creates',
  'delete',
  'deletes',
  'remove',
  'export',
  'exports',
  'import',
  'validate',
  'validates',
  'block',
  'blocks',
  'allow',
  'allows',
  'send',
  'sends',
  'add',
  'adds',
  'render',
  'renders',
  'write',
  'writes',
  'record',
  'records',
  'freeze',
  'compute',
];

/** Explicit uncertainty markers. */
const UNCERTAINTY_MARKERS = [
  'maybe',
  'not sure',
  'something like',
  'i think',
  'probably',
  'or something',
  'kind of',
  'sort of',
];

/** Tunable thresholds for the clarity function (FR-3.4). */
export interface LabelThresholds {
  shortFloor: number; // fewer words ⇒ too-short
  longCeiling: number; // more words ⇒ too-long
  okayBudget: number; // question budget for `okay`
  vagueBudget: number; // question budget for `vague`
}

export const DEFAULT_LABEL_THRESHOLDS: LabelThresholds = {
  shortFloor: 4,
  longCeiling: 120,
  okayBudget: 3,
  vagueBudget: 6,
};

function words(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/** True when a vague word is resolved by the grounding (a doc/glossary term contains it). */
function resolvedByGrounding(word: string, terms: string[]): boolean {
  const w = word.toLowerCase();
  const stem = w.replace(/(er|est|ed|s)$/, '');
  return terms.some((t) => {
    const lt = t.toLowerCase();
    return lt.includes(w) || (stem.length >= 3 && lt.includes(stem));
  });
}

/**
 * Label a prompt's clarity against the grounding. Pure and deterministic: same prompt +
 * grounding always yields the same label and signals (FR-3-T3), zero model tokens.
 */
export function labelPrompt(
  prompt: string,
  grounding: GroundingArtifact,
  thresholds: LabelThresholds = DEFAULT_LABEL_THRESHOLDS,
): LabelArtifact {
  const signals: ClaritySignal[] = [];
  const promptWords = words(prompt);
  const lower = prompt.toLowerCase();

  // Unresolved vague words.
  for (const vague of VAGUE_WORDS) {
    if (promptWords.includes(vague) && !resolvedByGrounding(vague, grounding.terms)) {
      signals.push({ kind: 'unresolved-vague-word', span: vague });
    }
  }

  // No measurable outcome: no outcome verb and no number anywhere.
  const hasOutcomeVerb = OUTCOME_VERBS.some((v) => promptWords.includes(v));
  const hasNumber = /\d/.test(prompt);
  if (!hasOutcomeVerb && !hasNumber) {
    signals.push({ kind: 'no-measurable-outcome', span: prompt.slice(0, 60) });
  }

  // Nothing concrete that maps to the project: no grounding term appears in the prompt.
  const mapsToProject = grounding.terms.some((t) => lower.includes(t.toLowerCase()));
  if (!mapsToProject && grounding.terms.length > 0) {
    signals.push({ kind: 'nothing-concrete', span: prompt.slice(0, 60) });
  } else if (grounding.terms.length === 0 && grounding.sparse) {
    // No documented vocabulary at all to map against.
    signals.push({ kind: 'nothing-concrete', span: '(no project vocabulary grounded)' });
  }

  // Length bounds.
  if (promptWords.length < thresholds.shortFloor) {
    signals.push({ kind: 'too-short', span: `${promptWords.length} words` });
  } else if (promptWords.length > thresholds.longCeiling) {
    signals.push({ kind: 'too-long', span: `${promptWords.length} words` });
  }

  // Uncertainty markers.
  for (const marker of UNCERTAINTY_MARKERS) {
    if (lower.includes(marker)) {
      signals.push({ kind: 'uncertainty-marker', span: marker });
    }
  }

  const label = labelFromSignalCount(signals.length);
  const question_budget =
    label === 'clear' ? 0 : label === 'okay' ? thresholds.okayBudget : thresholds.vagueBudget;
  return { label, signals, question_budget };
}

/** The fixed signal-count → label mapping (FR-3.3). */
function labelFromSignalCount(count: number): ClarityLabel {
  if (count === 0) return 'clear';
  if (count <= 2) return 'okay';
  return 'vague';
}
