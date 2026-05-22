import { appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import type { SkillModelTier } from '@/core/types/skill.js';

// Tier limits in tokens (approx chars/4)
export const TIER_TOKEN_LIMITS: Record<SkillModelTier, number> = {
  fast: 2000,
  medium: 5000,
  reasoning: 15000,
};

export interface TruncationResult {
  output: string;
  truncated: boolean;
  original_token_estimate: number;
  final_token_estimate: number;
}

export class StreamTruncator {
  constructor(private readonly projectRoot: string) {}

  truncate(
    output: string,
    tier: SkillModelTier,
    maxOutputTokensOverride?: number,
  ): TruncationResult {
    const limit = maxOutputTokensOverride ?? TIER_TOKEN_LIMITS[tier];
    const originalTokens = this.estimateTokens(output);

    if (originalTokens <= limit) {
      return {
        output,
        truncated: false,
        original_token_estimate: originalTokens,
        final_token_estimate: originalTokens,
      };
    }

    const truncated = this.truncateAtSentenceBoundary(output, limit);
    const finalTokens = this.estimateTokens(truncated);

    return {
      output: truncated + '\n\n[truncated]',
      truncated: true,
      original_token_estimate: originalTokens,
      final_token_estimate: finalTokens,
    };
  }

  async logTruncation(skillName: string, result: TruncationResult): Promise<void> {
    if (!result.truncated) return;
    try {
      const auditPath = join(this.projectRoot, '.paqad', 'audit.log');
      await mkdir(dirname(auditPath), { recursive: true });
      const entry = `[${new Date().toISOString()}] WARN truncation skill=${skillName} original=${result.original_token_estimate}t final=${result.final_token_estimate}t\n`;
      await appendFile(auditPath, entry, 'utf8');
    } catch {
      // non-critical
    }
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private truncateAtSentenceBoundary(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;

    // Find the last sentence boundary within maxChars
    const candidate = text.slice(0, maxChars);
    const sentenceEnd = Math.max(
      candidate.lastIndexOf('. '),
      candidate.lastIndexOf('.\n'),
      candidate.lastIndexOf('! '),
      candidate.lastIndexOf('? '),
    );

    if (sentenceEnd > maxChars * 0.5) {
      return text.slice(0, sentenceEnd + 1);
    }

    // Fall back to last newline
    const lastNewline = candidate.lastIndexOf('\n');
    if (lastNewline > maxChars * 0.5) {
      return text.slice(0, lastNewline);
    }

    return candidate;
  }
}
