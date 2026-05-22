import { readFileSync } from 'node:fs';

import { DISCLOSURE_LEVELS, ROUTING_MECHANISMS } from '@/core/types/token-efficiency.js';

import type {
  BuildCompactArtifactInput,
  CompactArtifactResult,
  CompactArtifactSummary,
  ControlLayerAuditRecord,
  DeltaReasoningPayload,
  DisclosureAuditRecord,
  DisclosureLevel,
  DisclosurePolicyInput,
  DisclosurePolicyResult,
  DriftDelta,
  DriftFileSnapshot,
  EscalationDecision,
  EscalationReason,
  EvaluateEscalationInput,
  ReasoningInputPayload,
  RetrievalAuditRecord,
  RetrievalEscalationSignal,
  RetrievalGateInput,
  RetrievalGateResult,
  RetrievalPath,
  RoutingAuditRecord,
  RoutingInput,
  RoutingMechanism,
  RoutingResult,
  TestDelta,
  TestIssueSnapshot,
  TokenEfficiencyMetadata,
  VerificationDelta,
  VerificationGateSnapshot,
} from '@/core/types/token-efficiency.js';

const DEFAULT_EXCERPTS = 3;
const DEFAULT_MIN_CHUNK_THRESHOLD = 3;
const DETERMINISTIC_TASK_TYPES = ['lint', 'format', 'typecheck', 'build', 'test-run', 'ci'];

const DEFAULT_ACTIONS: Record<BuildCompactArtifactInput['artifact_class'], string[]> = {
  'test-output': ['Fix failing tests and re-run the targeted suite.'],
  'coverage-output': ['Increase tests for files below the target threshold.'],
  'json-report': ['Inspect highest-severity report entries first.'],
  'xml-report': ['Inspect failure and error nodes first.'],
  'log-output': ['Investigate recurring ERROR/FATAL signatures first.'],
  'grep-results': ['Narrow search scope to reduce broad match noise.'],
  'route-dump': ['Review unexpected route additions and auth exposure.'],
  'inventory-scan-output': ['Patch critical/high findings before broader cleanup.'],
};

export function buildCompactArtifact(input: BuildCompactArtifactInput): CompactArtifactResult {
  const normalizedRaw = normalizeLineEndings(input.raw_content);
  const raw = normalizedRaw.trim();
  const originalSize = Buffer.byteLength(normalizedRaw, 'utf8');

  const artifactSummary = summarizeByClass(
    input.artifact_class,
    raw,
    input.max_excerpts ?? DEFAULT_EXCERPTS,
  );
  const minimized = minimizeCompactRepresentation(
    artifactSummary,
    input.artifact_class,
    originalSize,
    input.max_excerpts ?? DEFAULT_EXCERPTS,
  );
  const compactJson = JSON.stringify({
    summary: minimized.summary,
    excerpts: minimized.excerpts,
    confidence: minimized.confidence,
  });
  const compactSize = Buffer.byteLength(compactJson, 'utf8');

  const metadata: TokenEfficiencyMetadata = {
    original_size: originalSize,
    compact_size: compactSize,
    reduction_ratio: calculateReductionRatio(originalSize, compactSize),
    delta_mode_used: false,
    escalation_occurred: false,
  };

  return {
    artifact_class: input.artifact_class,
    summary: minimized.summary,
    targeted_excerpts: minimized.excerpts,
    confidence: minimized.confidence,
    raw_artifact_path: input.raw_artifact_path ?? null,
    metadata,
  };
}

export function evaluateEscalation(input: EvaluateEscalationInput): EscalationDecision {
  const confidenceThreshold = input.confidence_threshold ?? 0.6;

  const reason = resolveEscalationReason(input, confidenceThreshold);
  if (reason === null) {
    return {
      should_escalate: false,
      reason: null,
      raw_slice: null,
      metadata: {
        ...input.compact.metadata,
        escalation_occurred: false,
      },
    };
  }

  const rawSlice = extractRawSlice(
    input.compact,
    input.max_raw_slice_chars ?? 1200,
    input.slice_hint ?? input.compact.summary.top_failures_or_errors[0] ?? '',
  );

  return {
    should_escalate: true,
    reason,
    raw_slice: rawSlice,
    metadata: {
      ...input.compact.metadata,
      escalation_occurred: true,
    },
  };
}

export function buildReasoningInputPayload(
  compact: CompactArtifactResult,
  escalation: EscalationDecision,
): ReasoningInputPayload {
  return {
    compact_summary: compact.summary,
    targeted_excerpts: compact.targeted_excerpts,
    raw_slice: escalation.should_escalate ? escalation.raw_slice : null,
    escalation_reason: escalation.reason,
    metadata: escalation.metadata,
  };
}

export function applyDisclosurePolicy(input: DisclosurePolicyInput): DisclosurePolicyResult {
  const level = resolveDisclosureLevel(input);
  const payload = buildDisclosurePayload(level, input.compact, input.escalation);
  const escalationReason = input.escalation_reason ?? null;
  const skippedIntermediate =
    input.requested_level === 'raw' &&
    input.escalation?.raw_slice == null &&
    !input.escalation_reason;
  const audit: DisclosureAuditRecord = {
    selected_level: level,
    escalation_occurred: escalationReason !== null,
    escalation_reason: escalationReason,
    skipped_intermediate: skippedIntermediate,
  };

  return {
    level,
    payload,
    escalation_reason: escalationReason,
    skipped_intermediate: skippedIntermediate,
    audit,
  };
}

export function evaluateRetrievalGate(input: RetrievalGateInput): RetrievalGateResult {
  const result = resolveRetrievalPath(
    input.task_complexity,
    input.ambiguity_detected ?? false,
    input.chunk_count ?? 0,
    input.min_chunk_threshold ?? DEFAULT_MIN_CHUNK_THRESHOLD,
    input.conflicting_evidence ?? false,
  );
  const audit: RetrievalAuditRecord = {
    retrieval_depth: result.path,
    rag_skipped: result.rag_skipped,
    escalation_signal: result.escalation_signal,
  };

  return {
    preferred_path: result.path,
    rag_skipped: result.rag_skipped,
    escalation_signal: result.escalation_signal,
    audit,
  };
}

export function runRoutingDecision(input: RoutingInput): RoutingResult {
  const resolved = resolveRoutingMechanism(input.task_type, input.metadata);
  const audit: RoutingAuditRecord = {
    routing_mechanism: resolved.mechanism,
    resolved_before_reasoning: resolved.resolved,
  };

  return {
    needs_reasoning: !resolved.resolved,
    mechanism_used: resolved.mechanism,
    resolved_task_type: resolved.resolved_task_type,
    audit,
  };
}

export function buildControlLayerAudit(
  disclosure: DisclosureAuditRecord,
  retrieval: RetrievalAuditRecord,
  routing: RoutingAuditRecord,
): ControlLayerAuditRecord {
  return {
    disclosure,
    retrieval,
    routing,
  };
}

export function createTestDelta(
  baseline: TestIssueSnapshot[],
  current: TestIssueSnapshot[],
  options: {
    treat_missing_as_passing?: boolean;
  } = {},
): { delta: TestDelta; metadata: TokenEfficiencyMetadata } {
  const baselineMap = new Map(baseline.map((item) => [item.test_id, item]));
  const currentMap = new Map(current.map((item) => [item.test_id, item]));

  const newlyFailing: string[] = [];
  const newlyPassing: string[] = [];
  const newlyErrored: string[] = [];
  const changedMessages: TestDelta['changed_failure_messages'] = [];

  for (const [testId, now] of currentMap) {
    const before = baselineMap.get(testId);
    if (before === undefined) {
      if (now.status === 'failed') newlyFailing.push(testId);
      if (now.status === 'errored') newlyErrored.push(testId);
      continue;
    }

    if (before.status !== 'failed' && now.status === 'failed') {
      newlyFailing.push(testId);
    }
    if (before.status !== 'passed' && now.status === 'passed') {
      newlyPassing.push(testId);
    }
    if (before.status !== 'errored' && now.status === 'errored') {
      newlyErrored.push(testId);
    }

    const beforeMessage = normalizedIssueMessage(before);
    const afterMessage = normalizedIssueMessage(now);
    if (before.status === 'failed' && now.status === 'failed' && beforeMessage !== afterMessage) {
      changedMessages.push({ test_id: testId, before: beforeMessage, after: afterMessage });
    }
  }

  if (options.treat_missing_as_passing === true) {
    for (const [testId, before] of baselineMap) {
      if (currentMap.has(testId)) continue;
      // Issue-only snapshots omit passed tests; a missing failing/errored entry
      // indicates recovery into passing.
      if (before.status !== 'passed') {
        newlyPassing.push(testId);
      }
    }
  }

  const delta: TestDelta = {
    newly_failing_tests: sortUnique(newlyFailing),
    newly_passing_tests: sortUnique(newlyPassing),
    newly_errored_tests: sortUnique(newlyErrored),
    changed_failure_messages: changedMessages.sort((a, b) => a.test_id.localeCompare(b.test_id)),
  };

  return {
    delta,
    metadata: createDeltaMetadata(current, delta),
  };
}

export function createVerificationDelta(
  baseline: VerificationGateSnapshot[],
  current: VerificationGateSnapshot[],
): { delta: VerificationDelta; metadata: TokenEfficiencyMetadata } {
  const baselineMap = new Map(baseline.map((item) => [item.gate, item]));
  const currentMap = new Map(current.map((item) => [item.gate, item]));

  const changedGateOutcomes: VerificationDelta['changed_gate_outcomes'] = [];
  const changedEvidence: VerificationDelta['changed_evidence'] = [];
  const changedActions: VerificationDelta['changed_recommended_actions'] = [];

  for (const [gate, now] of currentMap) {
    const before = baselineMap.get(gate);
    if (before === undefined) {
      changedGateOutcomes.push({ gate, before_passed: !now.passed, after_passed: now.passed });
      changedEvidence.push({ gate, before_detail: '', after_detail: now.detail });
      if ((now.remediation ?? '').trim().length > 0) {
        changedActions.push({ gate, before: '', after: now.remediation!.trim() });
      }
      continue;
    }

    if (before.passed !== now.passed) {
      changedGateOutcomes.push({ gate, before_passed: before.passed, after_passed: now.passed });
    }
    if (before.detail !== now.detail) {
      changedEvidence.push({ gate, before_detail: before.detail, after_detail: now.detail });
    }

    const beforeRemediation = (before.remediation ?? '').trim();
    const afterRemediation = (now.remediation ?? '').trim();
    if (beforeRemediation !== afterRemediation) {
      changedActions.push({ gate, before: beforeRemediation, after: afterRemediation });
    }
  }

  const delta: VerificationDelta = {
    changed_gate_outcomes: changedGateOutcomes.sort((a, b) => a.gate.localeCompare(b.gate)),
    changed_evidence: changedEvidence.sort((a, b) => a.gate.localeCompare(b.gate)),
    changed_recommended_actions: changedActions.sort((a, b) => a.gate.localeCompare(b.gate)),
  };

  return {
    delta,
    metadata: createDeltaMetadata(current, delta),
  };
}

export function createDriftDelta(
  baseline: DriftFileSnapshot[],
  current: DriftFileSnapshot[],
): { delta: DriftDelta; metadata: TokenEfficiencyMetadata } {
  const baselineMap = new Map(baseline.map((item) => [item.file, item]));
  const currentMap = new Map(current.map((item) => [item.file, item]));

  const changedFiles = new Set<string>();
  const changedStatuses: DriftDelta['changed_statuses'] = [];
  const changedConclusions: DriftDelta['changed_conclusions'] = [];

  for (const [file, now] of currentMap) {
    const before = baselineMap.get(file);
    if (before === undefined) {
      changedFiles.add(file);
      changedStatuses.push({ file, before: '', after: now.status });
      changedConclusions.push({ file, before: '', after: now.conclusion });
      continue;
    }

    if (before.status !== now.status) {
      changedFiles.add(file);
      changedStatuses.push({ file, before: before.status, after: now.status });
    }
    if (before.conclusion !== now.conclusion) {
      changedFiles.add(file);
      changedConclusions.push({ file, before: before.conclusion, after: now.conclusion });
    }
  }

  for (const [file, before] of baselineMap) {
    if (!currentMap.has(file)) {
      changedFiles.add(file);
      changedStatuses.push({ file, before: before.status, after: '' });
      changedConclusions.push({ file, before: before.conclusion, after: '' });
    }
  }

  const delta: DriftDelta = {
    changed_files: [...changedFiles].sort((a, b) => a.localeCompare(b)),
    changed_statuses: changedStatuses.sort((a, b) => a.file.localeCompare(b.file)),
    changed_conclusions: changedConclusions.sort((a, b) => a.file.localeCompare(b.file)),
  };

  return {
    delta,
    metadata: createDeltaMetadata(current, delta),
  };
}

export function buildTestDeltaReasoningPayload(
  baseline: TestIssueSnapshot[],
  current: TestIssueSnapshot[],
  options: {
    treat_missing_as_passing?: boolean;
  } = {},
  escalationInput: Omit<EvaluateEscalationInput, 'compact'> = {},
): DeltaReasoningPayload<TestDelta> {
  const result = createTestDelta(baseline, current, options);
  return buildDeltaReasoningPayload(result.delta, result.metadata, escalationInput);
}

export function buildVerificationDeltaReasoningPayload(
  baseline: VerificationGateSnapshot[],
  current: VerificationGateSnapshot[],
  escalationInput: Omit<EvaluateEscalationInput, 'compact'> = {},
): DeltaReasoningPayload<VerificationDelta> {
  const result = createVerificationDelta(baseline, current);
  return buildDeltaReasoningPayload(result.delta, result.metadata, escalationInput);
}

export function buildDriftDeltaReasoningPayload(
  baseline: DriftFileSnapshot[],
  current: DriftFileSnapshot[],
  escalationInput: Omit<EvaluateEscalationInput, 'compact'> = {},
): DeltaReasoningPayload<DriftDelta> {
  const result = createDriftDelta(baseline, current);
  return buildDeltaReasoningPayload(result.delta, result.metadata, escalationInput);
}

function resolveEscalationReason(
  input: EvaluateEscalationInput,
  confidenceThreshold: number,
): EscalationReason | null {
  if (input.reason) return input.reason;
  if (input.unresolved_after_compact === true) return 'diagnosis-unresolved-after-compact-pass';
  if (input.contradiction_detected === true) return 'compact-signals-contradict';
  if (input.compact.confidence < confidenceThreshold) return 'summary-confidence-low';
  return null;
}

function extractRawSlice(
  compact: CompactArtifactResult,
  maxChars: number,
  hint: string,
): string | null {
  const normalizedHint = hint.trim().toLowerCase();
  const excerpt = compact.targeted_excerpts.find((line) =>
    line.toLowerCase().includes(normalizedHint),
  );
  if (excerpt) return excerpt.slice(0, maxChars);
  if (compact.raw_artifact_path === null) {
    return compact.targeted_excerpts[0]?.slice(0, maxChars) ?? null;
  }

  try {
    const raw = normalizeLineEndings(readFileSync(compact.raw_artifact_path, 'utf8'));
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return null;

    if (normalizedHint.length > 0) {
      const hit = lines.findIndex((line) => line.toLowerCase().includes(normalizedHint));
      if (hit >= 0) {
        const start = Math.max(hit - 1, 0);
        const end = Math.min(hit + 2, lines.length);
        return lines.slice(start, end).join('\n').slice(0, maxChars);
      }
    }

    return lines[0]!.slice(0, maxChars);
  } catch {
    return compact.targeted_excerpts[0]?.slice(0, maxChars) ?? null;
  }
}

function summarizeByClass(
  artifactClass: BuildCompactArtifactInput['artifact_class'],
  raw: string,
  maxExcerpts: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  switch (artifactClass) {
    case 'test-output':
      return summarizeTestOutput(raw, maxExcerpts);
    case 'coverage-output':
      return summarizeCoverageOutput(raw, maxExcerpts);
    case 'json-report':
      return summarizeJsonReport(raw, maxExcerpts);
    case 'xml-report':
      return summarizeXmlReport(raw, maxExcerpts);
    case 'log-output':
      return summarizeLogOutput(raw, maxExcerpts);
    case 'grep-results':
      return summarizeGrepResults(raw, maxExcerpts);
    case 'route-dump':
      return summarizeRouteDump(raw, maxExcerpts);
    case 'inventory-scan-output':
      return summarizeInventoryScan(raw, maxExcerpts);
  }
}

function summarizeTestOutput(
  raw: string,
  maxExcerpts: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  const lines = tokenizeLines(raw);
  const failures = lines.filter((line) => /(^|\s)(fail|failed|not ok|error)\b/i.test(line));
  const passed = lines.filter((line) => /(^|\s)(pass|passed|ok)\b/i.test(line));
  const files = extractFileLikeSegments(lines);

  return {
    summary: {
      summary_counts: {
        lines: lines.length,
        failing_signals: failures.length,
        passing_signals: passed.length,
      },
      top_failures_or_errors: failures.slice(0, 5),
      affected_files: files,
      severity_or_status: failures.length > 0 ? 'failing' : 'passing',
      next_recommended_actions: DEFAULT_ACTIONS['test-output'],
    },
    excerpts: failures.slice(0, maxExcerpts),
    confidence: lines.length > 0 ? 0.9 : 0.4,
  };
}

function summarizeCoverageOutput(
  raw: string,
  maxExcerpts: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  const lines = tokenizeLines(raw);
  const percentages = lines
    .map((line) => /([0-9]{1,3}(?:\.[0-9]+)?)%/.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => Number(value));
  const below80 = lines.filter((line) => {
    const hit = /([0-9]{1,3}(?:\.[0-9]+)?)%/.exec(line);
    return hit ? Number(hit[1]) < 80 : false;
  });

  return {
    summary: {
      summary_counts: {
        lines: lines.length,
        percentage_markers: percentages.length,
        below_target_entries: below80.length,
      },
      top_failures_or_errors: below80.slice(0, 5),
      affected_files: extractFileLikeSegments(below80),
      severity_or_status: below80.length > 0 ? 'below-target' : 'meets-target',
      next_recommended_actions: DEFAULT_ACTIONS['coverage-output'],
    },
    excerpts: below80.slice(0, maxExcerpts),
    confidence: percentages.length > 0 ? 0.88 : 0.55,
  };
}

function summarizeJsonReport(
  raw: string,
  maxExcerpts: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const flattened = flattenJson(parsed);
    const errorLike = flattened.filter((line) => /(error|fail|critical|high|warn)/i.test(line));
    const files = extractFileLikeSegments(flattened);

    return {
      summary: {
        summary_counts: {
          flattened_fields: flattened.length,
          error_like_entries: errorLike.length,
        },
        top_failures_or_errors: errorLike.slice(0, 5),
        affected_files: files,
        severity_or_status: errorLike.length > 0 ? 'attention-needed' : 'clean',
        next_recommended_actions: DEFAULT_ACTIONS['json-report'],
      },
      excerpts: errorLike.slice(0, maxExcerpts),
      confidence: 0.95,
    };
  } catch {
    return degradedSummary('json-report', raw, maxExcerpts, 0.35);
  }
}

function summarizeXmlReport(
  raw: string,
  maxExcerpts: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  const nodes = raw.match(/<([a-zA-Z0-9:_-]+)\b[^>]*>/g) ?? [];
  const failures = raw.match(/<(failure|error)\b[^>]*>([\s\S]*?)<\/\1>/gi) ?? [];
  const files = extractFileLikeSegments(tokenizeLines(raw));

  return {
    summary: {
      summary_counts: {
        tags: nodes.length,
        failure_or_error_nodes: failures.length,
      },
      top_failures_or_errors: failures.map((value) => collapseWhitespace(value)).slice(0, 5),
      affected_files: files,
      severity_or_status: failures.length > 0 ? 'failing' : 'passing',
      next_recommended_actions: DEFAULT_ACTIONS['xml-report'],
    },
    excerpts: failures.map((value) => collapseWhitespace(value)).slice(0, maxExcerpts),
    confidence: nodes.length > 0 ? 0.85 : 0.5,
  };
}

function summarizeLogOutput(
  raw: string,
  maxExcerpts: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  const lines = tokenizeLines(raw);
  const errors = lines.filter((line) => /(error|fatal|panic|exception)/i.test(line));
  const warnings = lines.filter((line) => /\bwarn(?:ing)?\b/i.test(line));

  return {
    summary: {
      summary_counts: {
        lines: lines.length,
        errors: errors.length,
        warnings: warnings.length,
      },
      top_failures_or_errors: errors.slice(0, 5),
      affected_files: extractFileLikeSegments(errors.length > 0 ? errors : warnings),
      severity_or_status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
      next_recommended_actions: DEFAULT_ACTIONS['log-output'],
    },
    excerpts: (errors.length > 0 ? errors : warnings).slice(0, maxExcerpts),
    confidence: lines.length > 0 ? 0.8 : 0.45,
  };
}

function summarizeGrepResults(
  raw: string,
  maxExcerpts: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  const lines = tokenizeLines(raw);
  const matches = lines.filter((line) => /:\d+[:-]/.test(line) || line.includes(':'));
  const files = extractFileLikeSegments(lines);

  return {
    summary: {
      summary_counts: {
        lines: lines.length,
        matches: matches.length,
        files: files.length,
      },
      top_failures_or_errors: matches.slice(0, 5),
      affected_files: files,
      severity_or_status: matches.length > 0 ? 'matches-found' : 'no-matches',
      next_recommended_actions: DEFAULT_ACTIONS['grep-results'],
    },
    excerpts: matches.slice(0, maxExcerpts),
    confidence: lines.length > 0 ? 0.9 : 0.6,
  };
}

function summarizeRouteDump(
  raw: string,
  maxExcerpts: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  const lines = tokenizeLines(raw);
  const routeLines = lines.filter((line) =>
    /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/.test(line),
  );
  const authSensitive = routeLines.filter((line) => /(admin|auth|login|token|session)/i.test(line));

  return {
    summary: {
      summary_counts: {
        lines: lines.length,
        routes: routeLines.length,
        auth_sensitive_routes: authSensitive.length,
      },
      top_failures_or_errors: authSensitive.slice(0, 5),
      affected_files: extractFileLikeSegments(routeLines),
      severity_or_status: authSensitive.length > 0 ? 'review-required' : 'normal',
      next_recommended_actions: DEFAULT_ACTIONS['route-dump'],
    },
    excerpts: (authSensitive.length > 0 ? authSensitive : routeLines).slice(0, maxExcerpts),
    confidence: routeLines.length > 0 ? 0.9 : 0.5,
  };
}

function summarizeInventoryScan(
  raw: string,
  maxExcerpts: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  const lines = tokenizeLines(raw);
  const critical = lines.filter((line) => /\bcritical\b/i.test(line));
  const high = lines.filter((line) => /\bhigh\b/i.test(line));
  const medium = lines.filter((line) => /\bmedium\b/i.test(line));
  const low = lines.filter((line) => /\blow\b/i.test(line));
  const issues = [...critical, ...high, ...medium, ...low];

  const severity =
    critical.length > 0
      ? 'critical'
      : high.length > 0
        ? 'high'
        : medium.length > 0
          ? 'medium'
          : low.length > 0
            ? 'low'
            : 'none';

  return {
    summary: {
      summary_counts: {
        lines: lines.length,
        critical: critical.length,
        high: high.length,
        medium: medium.length,
        low: low.length,
      },
      top_failures_or_errors: issues.slice(0, 5),
      affected_files: extractFileLikeSegments(issues),
      severity_or_status: severity,
      next_recommended_actions: DEFAULT_ACTIONS['inventory-scan-output'],
    },
    excerpts: issues.slice(0, maxExcerpts),
    confidence: lines.length > 0 ? 0.85 : 0.5,
  };
}

function degradedSummary(
  artifactClass: BuildCompactArtifactInput['artifact_class'],
  raw: string,
  maxExcerpts: number,
  confidence: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  const lines = tokenizeLines(raw);
  return {
    summary: {
      summary_counts: { lines: lines.length },
      top_failures_or_errors: lines.slice(0, 5),
      affected_files: extractFileLikeSegments(lines),
      severity_or_status: lines.length > 0 ? 'unknown' : 'empty',
      next_recommended_actions: DEFAULT_ACTIONS[artifactClass],
    },
    excerpts: lines.slice(0, maxExcerpts),
    confidence,
  };
}

function minimizeCompactRepresentation(
  summaryResult: { summary: CompactArtifactSummary; excerpts: string[]; confidence: number },
  artifactClass: BuildCompactArtifactInput['artifact_class'],
  originalSize: number,
  maxExcerpts: number,
): { summary: CompactArtifactSummary; excerpts: string[]; confidence: number } {
  if (originalSize <= 0) {
    return summaryResult;
  }

  const fullSize = measureCompactRepresentation(
    summaryResult.summary,
    summaryResult.excerpts,
    summaryResult.confidence,
  );
  if (fullSize < originalSize) {
    return summaryResult;
  }

  const shrunkSummary: CompactArtifactSummary = {
    summary_counts: summaryResult.summary.summary_counts,
    top_failures_or_errors: summaryResult.summary.top_failures_or_errors.slice(0, 1),
    affected_files: summaryResult.summary.affected_files.slice(0, 3),
    severity_or_status: summaryResult.summary.severity_or_status,
    next_recommended_actions: summaryResult.summary.next_recommended_actions.slice(0, 1),
  };
  const shrunkExcerpts = summaryResult.excerpts.slice(0, 1).map((line) => line.slice(0, 240));
  const shrunkSize = measureCompactRepresentation(
    shrunkSummary,
    shrunkExcerpts,
    summaryResult.confidence,
  );
  if (shrunkSize < originalSize) {
    return {
      summary: shrunkSummary,
      excerpts: shrunkExcerpts,
      confidence: summaryResult.confidence,
    };
  }

  if (originalSize < 256) {
    return summaryResult;
  }

  const fallback = degradedSummary(
    artifactClass,
    '',
    Math.min(maxExcerpts, 1),
    summaryResult.confidence,
  );
  return fallback;
}

function measureCompactRepresentation(
  summary: CompactArtifactSummary,
  excerpts: string[],
  confidence: number,
): number {
  return Buffer.byteLength(
    JSON.stringify({
      summary,
      excerpts,
      confidence,
    }),
    'utf8',
  );
}

function createDeltaMetadata(fullState: unknown, delta: unknown): TokenEfficiencyMetadata {
  const fullStateRaw = JSON.stringify(fullState) ?? '';
  const deltaRaw = JSON.stringify(delta) ?? '';
  const originalSize = Buffer.byteLength(fullStateRaw, 'utf8');
  const compactSize = Buffer.byteLength(deltaRaw, 'utf8');

  return {
    original_size: originalSize,
    compact_size: compactSize,
    reduction_ratio: calculateReductionRatio(originalSize, compactSize),
    delta_mode_used: true,
    escalation_occurred: false,
  };
}

function buildDeltaReasoningPayload<TDelta extends object>(
  delta: TDelta,
  deltaMetadata: TokenEfficiencyMetadata,
  escalationInput: Omit<EvaluateEscalationInput, 'compact'>,
): DeltaReasoningPayload<TDelta> {
  const compact = buildCompactArtifact({
    artifact_class: 'json-report',
    raw_content: JSON.stringify(delta),
  });

  const escalation = evaluateEscalation({
    ...escalationInput,
    compact: {
      ...compact,
      metadata: {
        ...deltaMetadata,
        escalation_occurred: false,
      },
    },
  });

  return {
    delta,
    payload: buildReasoningInputPayload(compact, escalation),
  };
}

function resolveDisclosureLevel(input: DisclosurePolicyInput): DisclosureLevel {
  const requestedLevel = input.requested_level ?? 'summary';
  if (input.escalation_reason === 'high-risk-or-cross-cutting') {
    return 'excerpt';
  }

  if (input.escalation_reason) {
    if (requestedLevel === 'summary') {
      return 'compact';
    }

    return requestedLevel;
  }

  if (requestedLevel === 'raw' && input.escalation?.raw_slice == null) {
    return 'excerpt';
  }

  return DISCLOSURE_LEVELS.includes(requestedLevel) ? requestedLevel : 'summary';
}

function buildDisclosurePayload(
  level: DisclosureLevel,
  compact: CompactArtifactResult,
  escalation?: EscalationDecision,
): string {
  switch (level) {
    case 'summary':
      return `${compact.summary.severity_or_status}: ${compact.summary.top_failures_or_errors[0] ?? 'none'}`;
    case 'compact':
      return JSON.stringify(compact.summary);
    case 'excerpt':
      return compact.targeted_excerpts.join('\n');
    case 'raw':
      return escalation?.raw_slice ?? compact.targeted_excerpts.join('\n');
  }
}

function resolveRetrievalPath(
  taskComplexity: RetrievalGateInput['task_complexity'],
  ambiguityDetected: boolean,
  chunkCount: number,
  threshold: number,
  conflictingEvidence: boolean,
): {
  path: RetrievalPath;
  rag_skipped: boolean;
  escalation_signal: RetrievalEscalationSignal | null;
} {
  let path: RetrievalPath;
  let ragSkipped: boolean;
  let escalationSignal: RetrievalEscalationSignal | null = null;

  if (taskComplexity === 'cross-cutting') {
    path = 'rag-deep';
    ragSkipped = false;
  } else if (taskComplexity === 'single-module') {
    if (ambiguityDetected) {
      path = 'rag-shallow';
      ragSkipped = false;
      escalationSignal = 'unresolved-target-file-ambiguity';
    } else if (chunkCount < threshold) {
      path = 'rag-shallow';
      ragSkipped = false;
      escalationSignal = 'insufficient-chunks';
    } else {
      path = 'lexical';
      ragSkipped = true;
    }
  } else if (taskComplexity === 'trivial' || taskComplexity === 'single-file') {
    if (ambiguityDetected) {
      path = 'lexical';
      ragSkipped = false;
      escalationSignal = 'unresolved-target-file-ambiguity';
    } else {
      path = 'direct';
      ragSkipped = true;
    }
  } else {
    path = 'rag-deep';
    ragSkipped = false;
  }

  if (conflictingEvidence) {
    escalationSignal = 'conflicting-evidence';
  }

  return {
    path,
    rag_skipped: ragSkipped,
    escalation_signal: escalationSignal,
  };
}

function resolveRoutingMechanism(
  taskType: string,
  metadata?: Record<string, unknown>,
): {
  mechanism: RoutingMechanism;
  resolved: boolean;
  resolved_task_type: string | null;
} {
  if (
    DETERMINISTIC_TASK_TYPES.some(
      (candidate) => taskType === candidate || taskType.startsWith(`${candidate}:`),
    )
  ) {
    return {
      mechanism: ROUTING_MECHANISMS[0],
      resolved: true,
      resolved_task_type: taskType,
    };
  }

  const workflowId = metadata?.workflow_id;
  if (typeof workflowId === 'string' && workflowId.trim().length > 0) {
    return {
      mechanism: ROUTING_MECHANISMS[1],
      resolved: true,
      resolved_task_type: workflowId,
    };
  }

  return {
    mechanism: ROUTING_MECHANISMS[3],
    resolved: false,
    resolved_task_type: null,
  };
}

function calculateReductionRatio(originalSize: number, compactSize: number): number {
  if (originalSize <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - compactSize / originalSize));
}

function extractFileLikeSegments(lines: string[]): string[] {
  const matches: string[] = [];
  const pattern = /(?:\.?\/?[\w@.-]+\/)+[\w.-]+(?:\.[a-zA-Z0-9]+)?/g;

  for (const line of lines) {
    for (const hit of line.match(pattern) ?? []) {
      matches.push(hit);
    }
  }

  return sortUnique(matches).slice(0, 10);
}

function flattenJson(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') {
    return [`${prefix}${String(value)}`];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => flattenJson(entry, `${prefix}[${index}].`));
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    flattenJson(nested, `${prefix}${key}.`),
  );
}

function normalizedIssueMessage(item: TestIssueSnapshot): string {
  return collapseWhitespace(item.message.trim());
}

function tokenizeLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeLineEndings(raw: string): string {
  return raw.replace(/\r/g, '');
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export const __tokenEfficiencyInternals = {
  summarizeByClass,
  summarizeTestOutput,
  summarizeCoverageOutput,
  summarizeJsonReport,
  summarizeXmlReport,
  summarizeLogOutput,
  summarizeGrepResults,
  summarizeRouteDump,
  summarizeInventoryScan,
  degradedSummary,
  minimizeCompactRepresentation,
  measureCompactRepresentation,
  resolveEscalationReason,
  extractRawSlice,
  createDeltaMetadata,
  buildDeltaReasoningPayload,
  resolveDisclosureLevel,
  buildDisclosurePayload,
  resolveRetrievalPath,
  resolveRoutingMechanism,
  extractFileLikeSegments,
  flattenJson,
  normalizedIssueMessage,
  tokenizeLines,
  normalizeLineEndings,
  collapseWhitespace,
  sortUnique,
  calculateReductionRatio,
};
