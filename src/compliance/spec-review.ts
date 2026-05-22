import { SPEC_REVIEW_SCHEMA_VERSION } from './constants.js';
import { buildHeadingPath, parseHeadings, sha256Hex, splitLines } from './markdown.js';
import { SPEC_REVIEW_DETECTORS } from './spec-review-detectors/registry.js';
import type { RawSpecDefect, ReviewContext, ReviewLine } from './spec-review-detectors/types.js';
import type { Obligation, SpecReviewDefect, SpecReviewReport } from './types.js';

export interface ReviewSpecOptions {
  spec_file: string;
  spec_markdown: string;
  reviewed_at?: string;
  previous_report?: SpecReviewReport | null;
}

const SEVERITY_ORDER = {
  critical: 0,
  major: 1,
  minor: 2,
} as const;

export function reviewSpecification(options: ReviewSpecOptions): SpecReviewReport {
  const reviewedAt = options.reviewed_at ?? new Date().toISOString();
  const context = buildReviewContext(options.spec_file, options.spec_markdown);
  const rawDefects = SPEC_REVIEW_DETECTORS.flatMap((detector) => detector.detect(context));
  const nextDefects = rawDefects.map((defect) => hydrateDefect(defect));

  const previousById = new Map(
    (options.previous_report?.defects ?? []).map((defect) => [defect.defect_id, defect] as const),
  );
  const defects: SpecReviewDefect[] = nextDefects.map((defect) => ({
    ...defect,
    status: previousById.has(defect.defect_id) ? 'existing' : 'new',
  }));

  for (const previous of options.previous_report?.defects ?? []) {
    if (defects.some((defect) => defect.defect_id === previous.defect_id)) continue;
    defects.push({
      ...previous,
      status: 'resolved',
      affected_obligation_ids: previous.affected_obligation_ids ?? [],
    });
  }

  defects.sort(compareDefects);

  return {
    metadata: {
      spec_file: options.spec_file,
      spec_hash: sha256Hex(options.spec_markdown),
      reviewed_at: reviewedAt,
      defect_count: defects.filter((defect) => defect.status !== 'resolved').length,
      schema_version: SPEC_REVIEW_SCHEMA_VERSION,
    },
    defects,
    pattern_advisories: [],
  };
}

export function attachSpecDefectsToObligations(
  review: SpecReviewReport,
  obligations: Obligation[],
): SpecReviewReport {
  const defects = review.defects.map((defect) => {
    if (defect.status === 'resolved') {
      return { ...defect, affected_obligation_ids: defect.affected_obligation_ids ?? [] };
    }

    const affected = obligations
      .filter((obligation) =>
        defect.locations.some((location) => {
          const [start, end] = location.line_range;
          return (
            obligation.source_line !== null &&
            obligation.source_line >= start &&
            obligation.source_line <= end
          );
        }),
      )
      .map((obligation) => obligation.obligation_id)
      .sort((a, b) => a.localeCompare(b));

    return {
      ...defect,
      affected_obligation_ids: affected,
    };
  });

  return {
    ...review,
    defects,
  };
}

function buildReviewContext(specFile: string, markdown: string): ReviewContext {
  const lines = splitLines(markdown);
  const headings = parseHeadings(lines);
  const openQuestionRanges = findOpenQuestionRanges(headings, lines.length);

  const reviewLines: ReviewLine[] = lines
    .map((text, index) => ({
      line: index + 1,
      text,
      section: buildHeadingPath(headings, index + 1) || 'Spec',
    }))
    .filter((line) => isReviewableLine(line, openQuestionRanges));

  return {
    spec_file: specFile,
    spec_markdown: markdown,
    lines,
    review_lines: reviewLines,
  };
}

function findOpenQuestionRanges(
  headings: Array<{ text: string; line: number; level: number }>,
  lineCount: number,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    if (!/open questions/i.test(heading.text)) continue;

    let endLine = lineCount;
    for (let cursor = index + 1; cursor < headings.length; cursor += 1) {
      const candidate = headings[cursor]!;
      if (candidate.level <= heading.level) {
        endLine = candidate.line - 1;
        break;
      }
    }

    ranges.push([heading.line, endLine]);
  }

  return ranges;
}

function isReviewableLine(line: ReviewLine, openQuestionRanges: Array<[number, number]>): boolean {
  const trimmed = line.text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return false;
  if (trimmed.startsWith('|---')) return false;
  if (openQuestionRanges.some(([start, end]) => line.line >= start && line.line <= end))
    return false;
  if (/\bTBD\b|to be determined/i.test(trimmed)) return false;
  return true;
}

function hydrateDefect(defect: RawSpecDefect): SpecReviewDefect {
  const defectId = sha256Hex(fingerprint(defect)).slice(0, 12).toUpperCase();
  return {
    defect_id: `SQ-${defectId}`,
    category: defect.category,
    severity: defect.severity,
    description: defect.description,
    locations: defect.locations
      .slice()
      .sort((left, right) => left.line_range[0] - right.line_range[0]),
    suggested_resolution: defect.suggested_resolution,
    affected_obligation_ids: null,
    status: 'new',
  };
}

function fingerprint(defect: RawSpecDefect): string {
  return JSON.stringify({
    category: defect.category,
    severity: defect.severity,
    description: defect.description,
    locations: defect.locations.map((location) => ({
      section: location.section,
      line_range: location.line_range,
      text_excerpt: location.text_excerpt,
    })),
    suggested_resolution: defect.suggested_resolution,
  });
}

export function compareDefects(left: SpecReviewDefect, right: SpecReviewDefect): number {
  const severityDelta = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
  if (severityDelta !== 0) return severityDelta;
  const lineDelta =
    (left.locations[0]?.line_range[0] ?? 0) - (right.locations[0]?.line_range[0] ?? 0);
  if (lineDelta !== 0) return lineDelta;
  return left.defect_id.localeCompare(right.defect_id);
}
