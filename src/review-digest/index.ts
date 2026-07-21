// Public surface of the review evidence digest (issue #360).

export {
  buildReviewDigest,
  DIGEST_LINE_CAP,
  type DigestCriterion,
  type DigestStage,
  type ReviewDigestInput,
} from './digest.js';
export {
  anchoringFindings,
  collectMachineFindings,
  findingAnchor,
  unanchoredMachineFindings,
  type MachineFinding,
  type MachineFindingSeverity,
  type MachineFindingTier,
} from './sources.js';
export { writeReviewDigest, type WrittenDigest } from './write.js';
