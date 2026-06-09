import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

import { CancelledError } from '@/core/errors/cancelled-error.js';

import { COMPLIANCE_SCHEMA_VERSION } from './constants.js';
import { sha256Hex } from './markdown.js';
import type {
  ComplianceReport,
  ComplianceReportObligation,
  ComplianceState,
  ObligationIndex,
  SpecReviewReport,
} from './types.js';

export interface CheckComplianceOptions {
  project_root: string;
  index: ObligationIndex;
  test_globs?: string[];
  /**
   * Absolute or project-root-relative path where the report is loaded from (cache)
   * and written to after a fresh scan (FR-3.5, FR-3.6).  When omitted the report
   * is returned in memory only.
   */
  report_path?: string;
  spec_review?: SpecReviewReport | null;
  /**
   * Optional consumer cancellation signal (PQD-104). Checked before the test
   * file scan and before the report is written; an abort throws `CancelledError`
   * and writes no report.
   */
  signal?: AbortSignal;
}

const DEFAULT_TEST_GLOBS = ['tests/**/*.{test,spec}.{ts,tsx,js,jsx}', 'tests/**/*.test.ts'];

const OBLIGATION_ANNOTATION_PATTERN = /@obligation\s+([A-Z][A-Z0-9._-]*)\b/g;
// Matches: it('...'), test('...'), describe('...') with single, double, or backtick quotes
const TEST_CALL_PATTERN = /(?:it|test|describe)\s*\(\s*['"`]([^'"`\n]*)/g;

export async function checkSpecCompliance(
  options: CheckComplianceOptions,
): Promise<ComplianceReport> {
  // Pre-flight: never start the scan once the consumer has aborted (PQD-104).
  if (options.signal?.aborted) {
    throw new CancelledError('Compliance check cancelled by consumer');
  }

  const testGlobs =
    options.test_globs && options.test_globs.length > 0 ? options.test_globs : DEFAULT_TEST_GLOBS;

  // Gather test files and compute a content hash for cache invalidation (FR-3.6).
  const { sortedFiles, testFilesHash } = await computeTestFilesHash(
    options.project_root,
    testGlobs,
  );

  // --- Incremental cache check (FR-3.6) ---
  if (options.report_path) {
    const cached = await loadCachedReport(options.project_root, options.report_path);
    if (
      cached &&
      cached.metadata.spec_hash === options.index.metadata.spec_hash &&
      cached.metadata.test_files_hash === testFilesHash
    ) {
      return { ...cached, metadata: { ...cached.metadata, cache_hit: true } };
    }
  }

  const evidence = await scanEvidence(sortedFiles);

  const obligations: ComplianceReportObligation[] = options.index.obligations.map((obligation) => {
    const annotationEvidence = evidence.byObligationId.get(obligation.obligation_id) ?? [];
    const testNameEvidence = getTestNameEvidence(
      obligation.obligation_id,
      evidence.testNamesByFile,
    );
    const state = computeState(
      obligation.obligation_id,
      annotationEvidence,
      testNameEvidence,
      evidence,
    );
    const allEvidence = [...new Set([...annotationEvidence, ...testNameEvidence])].sort((a, b) =>
      a.localeCompare(b),
    );

    return {
      ...obligation,
      state,
      evidence: allEvidence,
    };
  });

  const summary = summarize(obligations);

  const uncovered_obligations = obligations
    .filter((o) => o.state === 'uncovered')
    .map((o) => o.obligation_id);

  const report: ComplianceReport = {
    metadata: {
      spec_file: options.index.metadata.spec_file,
      spec_hash: options.index.metadata.spec_hash,
      generated_at: new Date().toISOString(),
      schema_version: COMPLIANCE_SCHEMA_VERSION,
      test_files_hash: testFilesHash,
      cache_hit: false,
    },
    summary,
    spec_review: summarizeSpecReview(options.spec_review),
    obligations,
    uncovered_obligations,
  };

  // A cancellation that arrived during the scan must leave no report on disk.
  if (options.signal?.aborted) {
    throw new CancelledError('Compliance check cancelled by consumer');
  }

  // Persist for future cache hits (FR-3.5).
  if (options.report_path) {
    await persistReport(options.project_root, options.report_path, report);
  }

  return report;
}

function summarizeSpecReview(
  review: SpecReviewReport | null | undefined,
): ComplianceReport['spec_review'] {
  if (!review) return null;

  const activeDefects = review.defects.filter((defect) => defect.status !== 'resolved');
  const criticalCount = activeDefects.filter((defect) => defect.severity === 'critical').length;

  return {
    defect_count: activeDefects.length,
    critical_count: criticalCount,
    warning:
      criticalCount > 0
        ? `${criticalCount} critical spec defects remain unresolved — compliance results may be unreliable.`
        : null,
  };
}

export function assertComplianceSummaryInvariants(summary: {
  total: number;
  covered: number;
  partial: number;
  uncovered: number;
  indeterminate: number;
  compliance_ratio: number;
}) {
  enforceSummaryInvariants(summary);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type EvidenceScan = {
  byObligationId: Map<string, string[]>;
  testNamesByFile: Map<string, string[]>;
  fileContents: Map<string, string>;
};

/** Returns sorted unique test file paths and a hash of their collective contents. */
async function computeTestFilesHash(
  projectRoot: string,
  globs: string[],
): Promise<{ sortedFiles: string[]; testFilesHash: string }> {
  const matches = await fg(globs, { cwd: projectRoot, absolute: true, onlyFiles: true });
  const sortedFiles = [...new Set(matches)].sort((a, b) => a.localeCompare(b));

  if (sortedFiles.length === 0) {
    return { sortedFiles, testFilesHash: sha256Hex('') };
  }

  const contents = await Promise.all(sortedFiles.map((f) => readFile(f, 'utf8')));
  // Hash: sorted paths + contents so renames and edits both invalidate.
  const hashInput = sortedFiles.map((f, i) => `${f}\x00${contents[i]!}`).join('\x01');
  return { sortedFiles, testFilesHash: sha256Hex(hashInput) };
}

async function loadCachedReport(
  projectRoot: string,
  reportPath: string,
): Promise<ComplianceReport | null> {
  try {
    const fullPath = path.resolve(projectRoot, reportPath);
    const raw = await readFile(fullPath, 'utf8');
    return JSON.parse(raw) as ComplianceReport;
  } catch {
    return null;
  }
}

async function persistReport(
  projectRoot: string,
  reportPath: string,
  report: ComplianceReport,
): Promise<void> {
  const fullPath = path.resolve(projectRoot, reportPath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

function extractTestCallNames(body: string): string[] {
  const names: string[] = [];
  for (const m of body.matchAll(TEST_CALL_PATTERN)) {
    names.push(m[1]!);
  }
  return names;
}

function getTestNameEvidence(
  obligationId: string,
  testNamesByFile: Map<string, string[]>,
): string[] {
  const hits: string[] = [];
  for (const [filePath, names] of testNamesByFile) {
    if (names.some((name) => name.includes(obligationId))) {
      hits.push(filePath);
    }
  }
  return hits.sort((a, b) => a.localeCompare(b));
}

async function scanEvidence(sortedFiles: string[]): Promise<EvidenceScan> {
  const contents = await Promise.all(
    sortedFiles.map(async (filePath) => [filePath, await readFile(filePath, 'utf8')] as const),
  );
  const fileContents = new Map<string, string>(contents);

  const byObligationId = new Map<string, string[]>();
  const testNamesByFile = new Map<string, string[]>();

  for (const [filePath, body] of contents) {
    // Annotation scan: @obligation <ID>
    const annotationMatches = [...body.matchAll(OBLIGATION_ANNOTATION_PATTERN)];
    for (const match of annotationMatches) {
      const id = match[1]!;
      const list = byObligationId.get(id) ?? [];
      if (!list.includes(filePath)) {
        list.push(filePath);
      }
      byObligationId.set(id, list);
    }
    // Test-call name scan: it/test/describe('...')
    testNamesByFile.set(filePath, extractTestCallNames(body));
  }

  return { byObligationId, testNamesByFile, fileContents };
}

function computeState(
  obligationId: string,
  annotationEvidence: string[],
  testNameEvidence: string[],
  scan: EvidenceScan,
): ComplianceState {
  // Strong signal: explicit @obligation annotation OR obligation ID in a test call name
  if (annotationEvidence.length > 0 || testNameEvidence.length > 0) {
    return 'covered';
  }

  // Weak signal: ID appears somewhere in a test file (but not in a test name)
  const referencedAnywhere = [...scan.fileContents.values()].some((body) =>
    body.includes(obligationId),
  );
  if (referencedAnywhere) {
    return 'partial';
  }

  // Generated IDs with no test signal are indeterminate (cannot be verified programmatically)
  if (obligationId.startsWith('GEN-')) {
    return 'indeterminate';
  }

  return 'uncovered';
}

function summarize(obligations: ComplianceReportObligation[]) {
  const summary = {
    total: obligations.length,
    covered: 0,
    partial: 0,
    uncovered: 0,
    indeterminate: 0,
    compliance_ratio: 0,
  };

  for (const obligation of obligations) {
    summary[obligation.state] += 1;
  }

  // FR-3.3: compliance_ratio = covered / (total - indeterminate).
  // Indeterminate obligations are excluded from the denominator because they
  // cannot be programmatically evaluated. Guard against zero denominator when
  // all obligations are indeterminate.
  const denominator = summary.total - summary.indeterminate;
  summary.compliance_ratio = denominator === 0 ? 1 : summary.covered / denominator;

  enforceSummaryInvariants(summary);
  return summary;
}

function enforceSummaryInvariants(summary: {
  total: number;
  covered: number;
  partial: number;
  uncovered: number;
  indeterminate: number;
  compliance_ratio: number;
}) {
  const sum = summary.covered + summary.partial + summary.uncovered + summary.indeterminate;
  if (sum !== summary.total) {
    throw new Error(
      `Compliance invariant violated: state sum ${sum} does not equal total ${summary.total}`,
    );
  }
  if (summary.uncovered > 0 && summary.compliance_ratio >= 1) {
    throw new Error(
      'Compliance invariant violated: uncovered obligations imply compliance_ratio < 1.0',
    );
  }
}
