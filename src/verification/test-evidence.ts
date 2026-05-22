import type { StructuredTestResult } from '@/core/types/test-output.js';

export const TEST_EVIDENCE_STRENGTH = ['none', 'weak', 'strong'] as const;
export type TestEvidenceStrength = (typeof TEST_EVIDENCE_STRENGTH)[number];

export interface TestEvidenceAssessment {
  strength: TestEvidenceStrength;
  detail: string;
  matched_runner_ids: string[];
}

interface TestEvidenceInput {
  changed_files: string[];
  modules: string[];
  test_files_changed: boolean;
  structured_test_results?: StructuredTestResult[];
}

export function assessTestEvidence(input: TestEvidenceInput): TestEvidenceAssessment {
  const changedPreview = previewChangedFiles(input.changed_files);
  const structuredResults = input.structured_test_results ?? [];
  const matchedResults = structuredResults.filter((result) => matchesAffectedScope(result, input));

  if (matchedResults.length > 0) {
    return {
      strength: 'strong',
      detail: `Strong test evidence recorded for changed code (${changedPreview}) via ${listRunnerIds(matchedResults)}.`,
      matched_runner_ids: matchedResults.map((result) => result.summary.runner_id),
    };
  }

  if (structuredResults.length > 0) {
    return {
      strength: 'weak',
      detail: `Only weak test evidence recorded for changed code (${changedPreview}). Structured test results exist, but they are not mapped to the affected files or modules.`,
      matched_runner_ids: [],
    };
  }

  if (input.test_files_changed) {
    return {
      strength: 'weak',
      detail: `Only weak test evidence recorded for changed code (${changedPreview}). Test files changed, but no structured verification evidence was recorded for the affected scope.`,
      matched_runner_ids: [],
    };
  }

  return {
    strength: 'none',
    detail: `No test evidence recorded for changed code (${changedPreview})`,
    matched_runner_ids: [],
  };
}

function matchesAffectedScope(result: StructuredTestResult, input: TestEvidenceInput): boolean {
  const relatedPaths = result.evidence_scope?.related_paths?.map(normalizePath) ?? [];
  const relatedModules = result.evidence_scope?.related_modules?.map(normalizeModule) ?? [];

  if (relatedPaths.length === 0 && relatedModules.length === 0) {
    return false;
  }

  const changedFiles = new Set(input.changed_files.map(normalizePath));
  if (relatedPaths.some((path) => changedFiles.has(path))) {
    return true;
  }

  const modules = new Set(input.modules.map(normalizeModule));
  return relatedModules.some((moduleId) => modules.has(moduleId));
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').toLowerCase();
}

function normalizeModule(value: string): string {
  return value.trim().toLowerCase();
}

function previewChangedFiles(changedFiles: string[]): string {
  return changedFiles.slice(0, 5).join(', ') || 'unknown files';
}

function listRunnerIds(results: StructuredTestResult[]): string {
  return [...new Set(results.map((result) => result.summary.runner_id))].join(', ');
}
