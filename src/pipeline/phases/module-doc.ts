import { DocumentationWorkflow } from '@/document/workflow.js';
import type { PhaseExecutor } from './phase.interface.js';

import { createFailResult, createPassResult } from './shared.js';

export class ModuleDocumentationPhase implements PhaseExecutor {
  readonly phase = 'module-documentation' as const;
  private workflow: DocumentationWorkflow | null = null;

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    if (context.classification.workflow !== 'module-documentation') {
      return createPassResult(
        this.phase,
        'Not a module-documentation request — skipped',
        context,
        [],
      );
    }

    try {
      this.workflow ??= new DocumentationWorkflow();
      const result = await this.workflow.run({
        projectRoot: context.project_root,
        mode: 'module-docs',
        request: context.classification,
      });

      const summary =
        result.orphaned_module_dirs.length > 0
          ? `Module documentation generated. Orphaned dirs not deleted: ${result.orphaned_module_dirs.join(', ')}`
          : `Module documentation generated in ${result.steps.length} step(s)`;

      return createPassResult(this.phase, summary, context, result.generated);
    } catch (error) {
      return createFailResult(
        this.phase,
        error instanceof Error ? error.message : 'Module documentation workflow failed',
        context,
      );
    }
  }
}
