import type { Chunk, ActionRecommendation, SemanticLoadClassification } from './types.js';

/**
 * ActionRouter maps retrieved chunk evidence to bounded workflow recommendations.
 *
 * Safety constraints enforced by this class:
 * - `requires_user_approval` is always `true` — auto-execution is never triggered.
 * - `evidence_chunk_ids` reference chunk IDs, not raw chunk text.
 * - `explanation` is a template string derived from workflow/keyword names only.
 * - Invalid workflow IDs (not in registry) are silently dropped.
 * - Retrieved text never directly controls schema fields.
 */
export class ActionRouter {
  /**
   * Suggest workflows based on chunk content and classification signals.
   *
   * @param chunks - Packed chunks from the semantic load
   * @param classification - Task classification signals
   * @param workflowIds - Valid workflow IDs from the registry
   * @returns Validated, evidence-backed action recommendations
   */
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

    // Sort by confidence descending
    return recommendations.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Derives trigger keywords from the workflow ID and classification signals.
   * Keywords come from the workflow name only — never from raw chunk text.
   */
  private extractTriggerKeywords(
    workflowId: string,
    classification?: SemanticLoadClassification,
  ): string[] {
    // Split hyphenated workflow ID into keywords (e.g. 'root-cause-analysis' → ['root', 'cause', 'analysis'])
    const nameKeywords = workflowId
      .split(/[-_]/)
      .map((k) => k.toLowerCase())
      .filter((k) => k.length > 2);

    // Add classification-derived keywords
    const classKeywords: string[] = [];
    if (classification?.risk === 'high' && workflowId.includes('pentest')) {
      classKeywords.push('security', 'vulnerability');
    }

    return [...new Set([...nameKeywords, ...classKeywords])];
  }

  /**
   * Checks if a chunk's exported symbols or content keywords match any trigger keyword.
   * Uses symbol names and content word matching — not raw content injection.
   */
  private chunkMatchesTrigger(chunk: Chunk, triggerKeywords: string[]): boolean {
    const symbolText = chunk.exported_symbols.join(' ').toLowerCase();
    const contentLower = chunk.content.toLowerCase();

    return triggerKeywords.some((kw) => symbolText.includes(kw) || contentLower.includes(kw));
  }
}
