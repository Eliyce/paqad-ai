import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { tokenize } from '@/rag/lexical-bm25.js';

import { readAnyDecisionPacket } from '@/decisions/packet-shape.js';

import type { DecisionPacket } from './decision-packet.js';

export interface DecisionPrecedent {
  decision_id: string;
  category: string;
  question: string;
  chosen: string | null;
  rationale?: string;
  resolved_at?: string;
  score: number;
}

export interface PrecedentQuery {
  decision_id?: string;
  fingerprint?: string;
  category: string;
  question: string;
  context?: string;
}

export interface FindPrecedentsOptions {
  limit?: number;
  floor?: number;
}

export const DEFAULT_PRECEDENT_LIMIT = 3;

export const PRECEDENT_SCORE_FLOOR = 0.1;

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
      const packet = readAnyDecisionPacket(
        JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown,
      );
      if (packet) {
        packets.push(packet);
      }
    } catch {}
  }
  return packets;
}

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

export const PRECEDENT_BLOCK_HEADING = 'Similar past decisions you already resolved:';

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
