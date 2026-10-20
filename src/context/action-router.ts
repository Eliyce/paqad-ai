import type { Chunk, ActionRecommendation, SemanticLoadClassification } from './types.js';

export class ActionRouter {
  suggestActions(
    chunks: Chunk[],
    classification: SemanticLoadClassification | undefined,
    workflowIds: string[],
  ): ActionRecommendation[] {
    if (chunks.length === 0 || workflowIds.length === 0) {
      return [];
    }

    const recommendations: ActionRecommendation[] = [];

    for (const workflowId of workflowIds) {
      const triggerKeywords = this.extractTriggerKeywords(workflowId, classification);
      if (triggerKeywords.length === 0) continue;

      const matchingChunks = chunks.filter((chunk) =>
        this.chunkMatchesTrigger(chunk, triggerKeywords),
      );

      if (matchingChunks.length === 0) continue;

      const confidence = Math.min(matchingChunks.length / chunks.length, 1.0);

      recommendations.push({
        action_type: 'workflow',
        confidence: Math.round(confidence * 100) / 100,
        evidence_chunk_ids: matchingChunks.map((c) => c.id),
        workflow_id: workflowId,
        explanation: `Chunks matching [${triggerKeywords.join(', ')}] suggest workflow "${workflowId}" may be applicable.`,
        requires_user_approval: true,
      });
    }

    return recommendations.sort((a, b) => b.confidence - a.confidence);
  }

  private extractTriggerKeywords(
    workflowId: string,
    classification?: SemanticLoadClassification,
  ): string[] {
    const nameKeywords = workflowId
      .split(/[-_]/)
      .map((k) => k.toLowerCase())
      .filter((k) => k.length > 2);

    const classKeywords: string[] = [];
    if (classification?.risk === 'high' && workflowId.includes('pentest')) {
      classKeywords.push('security', 'vulnerability');
    }

    return [...new Set([...nameKeywords, ...classKeywords])];
  }

  private chunkMatchesTrigger(chunk: Chunk, triggerKeywords: string[]): boolean {
    const symbolText = chunk.exported_symbols.join(' ').toLowerCase();
    const contentLower = chunk.content.toLowerCase();

    return triggerKeywords.some((kw) => symbolText.includes(kw) || contentLower.includes(kw));
  }
}
