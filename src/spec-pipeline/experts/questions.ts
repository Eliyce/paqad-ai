// Merge the expert and chief questions into the single S2 batch (issue #547, FR-7).
//
// The label's own question budget bounds the agent's enrichment questions; the expert and chief
// questions are bounded on top by MAX_EXPERT_QUESTIONS, taken in order (chief gaps first, then the
// chief's own questions, then the experts in need order). A question already asked is not asked
// twice, and anything past the cap is recorded as deferred, never silently lost. Deterministic.

import type { PipelineQuestion } from '../types.js';
import type { ExpertNeedArtifact } from './types.js';
import type { ExpertNotesArtifact } from './notes.js';
import type { ExpertSynthesis } from './synthesis.js';
import { MAX_EXPERT_QUESTIONS } from './types.js';

function normalize(question: PipelineQuestion): string {
  return question.business_text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The expert and chief questions in priority order: the chief's gap questions, then the chief's own
 * questions, then each expert's questions in the order the need artifact named them.
 */
export function collectExpertQuestions(
  need: ExpertNeedArtifact | null,
  notes: ExpertNotesArtifact | null,
  synthesis: ExpertSynthesis | null,
): PipelineQuestion[] {
  const out: PipelineQuestion[] = [];
  if (synthesis) {
    for (const gap of synthesis.gaps) {
      if (gap.question) out.push(gap.question);
    }
    for (const question of synthesis.questions) out.push(question);
  }
  if (need && notes) {
    for (const expert of need.experts) {
      const note = notes.notes.find((entry) => entry.role === expert.role);
      for (const question of note?.questions ?? []) out.push(question);
    }
  }
  return out;
}

export interface MergedQuestionBatch {
  questions: PipelineQuestion[];
  deferred_from_experts: PipelineQuestion[];
}

/**
 * Merge the enrichment batch (bounded by the label's `questionBudget`) with the expert and chief
 * questions (bounded by `MAX_EXPERT_QUESTIONS`), de-duplicated on the plain-language text. Returns
 * the surviving batch and the expert/chief questions the cap deferred.
 */
export function mergeQuestionBatch(
  enrichment: readonly PipelineQuestion[],
  expertChief: readonly PipelineQuestion[],
  questionBudget: number,
): MergedQuestionBatch {
  const seen = new Set<string>();
  const questions: PipelineQuestion[] = [];
  for (const question of enrichment.slice(0, Math.max(0, questionBudget))) {
    const key = normalize(question);
    if (!seen.has(key)) {
      seen.add(key);
      questions.push(question);
    }
  }
  const deferred: PipelineQuestion[] = [];
  let taken = 0;
  for (const question of expertChief) {
    const key = normalize(question);
    if (seen.has(key)) continue; // already asked by the enrichment or an earlier expert
    if (taken >= MAX_EXPERT_QUESTIONS) {
      deferred.push(question);
      continue;
    }
    seen.add(key);
    questions.push(question);
    taken += 1;
  }
  return { questions, deferred_from_experts: deferred };
}
