import type {
  TurnInput,
  TurnPriority,
  TurnTagPolicy,
  TurnTagResult,
  TaggedTurn,
  ContextHealthWarning,
} from '../core/types/context.js';

export type ContextPriorityTier = 'critical' | 'high' | 'medium' | 'low';

/**
 * Pluggable model that scores a single conversation turn. Injected into
 * `PriorityClassifier` so a test (or a future inference-backed model) can control
 * the raw tag a turn receives before the engine applies its invariants. The score
 * for a protected turn is advisory only — `tag` always overrides it to `high`.
 *
 * @since 1.10.0
 */
export interface TurnClassifierModel {
  score(turn: TurnInput): TurnPriority;
}

/**
 * Default heuristic turn model. v1 has no signal that promotes an ordinary turn,
 * so every unprotected turn scores `normal` (matching the "default to normal" AC);
 * `high` is reserved for protected turns, which `tag` enforces separately. Richer
 * heuristics (e.g. error/blocker detection) are deferred to a future ticket.
 *
 * @since 1.10.0
 */
export class InferredTurnClassifierModel implements TurnClassifierModel {
  // v1 reads no turn signal, so the parameter is intentionally omitted (a
  // zero-arg method still satisfies `TurnClassifierModel.score`).
  score(): TurnPriority {
    return 'normal';
  }
}

export class PriorityClassifier {
  private readonly turnModel: TurnClassifierModel;

  constructor(turnModel: TurnClassifierModel = new InferredTurnClassifierModel()) {
    this.turnModel = turnModel;
  }

  /**
   * Tag every conversation turn `high`, `normal`, or `low` for the context-window
   * loop, enforcing the decision-packet/approval invariant: any protected turn
   * always resolves to `high`, whatever the model says and whatever the policy is.
   *
   * Batched per summarisation trigger: the caller invokes `tag` once with the
   * whole turn list, not once per message. The model is run in a single pass.
   *
   * @param turns  The turns to tag. A turn already carrying `priority: 'high'`
   *   that is protected is left untouched (the re-tag guard) and raises no warning.
   * @param policy Caller-supplied snapshot. `all_normal: true` flattens ordinary
   *   turns to `normal` while protected turns still resolve to `high`.
   * @returns The tagged turns plus any `priority_invariant_breach` warnings raised
   *   while correcting a protected turn the model scored below `high`.
   * @since 1.10.0
   */
  tag(turns: TurnInput[], policy?: TurnTagPolicy): TurnTagResult {
    if (turns.length === 0) {
      return { tagged: [], warnings: [] };
    }

    const tagged: TaggedTurn[] = [];
    const warnings: ContextHealthWarning[] = [];

    for (const turn of turns) {
      const protectedTurn = turn.decision_packet === true || turn.approval_turn === true;

      // Re-tag guard: a protected turn already pinned to `high` is a silent no-op.
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
