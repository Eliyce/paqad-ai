import type { PipelineQuestion } from '../types.js';
import type { ExpertNeedArtifact } from './types.js';
import type { ExpertNotesArtifact } from './notes.js';
import type { ExpertSynthesis } from './synthesis.js';
import { MAX_EXPERT_QUESTIONS } from './types.js';

function normalize(question: PipelineQuestion): string {
  return question.business_text.trim().toLowerCase().replace(/\s+/g, ' ');
}

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
    if (seen.has(key)) continue;
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
