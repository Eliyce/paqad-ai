import type { PlanningManifest, SliceEscalationReport } from '@/core/types/planning.js';

import { saveManifest } from './manifest-parser.js';
import { validateManifest } from './manifest-validator.js';
import { emitTestSkeletons } from './skeleton-emitter.js';

export interface SliceReplanRequest {
  projectRoot: string;
  manifest: PlanningManifest;
  report: SliceEscalationReport;
}

export interface SliceReplanResult {
  manifest: PlanningManifest;
  new_skeletons: string[];
}

export type SliceReplanner = (input: SliceReplanRequest) => Promise<PlanningManifest | null>;

export async function attemptEscalationReplan(
  input: SliceReplanRequest & { replan?: SliceReplanner },
): Promise<SliceReplanResult | null> {
  if (!input.replan) {
    return null;
  }

  const revised = await input.replan({
    projectRoot: input.projectRoot,
    manifest: input.manifest,
    report: input.report,
  });
  if (revised === null) {
    return null;
  }

  const validation = validateManifest(revised);
  if (!validation.valid) {
    throw new Error(
      `Re-planned manifest is invalid: ${validation.errors.map((error) => error.message).join('; ')}`,
    );
  }

  await saveManifest(input.projectRoot, revised);
  const newCriteria = revised.verification_matrix.filter(
    (criterion) => criterion.status === 'uncovered',
  );
  const newSkeletons = await emitTestSkeletons(
    input.projectRoot,
    newCriteria,
    revised.classification.stack,
  );

  return {
    manifest: revised,
    new_skeletons: newSkeletons,
  };
}
