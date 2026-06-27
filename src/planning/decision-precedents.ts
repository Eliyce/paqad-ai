/**
 * Decision-precedent enrichment (RAG buildout F25).
 *
 * When a new decision pause opens, the developer is more confident and faster if they can
 * see the SIMILAR decisions they (or the team) already resolved. This surfaces the top
 * few prior resolved decisions from `.paqad/decisions/resolved/**`, ranked by a
 * deterministic similarity — same category plus token overlap of the question/context.
 * No embeddings, no LLM call: precedent recall is exact and cheap, and the block is capped
 * so the token cost stays low.
 *
 * The chosen ranking is deliberately deterministic (constraint 3: prefer declared signals
 * over semantic guessing). It complements `DecisionStore.findReusableDecision`, which
 * AUTO-reuses an exact-kind match; this only ADVISES, surfacing related-but-not-identical
 * precedents the human still decides on.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { tokenize } from '@/rag/lexical-bm25.js';

import { isDecisionPacket, type DecisionPacket } from './decision-packet.js';

/** A prior resolved decision surfaced as advisory context for a new pause. */
export interface DecisionPrecedent {
  decision_id: string;
  category: string;
  question: string;
  /** The chosen option's label (or its key), or null when no choice was recorded. */
  chosen: string | null;
  /** The human's free-text note, when present. */
  rationale?: string;
  resolved_at?: string;
  /** Deterministic similarity score in [0, 1]. */
  score: number;
}

/** What a new (or hypothetical) decision is asking — the query side of the match. */
export interface PrecedentQuery {
  /** Exclude this id from the results (the packet's own id). */
  decision_id?: string;
  /** Exclude an exact-fingerprint match (that is `findReusableDecision`'s job). */
  fingerprint?: string;
  category: string;
  question: string;
  context?: string;
}

export interface FindPrecedentsOptions {
  /** Max precedents returned. Defaults to {@link DEFAULT_PRECEDENT_LIMIT}. */
  limit?: number;
  /** Minimum score to surface. Defaults to {@link PRECEDENT_SCORE_FLOOR}. */
  floor?: number;
}

/** Default cap on surfaced precedents (token guard). */
export const DEFAULT_PRECEDENT_LIMIT = 3;

/** Below this score a precedent is too unrelated to surface. */
export const PRECEDENT_SCORE_FLOOR = 0.1;

/** Weight given to a same-category match (the rest comes from token overlap). */
const CATEGORY_WEIGHT = 0.5;

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection++;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deterministic similarity of a resolved packet to the query: same category contributes
 * {@link CATEGORY_WEIGHT}, and the token overlap (Jaccard) of question+context contributes
 * the remaining weight. Pure; range [0, 1].
 */
export function scorePrecedent(query: PrecedentQuery, packet: DecisionPacket): number {
  const sameCategory = query.category === packet.category ? CATEGORY_WEIGHT : 0;
  const queryTokens = new Set(tokenize(`${query.question} ${query.context ?? ''}`));
  const packetTokens = new Set(tokenize(`${packet.question} ${packet.context}`));
  return sameCategory + (1 - CATEGORY_WEIGHT) * jaccard(queryTokens, packetTokens);
}

function chosenLabel(packet: DecisionPacket): string | null {
  const key = packet.human_response?.chosen_option_key;
  if (!key) {
    return null;
  }
  return packet.options.find((option) => option.option_key === key)?.label ?? key;
}

/** Read the resolved decision packets, best-effort (skips unreadable/invalid files). */
function readResolvedPackets(projectRoot: string): DecisionPacket[] {
  const dir = join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR);
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const packets: DecisionPacket[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
      if (isDecisionPacket(parsed)) {
        packets.push(parsed);
      }
    } catch {
      // A corrupt packet file must never break precedent surfacing.
    }
  }
  return packets;
}

/**
 * Find the top resolved-decision precedents for `query`, ranked by {@link scorePrecedent}.
 * Excludes the query's own id and any exact-fingerprint match, keeps only resolved/delegated
 * packets that recorded a human choice, drops anything below the floor, and caps the result.
 * Never throws; returns `[]` when there are no resolved decisions.
 */
export function findDecisionPrecedents(
  projectRoot: string,
  query: PrecedentQuery,
  options: FindPrecedentsOptions = {},
): DecisionPrecedent[] {
  const limit = options.limit ?? DEFAULT_PRECEDENT_LIMIT;
  const floor = options.floor ?? PRECEDENT_SCORE_FLOOR;
  const candidates = readResolvedPackets(projectRoot).filter(
    (packet) =>
      packet.decision_id !== query.decision_id &&
      (!query.fingerprint || packet.fingerprint !== query.fingerprint) &&
      (packet.status === 'resolved' || packet.status === 'delegated') &&
      Boolean(packet.human_response?.chosen_option_key),
  );
  return candidates
    .map((packet) => ({ packet, score: scorePrecedent(query, packet) }))
    .filter((entry) => entry.score >= floor)
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : a.packet.decision_id < b.packet.decision_id
          ? -1
          : 1,
    )
    .slice(0, limit)
    .map(({ packet, score }) => ({
      decision_id: packet.decision_id,
      category: packet.category,
      question: packet.question,
      chosen: chosenLabel(packet),
      rationale: packet.human_response?.note?.trim() || undefined,
      resolved_at: packet.human_response?.responded_at,
      score,
    }));
}

/** Heading the precedent block is keyed by, so it is appended at most once. */
export const PRECEDENT_BLOCK_HEADING = 'Similar past decisions you already resolved:';

/**
 * Format precedents as a compact advisory block for a decision packet's context. Returns
 * `''` when there are none, so callers can append it unconditionally.
 */
export function formatDecisionPrecedents(precedents: readonly DecisionPrecedent[]): string {
  if (precedents.length === 0) {
    return '';
  }
  const lines = precedents.map((precedent) => {
    const choice = precedent.chosen ?? 'no choice recorded';
    const why = precedent.rationale ? ` — ${precedent.rationale}` : '';
    return `- [${precedent.category}] "${precedent.question}" → ${choice}${why}`;
  });
  return `${PRECEDENT_BLOCK_HEADING}\n${lines.join('\n')}`;
}
