import type {
  TurnInput,
  TurnPriority,
  TurnTagPolicy,
  TurnTagResult,
  TaggedTurn,
  ContextHealthWarning,
} from '../core/types/context.js';

export type ContextPriorityTier = 'critical' | 'high' | 'medium' | 'low';

export interface TurnClassifierModel {
  score(turn: TurnInput): TurnPriority;
}

export class InferredTurnClassifierModel implements TurnClassifierModel {
  score(): TurnPriority {
    return 'normal';
  }
}

export class PriorityClassifier {
  private readonly turnModel: TurnClassifierModel;

  constructor(turnModel: TurnClassifierModel = new InferredTurnClassifierModel()) {
    this.turnModel = turnModel;
  }

  tag(turns: TurnInput[], policy?: TurnTagPolicy): TurnTagResult {
    if (turns.length === 0) {
      return { tagged: [], warnings: [] };
    }

    const tagged: TaggedTurn[] = [];
    const warnings: ContextHealthWarning[] = [];

    for (const turn of turns) {
      const protectedTurn = turn.decision_packet === true || turn.approval_turn === true;

      if (protectedTurn && turn.priority === 'high') {
        tagged.push({ ...turn, priority: 'high' });
        continue;
      }

      const scored: TurnPriority = this.turnModel.score(turn);
      let resolved: TurnPriority = policy?.all_normal && !protectedTurn ? 'normal' : scored;

      if (protectedTurn && resolved !== 'high') {
        warnings.push({
          type: 'context.context_health_warning',
          reason: 'priority_invariant_breach',
          turn_id: turn.turn_id,
          classifier_returned: resolved,
          corrected_to: 'high',
        });
        resolved = 'high';
      }

      tagged.push({ ...turn, priority: resolved });
    }

    return { tagged, warnings };
  }

  classify(artifactSource: string, artifactType: string): ContextPriorityTier {
    const src = artifactSource.toLowerCase();
    const type = artifactType.toLowerCase();

    if (
      src.includes('rules/') ||
      src.includes('constitution') ||
      src.includes('.paqad/session/spec') ||
      type === 'rule' ||
      type === 'constitution'
    ) {
      return 'critical';
    }

    if (
      type === 'conversation-turn' ||
      type === 'current-file' ||
      src.includes('recent-decision')
    ) {
      return 'high';
    }

    if (
      src.includes('stack-docs') ||
      src.includes('docs/') ||
      type === 'stack-doc' ||
      type === 'handoff' ||
      type === 'summarized-turn'
    ) {
      return 'medium';
    }

    return 'low';
  }

  classifyByContent(_content: string, phase: string): ContextPriorityTier {
    if (phase === 'router' || phase === 'constitution') return 'critical';
    if (phase === 'implementation' || phase === 'spec') return 'high';
    if (phase === 'docs' || phase === 'stack') return 'medium';
    return 'low';
  }
}
