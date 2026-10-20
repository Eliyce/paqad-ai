import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { currentFeature, foldFeature } from '@/feature-evidence/stage-ledger.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';

import { buildReviewDigest, type DigestCriterion, type DigestStage } from './digest.js';
import { collectMachineFindings, type MachineFinding } from './sources.js';

export interface WrittenDigest {
  path: string;
  feature: string | null;
  findings: number;
  markdown: string;
}

function readStages(projectRoot: string, sessionId: string, feature: string | null): DigestStage[] {
  if (feature === null) return [];
  try {
    return foldFeature(projectRoot, sessionId, feature).stages.map((stage) => ({
      stage: stage.stage,
      state: stage.state,
    }));
    /* v8 ignore next 3 -- defensive: an unreadable ledger degrades the header, never the digest */
  } catch {
    return [];
  }
}

function readCriteria(projectRoot: string, feature: string | null): DigestCriterion[] {
  if (feature === null) return [];
  const spec = readFeatureSpecification(projectRoot, feature);
  if (!spec || !Array.isArray(spec.acceptance_criteria)) return [];
  return spec.acceptance_criteria.map((criterion) => ({
    criterion_id: criterion.criterion_id,
    given: criterion.given,
    when: criterion.when,
    then: criterion.then,
    proof_type: criterion.proof_type,
  }));
}

export async function writeReviewDigest(
  projectRoot: string,
  sessionId: string,
  now: () => Date = () => new Date(),
): Promise<WrittenDigest> {
  let feature: string | null;
  try {
    feature = currentFeature(projectRoot, sessionId);
    /* v8 ignore next 3 -- defensive: no active feature is a header line, never a failure */
  } catch {
    feature = null;
  }

  const findings: MachineFinding[] = collectMachineFindings(projectRoot);
  const { files: changedFiles } = await loadChangeEvidence(projectRoot);
  const markdown = buildReviewDigest({
    feature,
    generated_at: now().toISOString(),
    changed_files: changedFiles,
    stages: readStages(projectRoot, sessionId, feature),
    criteria: readCriteria(projectRoot, feature),
    findings,
  });

  const target = join(projectRoot, PATHS.REVIEW_DIGEST);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown, 'utf8');

  return { path: PATHS.REVIEW_DIGEST, feature, findings: findings.length, markdown };
}
