import { RootCauseAnalysisWorkflow } from '@/workflows/root-cause-analysis.js';

import type { PhaseExecutor } from './phase.interface.js';
import { createFailResult, createPassResult } from './shared.js';

export class RootCauseAnalysisPhase implements PhaseExecutor {
  readonly phase = 'root-cause-analysis' as const;
  private workflow: RootCauseAnalysisWorkflow | null = null;

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    if (context.classification.workflow !== 'root-cause-analysis') {
      return createPassResult(this.phase, 'No RCA workflow requested', context);
    }

    try {
      this.workflow ??= new RootCauseAnalysisWorkflow();
      const result = await this.workflow.run({
        projectRoot: context.project_root,
        classification: context.classification,
      });

      return createPassResult(this.phase, 'Root cause analysis artifact generated', context, [
        result.output_path,
      ]);
    } catch (error) {
      return createFailResult(
        this.phase,
        error instanceof Error ? error.message : 'Root cause analysis workflow failed',
        context,
      );
    }
  }
}
