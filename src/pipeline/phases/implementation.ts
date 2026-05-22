import type { PhaseExecutor } from './phase.interface.js';
import { summarizeFeatureDevelopmentStage } from '@/pipeline/feature-development-policy.js';
import { detectExecutionManifestSlug, SliceExecutor } from '@/planning/slice-executor.js';

import { createPassResult } from './shared.js';

export class ImplementationPhase implements PhaseExecutor {
  readonly phase = 'implementation' as const;
  private readonly sliceExecutor = new SliceExecutor();

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    const stageSummary = summarizeFeatureDevelopmentStage(context.feature_policy, 'development');
    const manifestSlug = await detectExecutionManifestSlug(
      context.project_root,
      context.classification.base_manifest_slug,
    );

    if (manifestSlug !== null) {
      const prepared = await this.sliceExecutor.prepare(context.project_root, manifestSlug);
      const sliceSummary =
        prepared.currentSliceId === null
          ? `Slice execution initialized (${prepared.orderedSliceIds.length} slice(s), no eligible slice)`
          : `Slice execution initialized (${prepared.orderedSliceIds.length} slice(s), current: ${prepared.currentSliceId})`;
      const warningSummary =
        prepared.warnings.length > 0 ? `; warnings: ${prepared.warnings.join(' ')}` : '';
      const stageSuffix = stageSummary === null ? '' : `; ${stageSummary}`;

      return createPassResult(
        this.phase,
        `${sliceSummary}${warningSummary}${stageSuffix}`,
        context,
        [prepared.trackerPath],
      );
    }

    return createPassResult(
      this.phase,
      stageSummary === null
        ? 'Implementation completed'
        : `Implementation completed (${stageSummary})`,
      context,
    );
  }
}
