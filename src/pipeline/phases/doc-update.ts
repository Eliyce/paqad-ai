import { DocumentationWorkflow } from '@/document/workflow.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { summarizeFeatureDevelopmentStage } from '@/pipeline/feature-development-policy.js';
import type { PhaseExecutor } from './phase.interface.js';

import { createFailResult, createPassResult } from './shared.js';

export class DocumentationUpdatePhase implements PhaseExecutor {
  readonly phase = 'documentation-update' as const;
  private workflow: DocumentationWorkflow | null = null;

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    const explicitDocumentationRequest =
      context.classification.workflow === 'documentation-update' ||
      context.classification.output_type === 'documentation';
    const featureImplementationRequest = context.classification.workflow === 'feature-development';
    const isOnboardedProject = readProjectProfile(context.project_root) !== null;
    const shouldRunDocumentationWorkflow =
      explicitDocumentationRequest || (featureImplementationRequest && isOnboardedProject);

    if (shouldRunDocumentationWorkflow) {
      try {
        this.workflow ??= new DocumentationWorkflow();
        const result = await this.workflow.run({
          projectRoot: context.project_root,
          request: context.classification,
        });

        const lowConfidenceNote =
          result.module_map_low_confidence_modules.length > 0
            ? ` Low-confidence modules requiring review: ${result.module_map_low_confidence_modules.join(', ')}.`
            : '';

        const summary = result.module_docs_pending_map_review
          ? `Module map written to ${result.module_map_path}.` +
            ` Review and verify the module and feature names first. After the map is correct, prompt me with: create module documentation.` +
            lowConfidenceNote
          : `Documentation workflow completed in ${result.steps.length} step(s)`;

        return createPassResult(this.phase, summary, context, result.generated);
      } catch (error) {
        return createFailResult(
          this.phase,
          error instanceof Error ? error.message : 'Documentation workflow failed',
          context,
        );
      }
    }

    const stageSummary = summarizeFeatureDevelopmentStage(
      context.feature_policy,
      'documentation_sync',
    );
    return createPassResult(
      this.phase,
      stageSummary === null ? 'Canonical docs updated' : `Canonical docs updated (${stageSummary})`,
      context,
    );
  }
}
