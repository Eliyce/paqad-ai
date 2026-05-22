export type ContextPriorityTier = 'critical' | 'high' | 'medium' | 'low';

export class PriorityClassifier {
  classify(artifactSource: string, artifactType: string): ContextPriorityTier {
    const src = artifactSource.toLowerCase();
    const type = artifactType.toLowerCase();

    // Critical: rules, constitution, active task spec
    if (
      src.includes('rules/') ||
      src.includes('constitution') ||
      src.includes('.paqad/session/spec') ||
      type === 'rule' ||
      type === 'constitution'
    ) {
      return 'critical';
    }

    // High: recent conversation turns, current file chunks, recent decisions
    if (
      type === 'conversation-turn' ||
      type === 'current-file' ||
      src.includes('recent-decision')
    ) {
      return 'high';
    }

    // Medium: stack docs, session handoff, older summarized turns
    if (
      src.includes('stack-docs') ||
      src.includes('docs/') ||
      type === 'stack-doc' ||
      type === 'handoff' ||
      type === 'summarized-turn'
    ) {
      return 'medium';
    }

    // Low: everything else (exploration tangents, stale chunks)
    return 'low';
  }

  classifyByContent(_content: string, phase: string): ContextPriorityTier {
    if (phase === 'router' || phase === 'constitution') return 'critical';
    if (phase === 'implementation' || phase === 'spec') return 'high';
    if (phase === 'docs' || phase === 'stack') return 'medium';
    return 'low';
  }
}
