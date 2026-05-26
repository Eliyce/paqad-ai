import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { ageInDays, bandForScore } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';
import { scanDirectory } from './fs-helpers.js';

interface DecisionPacket {
  id?: string;
  title?: string;
  category?: string;
  created_at?: string;
}

interface PacketWithAge {
  id: string;
  title: string;
  ageDays: number;
}

const HELPER = {
  what: 'The Decision Pause Contract surfaces every flagged scope/security/architecture choice as a packet in .paqad/decisions/pending/. Agents must wait for resolution before continuing.',
  goodLooksLike: 'Zero pending packets, or pending packets resolved within a couple of days.',
} as const;

function readPacket(absPath: string): DecisionPacket | null {
  try {
    return JSON.parse(readFileSync(absPath, 'utf8')) as DecisionPacket;
  } catch {
    return null;
  }
}

function collectPending(projectRoot: string, now: number): PacketWithAge[] {
  const dir = join(projectRoot, PATHS.DECISIONS_PENDING_DIR);
  if (!existsSync(dir)) return [];
  const out: PacketWithAge[] = [];
  for (const entry of scanDirectory(dir, { maxDepth: 1, fileFilter: (n) => n.endsWith('.json') })) {
    const packet = readPacket(entry.absPath);
    if (packet === null) continue;
    const createdAt = packet.created_at !== undefined ? Date.parse(packet.created_at) : NaN;
    const refMs = Number.isFinite(createdAt) ? createdAt : entry.mtimeMs;
    out.push({
      id: packet.id ?? entry.relPath,
      title: packet.title ?? entry.relPath,
      ageDays: ageInDays(refMs, now) ?? 0,
    });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

function countJson(projectRoot: string, rel: string): number {
  const dir = join(projectRoot, rel);
  if (!existsSync(dir)) return 0;
  return scanDirectory(dir, { maxDepth: 1, fileFilter: (n) => n.endsWith('.json') }).length;
}

/**
 * Score the decisions section. Algorithm:
 *
 * - No decisions dir at all → unknown (project doesn't use the contract).
 * - 0 pending → 100.
 * - For each pending packet, lose points by age:
 *     ≤ 1 day → 10, ≤ 3 days → 20, ≤ 7 days → 35, > 7 days → 50.
 * - Floor at 0.
 */
function scorePending(pending: PacketWithAge[]): number {
  if (pending.length === 0) return 100;
  let penalty = 0;
  for (const p of pending) {
    if (p.ageDays <= 1) penalty += 10;
    else if (p.ageDays <= 3) penalty += 20;
    else if (p.ageDays <= 7) penalty += 35;
    else penalty += 50;
  }
  return Math.max(0, 100 - penalty);
}

export interface DecisionsResult {
  section: SectionData;
  attention: AttentionItem[];
}

export function collectDecisions(projectRoot: string, now: number = Date.now()): DecisionsResult {
  const dir = join(projectRoot, PATHS.DECISIONS_DIR);
  if (!existsSync(dir)) {
    return {
      section: {
        id: 'decisions',
        title: 'Decisions',
        band: 'unknown',
        score: null,
        summary: 'No decisions directory — not using the Decision Pause Contract.',
        metrics: [],
        helper: HELPER,
      },
      attention: [],
    };
  }

  const pending = collectPending(projectRoot, now);
  const resolved = countJson(projectRoot, PATHS.DECISIONS_RESOLVED_DIR);
  const expired = countJson(projectRoot, PATHS.DECISIONS_EXPIRED_DIR);

  const score = scorePending(pending);
  const oldest = pending[0] ?? null;
  const summary =
    pending.length === 0
      ? `Clear · ${resolved} resolved · ${expired} expired`
      : `${pending.length} pending${oldest ? ` · oldest ${oldest.ageDays}d` : ''}`;

  const attention: AttentionItem[] = pending
    .filter((p) => p.ageDays >= 1)
    .slice(0, 3)
    .map((p) => ({
      sectionId: 'decisions',
      message: `Decision ${p.id} pending ${p.ageDays}d — ${p.title}`,
      severity: p.ageDays >= 7 ? 'critical' : p.ageDays >= 3 ? 'warn' : 'info',
    }));

  return {
    section: {
      id: 'decisions',
      title: 'Decisions',
      band: bandForScore(score),
      score,
      summary,
      metrics: [
        { label: 'pending', value: String(pending.length) },
        { label: 'resolved', value: String(resolved) },
        { label: 'expired', value: String(expired) },
      ],
      helper: HELPER,
      details: {
        pending: pending.map((p) => ({ id: p.id, title: p.title, ageDays: p.ageDays })),
      },
    },
    attention,
  };
}
