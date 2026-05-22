import type { SummarizedTurn } from '../core/types/context.js';

export class TurnSummarizer {
  summarize(turnText: string, turnIndex: number, timestamp: string): SummarizedTurn {
    const summarized: SummarizedTurn = {
      turn_index: turnIndex,
      timestamp,
      decisions: this.extractDecisions(turnText).slice(0, 3),
      files_touched: this.extractFilesTouched(turnText),
      blockers: this.extractBlockers(turnText).slice(0, 2),
      next_steps: this.extractNextSteps(turnText).slice(0, 2),
      original_tokens: this.estimateTokens(turnText),
      summary_tokens: 0,
    };

    summarized.summary_tokens = this.estimateTokens(JSON.stringify(summarized));
    return summarized;
  }

  private extractDecisions(text: string): string[] {
    const decisions: string[] = [];
    const patterns = [
      /(?:decided to|chose|going with|will use|using)\s+([^.\n]{10,80})/gi,
      /(?:going to|selected|picked)\s+([^.\n]{10,80})/gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        decisions.push(match[1].trim());
      }
    }
    return [...new Set(decisions)];
  }

  private extractFilesTouched(text: string): string[] {
    const files: string[] = [];
    const filePattern = /(?:src|app|lib|tests?|routes?|config|docs?)\/[\w/.-]+\.\w{1,6}/g;
    let match;
    while ((match = filePattern.exec(text)) !== null) {
      files.push(match[0]);
    }
    return [...new Set(files)];
  }

  private extractBlockers(text: string): string[] {
    const blockers: string[] = [];
    const pattern =
      /(?:blocked by|waiting on|can't proceed|cannot proceed|error:)\s+([^.\n]{5,100})/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      blockers.push(match[1].trim());
    }
    return blockers;
  }

  private extractNextSteps(text: string): string[] {
    const steps: string[] = [];
    const pattern = /(?:next step|next:|remaining:|TODO:|- \[ \])\s*([^.\n]{5,100})/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      steps.push(match[1].trim());
    }
    return steps;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
