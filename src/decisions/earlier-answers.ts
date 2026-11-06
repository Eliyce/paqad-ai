import { jaccard } from '@/duplication/token-similarity.js';
import { normalizeDecisionQuestion } from '@/planning/decision-fingerprint.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { readResolvedPackets } from '@/planning/decision-precedents.js';

export const EARLIER_SCORE_FLOOR = 0.5;
export const EARLIER_LIMIT = 5;

export const PRIVATE_ANSWER_CATEGORIES: readonly string[] = [
  'authoring.override',
  'authoring.agent_permission',
  'authoring.risky_script',
  'analytics.pii_consent',
];

export interface EarlierQuestionQuery {
  question: string;
  excludeId?: string;
  category?: string;
  now?: Date;
}

export interface EarlierQuestion {
  id: string;
  category: string;
  question: string;
  context: string;
  chosen: string;
  chosen_label: string;
  why: string;
  resolved_at: string;
  score: number;
}

function questionWords(question: string): Set<string> {
  return new Set(normalizeDecisionQuestion(question).split(' ').filter(Boolean));
}

function isCandidate(packet: DecisionPacket, query: EarlierQuestionQuery, now: number): boolean {
  if (packet.decision_id === query.excludeId) return false;
  if (packet.status !== 'resolved' && packet.status !== 'delegated') return false;
  if (!packet.human_response?.chosen_option_key) return false;
  if (Date.parse(packet.ttl_until) < now) return false;
  return !PRIVATE_ANSWER_CATEGORIES.includes(packet.category) || packet.category === query.category;
}

function toEarlierQuestion(packet: DecisionPacket, score: number): EarlierQuestion {
  const response = packet.human_response!;
  const chosen = response.chosen_option_key!;
  return {
    id: packet.decision_id,
    category: packet.category,
    question: packet.question,
    context: packet.context,
    chosen,
    chosen_label: packet.options.find((option) => option.option_key === chosen)!.label,
    why: response.note?.trim() ?? '',
    resolved_at: response.responded_at,
    score,
  };
}

function compareBestFirst(left: EarlierQuestion, right: EarlierQuestion): number {
  if (left.score !== right.score) return right.score - left.score;
  const byTime = Date.parse(right.resolved_at) - Date.parse(left.resolved_at);
  return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
}

export function findEarlierQuestions(
  projectRoot: string,
  query: EarlierQuestionQuery,
): EarlierQuestion[] {
  const words = questionWords(query.question);
  if (words.size === 0) return [];
  const now = (query.now ?? new Date()).getTime();
  return readResolvedPackets(projectRoot)
    .filter((packet) => isCandidate(packet, query, now))
    .map((packet) => toEarlierQuestion(packet, jaccard(words, questionWords(packet.question))))
    .filter((earlier) => earlier.score >= EARLIER_SCORE_FLOOR)
    .sort(compareBestFirst)
    .slice(0, EARLIER_LIMIT);
}
