import { readContractDecisions } from '@/decisions/authoring.js';
import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';

import { readPipelineConfig } from './config.js';
import { readExperts } from './run-store.js';

export const ROUND_BATCH_SIZE = 4;

export interface RoundPacket {
  id: string;
  category: string;
  title: string;
  recommendation: string | null;
}

export interface RoundMergedClaim {
  target: string;
  merged_claim: string;
}

export interface QuestionRound {
  change: string;
  opener: string | null;
  merged: RoundMergedClaim[];
  packets: RoundPacket[];
  batches: string[][];
}

export function questionRoundAhead(projectRoot: string, dirName: string): boolean {
  if (readChangeConstants(projectRoot, dirName).lane === 'fast') return false;
  return readPipelineConfig(projectRoot).enabled;
}

export function roundOpener(merged: readonly RoundMergedClaim[]): string | null {
  if (merged.length === 0) return null;
  const points = merged.length === 1 ? 'point' : 'points';
  return [
    `The experts agreed on ${merged.length} ${points} after merging overlaps`,
    '',
    '<details>',
    '<summary>What they agreed on</summary>',
    '',
    ...merged.map((entry) => `- ${entry.target}: ${entry.merged_claim}`),
    '',
    '</details>',
  ].join('\n');
}

export function mergedClaims(projectRoot: string, dirName: string): RoundMergedClaim[] {
  const conflicts = readExperts(projectRoot, dirName)?.synthesis?.conflicts ?? [];
  return conflicts
    .filter((conflict) => conflict.ruling === 'compatible' && conflict.merged_claim)
    .map((conflict) => ({ target: conflict.target, merged_claim: conflict.merged_claim! }));
}

export function pendingRoundPackets(projectRoot: string, dirName: string): RoundPacket[] {
  const change = featureChangeKey(dirName);
  return readContractDecisions(projectRoot)
    .filter(({ packet, status }) => status === 'pending' && packet.change === change)
    .map(({ packet }) => ({
      id: packet.id,
      category: packet.category,
      title: packet.title,
      recommendation: packet.recommendation,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function buildQuestionRound(projectRoot: string, dirName: string): QuestionRound {
  const merged = mergedClaims(projectRoot, dirName);
  const packets = pendingRoundPackets(projectRoot, dirName);
  const batches: string[][] = [];
  for (let index = 0; index < packets.length; index += ROUND_BATCH_SIZE) {
    batches.push(packets.slice(index, index + ROUND_BATCH_SIZE).map((packet) => packet.id));
  }
  return {
    change: featureChangeKey(dirName),
    opener: roundOpener(merged),
    merged,
    packets,
    batches,
  };
}
