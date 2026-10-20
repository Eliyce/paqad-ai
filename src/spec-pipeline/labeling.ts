import type { ClarityLabel, ClaritySignal, GroundingArtifact, LabelArtifact } from './types.js';

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

export interface LabelThresholds {
  shortFloor: number;
  longCeiling: number;
  okayBudget: number;
  vagueBudget: number;
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

function resolvedByGrounding(word: string, terms: string[]): boolean {
  const w = word.toLowerCase();
  const stem = w.replace(/(er|est|ed|s)$/, '');
  return terms.some((t) => {
    const lt = t.toLowerCase();
    return lt.includes(w) || (stem.length >= 3 && lt.includes(stem));
  });
}

export function labelPrompt(
  prompt: string,
  grounding: GroundingArtifact,
  thresholds: LabelThresholds = DEFAULT_LABEL_THRESHOLDS,
): LabelArtifact {
  const signals: ClaritySignal[] = [];
  const promptWords = words(prompt);
  const lower = prompt.toLowerCase();

  for (const vague of VAGUE_WORDS) {
    if (promptWords.includes(vague) && !resolvedByGrounding(vague, grounding.terms)) {
      signals.push({ kind: 'unresolved-vague-word', span: vague });
    }
  }

  const hasOutcomeVerb = OUTCOME_VERBS.some((v) => promptWords.includes(v));
  const hasNumber = /\d/.test(prompt);
  if (!hasOutcomeVerb && !hasNumber) {
    signals.push({ kind: 'no-measurable-outcome', span: prompt.slice(0, 60) });
  }

  const mapsToProject = grounding.terms.some((t) => lower.includes(t.toLowerCase()));
  if (!mapsToProject && grounding.terms.length > 0) {
    signals.push({ kind: 'nothing-concrete', span: prompt.slice(0, 60) });
  } else if (grounding.terms.length === 0 && grounding.sparse) {
    signals.push({ kind: 'nothing-concrete', span: '(no project vocabulary grounded)' });
  }

  if (promptWords.length < thresholds.shortFloor) {
    signals.push({ kind: 'too-short', span: `${promptWords.length} words` });
  } else if (promptWords.length > thresholds.longCeiling) {
    signals.push({ kind: 'too-long', span: `${promptWords.length} words` });
  }

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

function labelFromSignalCount(count: number): ClarityLabel {
  if (count === 0) return 'clear';
  if (count <= 2) return 'okay';
  return 'vague';
}
