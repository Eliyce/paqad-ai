import { boundaryDetector } from './boundary-detector.js';
import { contradictionDetector } from './contradiction-detector.js';
import { formulaDetector } from './formula-detector.js';
import { goalConflictDetector } from './goal-conflict-detector.js';
import { missingNegativeDetector } from './missing-negative-detector.js';
import { referenceDetector } from './reference-detector.js';
import type { SpecReviewDetector } from './types.js';

export const SPEC_REVIEW_DETECTORS: SpecReviewDetector[] = [
  contradictionDetector,
  formulaDetector,
  boundaryDetector,
  goalConflictDetector,
  referenceDetector,
  missingNegativeDetector,
];
