// The review-digest write seam (issue #360).
//
// Reads the cached inputs, hands them to the pure composer, and persists the result at
// `.paqad/session/review-digest.md`. Nothing lands in a feature bundle directory (INV-3):
// the digest is an INPUT to the review, and the review's artifact is still the bundle's
// rigid `review.json`.
//
// Every read here is a direct read of a known path (INV-1), except the changed-file
// list. That comes from `loadChangeEvidence`, which reads git alone (issue #646): the
// working-tree status plus everything committed on the branch since its base. The old
// session cache is never read, so a stale copy can no longer hide edited files. It costs
// a few read-only git queries, never a model call, and a clean tree with no branch
// commits degrades to an honest "none recorded".

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { currentFeature, foldFeature } from '@/feature-evidence/stage-ledger.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';

import { buildReviewDigest, type DigestCriterion, type DigestStage } from './digest.js';
import { collectMachineFindings, type MachineFinding } from './sources.js';

export interface WrittenDigest {
  /** Project-relative path the digest was written to. */
  path: string;
  /** The active feature's bundle dir name, or null when none is active. */
  feature: string | null;
  /** How many machine-finding rows the digest carries. */
  findings: number;
  markdown: string;
}

/** The folded per-stage state for the active feature; empty when nothing folds. */
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

/** The frozen acceptance criteria for the active feature; empty when no spec is frozen. */
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

/**
 * Compose and persist the review digest. Never throws on a missing input — each source
 * degrades to nothing and the digest says so — so the only failure mode is being unable to
 * write the file itself, which the caller surfaces.
 */
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
