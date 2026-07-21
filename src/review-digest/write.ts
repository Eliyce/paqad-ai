// The review-digest write seam (issue #360).
//
// Reads the cached inputs, hands them to the pure composer, and persists the result at
// `.paqad/session/review-digest.md`. Nothing lands in a feature bundle directory (INV-3):
// the digest is an INPUT to the review, and the review's artifact is still the bundle's
// rigid `review.json`.
//
// Every read here is a direct read of a known path (INV-1). The changed-file list comes
// from the cached `.paqad/session/changed-files.json` and nothing else — no `git status`
// subprocess — so an absent list degrades to an honest "none recorded" rather than
// quietly making the digest expensive.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { currentFeature, foldFeature } from '@/feature-evidence/stage-ledger.js';

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

/** The cached changed-file list, or an empty list when none has been recorded. */
function readChangedFiles(projectRoot: string): string[] {
  const target = join(projectRoot, PATHS.CHANGED_FILES);
  if (!existsSync(target)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(target, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/** The folded per-stage state for the active feature; empty when nothing folds. */
function readStages(projectRoot: string, sessionId: string, feature: string | null): DigestStage[] {
  if (feature === null) return [];
  try {
    return foldFeature(projectRoot, sessionId, feature).stages.map((stage) => ({
      stage: stage.stage,
      state: stage.state,
    }));
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
export function writeReviewDigest(
  projectRoot: string,
  sessionId: string,
  now: () => Date = () => new Date(),
): WrittenDigest {
  let feature: string | null;
  try {
    feature = currentFeature(projectRoot, sessionId);
  } catch {
    feature = null;
  }

  const findings: MachineFinding[] = collectMachineFindings(projectRoot);
  const markdown = buildReviewDigest({
    feature,
    generated_at: now().toISOString(),
    changed_files: readChangedFiles(projectRoot),
    stages: readStages(projectRoot, sessionId, feature),
    criteria: readCriteria(projectRoot, feature),
    findings,
  });

  const target = join(projectRoot, PATHS.REVIEW_DIGEST);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown, 'utf8');

  return { path: PATHS.REVIEW_DIGEST, feature, findings: findings.length, markdown };
}
