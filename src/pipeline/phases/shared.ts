import type { PhaseResult, PipelinePhase, PipelineRunContext } from '@/core/types/pipeline.js';

export function createPassResult(
  phase: PipelinePhase,
  summary: string,
  context: PipelineRunContext,
  artifacts: string[] = [`handoff:${context.phases.length + 1}`],
): PhaseResult {
  return {
    phase,
    status: 'pass',
    summary,
    artifacts,
  };
}

export function createFailResult(
  phase: PipelinePhase,
  summary: string,
  context: PipelineRunContext,
): PhaseResult {
  return {
    phase,
    status: 'fail',
    summary,
    artifacts: [`handoff:${context.phases.length + 1}`],
  };
}
