import type { Gate } from './gate.interface.js';

import { checkBooleanGate } from './shared.js';

export class StoryQualityGate implements Gate {
  readonly gate = 'story-quality' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    return checkBooleanGate(
      this.gate,
      context.story_quality_passed,
      'Stories meet quality requirements',
      'Story quality checks failed',
      'Refine the story breakdown and acceptance criteria.',
    );
  }
}
