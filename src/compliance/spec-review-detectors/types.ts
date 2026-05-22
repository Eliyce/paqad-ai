import type { SpecDefectSeverity, SpecReviewDefectCategory, SpecReviewLocation } from '../types.js';

export const SPEC_REVIEW_DETECTOR_INTERFACE_VERSION = 1;

export interface ReviewLine {
  line: number;
  text: string;
  section: string;
}

export interface ReviewContext {
  spec_file: string;
  spec_markdown: string;
  lines: string[];
  review_lines: ReviewLine[];
}

export interface RawSpecDefect {
  category: SpecReviewDefectCategory;
  severity: SpecDefectSeverity;
  description: string;
  locations: SpecReviewLocation[];
  suggested_resolution: string;
}

export interface SpecReviewDetector {
  name: string;
  detect(context: ReviewContext): RawSpecDefect[];
}
