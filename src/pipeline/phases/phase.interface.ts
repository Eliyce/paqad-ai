import type { PhaseResult, PipelinePhase, PipelineRunContext } from '@/core/types/pipeline.js';

export interface PhaseExecutor {
  readonly phase: PipelinePhase;
  execute(context: PipelineRunContext): Promise<PhaseResult>;
}
