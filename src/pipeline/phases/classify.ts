import type { PhaseExecutor } from './phase.interface.js';

import { createPassResult } from './shared.js';

export class ClassifyPhase implements PhaseExecutor {
  readonly phase = 'request-classification' as const;

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    const confidence = context.classification.classification_confidence;
    const resolutionMap = context.classification.resolution_map;

    if (confidence === undefined) {
      return createPassResult(
        this.phase,
        'Classification confirmed (legacy result without confidence metadata)',
        context,
      );
    }

    if (confidence < 0.5) {
      return createPassResult(
        this.phase,
        'Classification confidence below 0.5; treat downstream planning as tentative',
        context,
      );
    }

    const guessedCount = Object.values(resolutionMap ?? {}).filter(
      (source) => source === 'llm-guessed',
    ).length;
    return createPassResult(
      this.phase,
      guessedCount > 0
        ? `Classification confirmed with ${guessedCount} tentative dimension(s)`
        : 'Classification confirmed',
      context,
    );
  }
}
