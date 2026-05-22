import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  __tokenEfficiencyInternals,
  applyDisclosurePolicy,
  buildControlLayerAudit,
  buildCompactArtifact,
  buildDriftDeltaReasoningPayload,
  buildReasoningInputPayload,
  buildTestDeltaReasoningPayload,
  buildVerificationDeltaReasoningPayload,
  createDriftDelta,
  createTestDelta,
  createVerificationDelta,
  evaluateRetrievalGate,
  evaluateEscalation,
  runRoutingDecision,
} from '@/token-efficiency/index.js';

describe('token efficiency service', () => {
  it('builds compact artifacts for all supported machine artifact classes', () => {
    const fixtures: Array<{
      artifactClass:
        | 'test-output'
        | 'coverage-output'
        | 'json-report'
        | 'xml-report'
        | 'log-output'
        | 'grep-results'
        | 'route-dump'
        | 'inventory-scan-output';
      raw: string;
    }> = [
      {
        artifactClass: 'test-output',
        raw: 'FAIL tests/a.spec.ts::should_fail\nPASS tests/b.spec.ts::should_pass',
      },
      {
        artifactClass: 'coverage-output',
        raw: 'src/a.ts 92%\nsrc/b.ts 70%',
      },
      {
        artifactClass: 'json-report',
        raw: JSON.stringify({ findings: [{ severity: 'high', file: 'src/a.ts', error: 'boom' }] }),
      },
      {
        artifactClass: 'xml-report',
        raw: '<testsuite><testcase><failure message="bad">stack</failure></testcase></testsuite>',
      },
      {
        artifactClass: 'log-output',
        raw: 'INFO start\nWARN retries high\nERROR db timeout',
      },
      {
        artifactClass: 'grep-results',
        raw: 'src/a.ts:12: TODO\nsrc/b.ts:40: FIXME',
      },
      {
        artifactClass: 'route-dump',
        raw: 'GET /health\nPOST /admin/login',
      },
      {
        artifactClass: 'inventory-scan-output',
        raw: 'package lodash severity high\nopenssl severity critical',
      },
    ];

    for (const fixture of fixtures) {
      const compact = buildCompactArtifact({
        artifact_class: fixture.artifactClass,
        raw_content: fixture.raw,
        raw_artifact_path: '.paqad/raw.txt',
        max_excerpts: 2,
      });

      expect(compact.artifact_class).toBe(fixture.artifactClass);
      expect(compact.raw_artifact_path).toBe('.paqad/raw.txt');
      expect(compact.summary.next_recommended_actions.length).toBeGreaterThan(0);
      expect(compact.metadata.delta_mode_used).toBe(false);
      expect(compact.metadata.escalation_occurred).toBe(false);
      expect(compact.metadata.original_size).toBeGreaterThan(0);
      expect(compact.metadata.compact_size).toBeGreaterThan(0);
    }
  });

  it('handles malformed json reports with degraded confidence', () => {
    const compact = buildCompactArtifact({
      artifact_class: 'json-report',
      raw_content: '{bad json',
      raw_artifact_path: '.paqad/bad.json',
    });

    expect(compact.confidence).toBeLessThan(0.6);
    expect(compact.summary.severity_or_status).toBe('unknown');
  });

  it('shrinks compact representation for large artifacts when needed', () => {
    const noisyRaw = Array.from({ length: 200 }, (_, index) => `line-${index} value`).join('\n');
    const compact = buildCompactArtifact({
      artifact_class: 'log-output',
      raw_content: noisyRaw,
    });

    expect(compact.metadata.original_size).toBeGreaterThan(0);
    expect(compact.metadata.compact_size).toBeLessThan(compact.metadata.original_size);
  });

  it('supports explicit and inferred escalation conditions and keeps raw artifacts opt-in', () => {
    const compact = buildCompactArtifact({
      artifact_class: 'log-output',
      raw_content: 'ERROR src/api.ts:42 failed hard\nWARN src/api.ts:12 warning',
      raw_artifact_path: '.paqad/logs.txt',
    });

    const noEscalation = evaluateEscalation({ compact, confidence_threshold: 0.2 });
    expect(noEscalation.should_escalate).toBe(false);
    expect(noEscalation.raw_slice).toBeNull();

    const inferredEscalation = evaluateEscalation({
      compact: { ...compact, confidence: 0.1 },
      confidence_threshold: 0.7,
      slice_hint: 'api.ts:42',
      max_raw_slice_chars: 40,
    });
    expect(inferredEscalation.should_escalate).toBe(true);
    expect(inferredEscalation.reason).toBe('summary-confidence-low');
    expect(inferredEscalation.raw_slice).toContain('api.ts:42');

    const explicitEscalation = evaluateEscalation({
      compact,
      reason: 'structured-parse-failed-or-degraded',
      unresolved_after_compact: true,
      contradiction_detected: true,
    });
    expect(explicitEscalation.should_escalate).toBe(true);
    expect(explicitEscalation.reason).toBe('structured-parse-failed-or-degraded');
    expect(explicitEscalation.metadata.escalation_occurred).toBe(true);

    const payload = buildReasoningInputPayload(compact, explicitEscalation);
    expect(payload.compact_summary).toEqual(compact.summary);
    expect(payload.raw_slice).not.toBeNull();
    expect(payload.escalation_reason).toBe('structured-parse-failed-or-degraded');
  });

  it('does not escalate when no raw artifact path exists', () => {
    const compact = buildCompactArtifact({
      artifact_class: 'test-output',
      raw_content: 'FAIL tests/no-path.spec.ts',
    });
    const escalation = evaluateEscalation({
      compact,
      reason: 'diagnosis-unresolved-after-compact-pass',
    });

    expect(escalation.should_escalate).toBe(true);
    expect(escalation.raw_slice).toBe('FAIL tests/no-path.spec.ts');

    const fallbackSliceEscalation = evaluateEscalation({
      compact,
      reason: 'diagnosis-unresolved-after-compact-pass',
      slice_hint: 'missing-hint',
    });
    expect(fallbackSliceEscalation.raw_slice).toBe('FAIL tests/no-path.spec.ts');
  });

  it('emits delta-only outputs for test, verification, and drift snapshots', () => {
    const testDelta = createTestDelta(
      [
        { test_id: 'a', status: 'passed', message: 'ok' },
        { test_id: 'b', status: 'failed', message: 'expected 1 to be 2' },
        { test_id: 'c', status: 'errored', message: 'timeout' },
        { test_id: 'e', status: 'failed', message: 'before pass transition' },
        { test_id: 'f', status: 'passed', message: 'before error transition' },
      ],
      [
        { test_id: 'a', status: 'failed', message: 'new assertion' },
        { test_id: 'b', status: 'failed', message: 'expected 1 to be 3' },
        { test_id: 'e', status: 'passed', message: 'recovered' },
        { test_id: 'f', status: 'errored', message: 'crashed now' },
        { test_id: 'd', status: 'passed', message: 'new pass' },
      ],
      { treat_missing_as_passing: true },
    );

    expect(testDelta.delta.newly_failing_tests).toEqual(['a']);
    expect(testDelta.delta.newly_errored_tests).toEqual(['f']);
    expect(testDelta.delta.newly_passing_tests).toEqual(['c', 'e']);
    expect(testDelta.delta.changed_failure_messages).toEqual([
      {
        test_id: 'b',
        before: 'expected 1 to be 2',
        after: 'expected 1 to be 3',
      },
    ]);
    expect(testDelta.metadata.delta_mode_used).toBe(true);

    const verificationDelta = createVerificationDelta(
      [
        { gate: 'code-tests-lint', passed: true, detail: 'clean' },
        {
          gate: 'behavioral-correctness',
          passed: false,
          detail: '1 failing test',
          remediation: 'fix tests',
        },
        {
          gate: 'database-quality',
          passed: false,
          detail: 'schema drift detected',
          remediation: 'refresh schema docs',
        },
      ],
      [
        {
          gate: 'code-tests-lint',
          passed: false,
          detail: 'lint failed',
          remediation: 'run lint --fix',
        },
        {
          gate: 'behavioral-correctness',
          passed: false,
          detail: '2 failing tests',
          remediation: 'fix more tests',
        },
        { gate: 'documentation-freshness', passed: true, detail: 'fresh' },
      ],
    );

    expect(verificationDelta.delta.changed_gate_outcomes).toEqual([
      {
        gate: 'code-tests-lint',
        before_passed: true,
        after_passed: false,
      },
      {
        gate: 'documentation-freshness',
        before_passed: false,
        after_passed: true,
      },
    ]);
    expect(verificationDelta.delta.changed_evidence.map((entry) => entry.gate)).toEqual([
      'behavioral-correctness',
      'code-tests-lint',
      'documentation-freshness',
    ]);
    expect(verificationDelta.delta.changed_recommended_actions.map((entry) => entry.gate)).toEqual([
      'behavioral-correctness',
      'code-tests-lint',
    ]);

    const verificationDeltaWithNewRemediation = createVerificationDelta(
      [],
      [
        {
          gate: 'new-gate',
          passed: false,
          detail: 'newly added',
          remediation: 'take action',
        },
      ],
    );
    expect(verificationDeltaWithNewRemediation.delta.changed_recommended_actions).toEqual([
      {
        gate: 'new-gate',
        before: '',
        after: 'take action',
      },
    ]);
    expect(verificationDeltaWithNewRemediation.delta.changed_gate_outcomes).toEqual([
      {
        gate: 'new-gate',
        before_passed: true,
        after_passed: false,
      },
    ]);

    const driftDelta = createDriftDelta(
      [
        { file: 'docs/a.md', status: 'ok', conclusion: 'aligned' },
        { file: 'docs/b.md', status: 'stale', conclusion: 'refresh needed' },
      ],
      [
        { file: 'docs/a.md', status: 'changed', conclusion: 'review needed' },
        { file: 'docs/c.md', status: 'new', conclusion: 'added' },
      ],
    );

    expect(driftDelta.delta.changed_files).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md']);
    expect(driftDelta.delta.changed_statuses).toEqual([
      { file: 'docs/a.md', before: 'ok', after: 'changed' },
      { file: 'docs/b.md', before: 'stale', after: '' },
      { file: 'docs/c.md', before: '', after: 'new' },
    ]);
    expect(driftDelta.delta.changed_conclusions).toEqual([
      { file: 'docs/a.md', before: 'aligned', after: 'review needed' },
      { file: 'docs/b.md', before: 'refresh needed', after: '' },
      { file: 'docs/c.md', before: '', after: 'added' },
    ]);
  });

  it('covers internal helpers and edge branches', () => {
    expect(__tokenEfficiencyInternals.tokenizeLines('a\n\n b ')).toEqual(['a', 'b']);
    expect(__tokenEfficiencyInternals.normalizeLineEndings('a\r\nb\r')).toBe('a\nb');
    expect(__tokenEfficiencyInternals.collapseWhitespace('a   b\n c')).toBe('a b c');
    expect(__tokenEfficiencyInternals.sortUnique(['b', 'a', 'b'])).toEqual(['a', 'b']);
    expect(__tokenEfficiencyInternals.flattenJson({ a: [1, { b: 'x' }] })).toEqual([
      'a.[0].1',
      'a.[1].b.x',
    ]);
    expect(__tokenEfficiencyInternals.extractFileLikeSegments(['nope'])).toEqual([]);
    expect(
      __tokenEfficiencyInternals.measureCompactRepresentation(
        {
          summary_counts: { lines: 1 },
          top_failures_or_errors: [],
          affected_files: [],
          severity_or_status: 'ok',
          next_recommended_actions: [],
        },
        [],
        0.9,
      ),
    ).toBeGreaterThan(0);

    const degraded = __tokenEfficiencyInternals.degradedSummary(
      'json-report',
      'line1\nline2',
      1,
      0.2,
    );
    expect(degraded.confidence).toBe(0.2);
    expect(degraded.excerpts).toEqual(['line1']);
    expect(
      __tokenEfficiencyInternals.degradedSummary('json-report', '', 1, 0.1).summary
        .severity_or_status,
    ).toBe('empty');

    expect(
      __tokenEfficiencyInternals.summarizeRouteDump('route-without-method', 2).confidence,
    ).toBe(0.5);
    expect(__tokenEfficiencyInternals.summarizeInventoryScan('', 1).confidence).toBe(0.5);
    expect(__tokenEfficiencyInternals.summarizeLogOutput('', 1).summary.severity_or_status).toBe(
      'ok',
    );
    expect(
      __tokenEfficiencyInternals.summarizeLogOutput('warn: check this', 1).summary
        .severity_or_status,
    ).toBe('warning');

    expect(
      __tokenEfficiencyInternals.summarizeGrepResults('src/a.ts:12: hit\nlabel:value\nno-match', 3)
        .summary.severity_or_status,
    ).toBe('matches-found');
    expect(
      __tokenEfficiencyInternals.summarizeGrepResults('plain text only', 3).summary
        .severity_or_status,
    ).toBe('no-matches');
    expect(__tokenEfficiencyInternals.summarizeGrepResults('', 3).confidence).toBe(0.6);
    expect(
      __tokenEfficiencyInternals.summarizeXmlReport('plain text', 2).summary.severity_or_status,
    ).toBe('passing');
    expect(__tokenEfficiencyInternals.summarizeXmlReport('plain text', 2).confidence).toBe(0.5);
    expect(__tokenEfficiencyInternals.summarizeTestOutput('', 2).confidence).toBe(0.4);
    expect(
      __tokenEfficiencyInternals.summarizeCoverageOutput('src/a.ts 90%\nsrc/b.ts 70%', 2).summary
        .severity_or_status,
    ).toBe('below-target');
    expect(
      __tokenEfficiencyInternals.summarizeCoverageOutput('src/a.ts without percent', 2).summary
        .severity_or_status,
    ).toBe('meets-target');
    expect(__tokenEfficiencyInternals.summarizeCoverageOutput('no percentages', 2).confidence).toBe(
      0.55,
    );
    expect(
      __tokenEfficiencyInternals.summarizeJsonReport('{"status":"ok"}', 2).summary
        .severity_or_status,
    ).toBe('clean');

    const compact = buildCompactArtifact({
      artifact_class: 'test-output',
      raw_content: 'FAIL spec.ts',
      raw_artifact_path: '.paqad/raw.log',
    });

    const minimizedFromHugeSummary = __tokenEfficiencyInternals.minimizeCompactRepresentation(
      {
        summary: {
          summary_counts: { lines: 2000 },
          top_failures_or_errors: Array.from({ length: 80 }, (_, i) => `failure-${i}`),
          affected_files: Array.from({ length: 40 }, (_, i) => `src/file-${i}.ts`),
          severity_or_status: 'failing',
          next_recommended_actions: Array.from({ length: 50 }, (_, i) => `action-${i}`),
        },
        excerpts: Array.from({ length: 80 }, (_, i) => `excerpt-${i}`),
        confidence: 0.9,
      },
      'log-output',
      1200,
      3,
    );
    expect(minimizedFromHugeSummary.excerpts.length).toBeLessThanOrEqual(1);

    const minimizedFallback = __tokenEfficiencyInternals.minimizeCompactRepresentation(
      {
        summary: {
          summary_counts: Object.fromEntries(
            Array.from({ length: 200 }, (_, i) => [`very_long_summary_count_key_${i}`, i]),
          ),
          top_failures_or_errors: Array.from({ length: 30 }, (_, i) => `failure-${i}`),
          affected_files: Array.from({ length: 30 }, (_, i) => `src/file-${i}.ts`),
          severity_or_status: 'failing',
          next_recommended_actions: Array.from({ length: 30 }, (_, i) => `action-${i}`),
        },
        excerpts: Array.from({ length: 30 }, (_, i) => `excerpt-${i}`),
        confidence: 0.9,
      },
      'log-output',
      1024,
      3,
    );
    expect(minimizedFallback.confidence).toBe(0.9);

    expect(
      __tokenEfficiencyInternals.resolveEscalationReason(
        {
          compact,
          contradiction_detected: true,
        },
        0.4,
      ),
    ).toBe('compact-signals-contradict');

    expect(
      __tokenEfficiencyInternals.resolveEscalationReason(
        {
          compact,
          unresolved_after_compact: true,
          contradiction_detected: true,
        },
        0.4,
      ),
    ).toBe('diagnosis-unresolved-after-compact-pass');

    expect(
      __tokenEfficiencyInternals.resolveEscalationReason(
        {
          compact,
        },
        0.1,
      ),
    ).toBeNull();

    expect(__tokenEfficiencyInternals.extractRawSlice(compact, 5, 'none')).toBe('FAIL ');

    const metadata = __tokenEfficiencyInternals.createDeltaMetadata([], { changed: true });
    expect(metadata.delta_mode_used).toBe(true);
    expect(metadata.escalation_occurred).toBe(false);
    expect(metadata.reduction_ratio).toBe(0);
    expect(
      __tokenEfficiencyInternals.createDeltaMetadata(undefined, undefined).reduction_ratio,
    ).toBe(0);

    const introducedStates = createTestDelta(
      [],
      [
        { test_id: 'new-failed', status: 'failed', message: 'boom' },
        { test_id: 'new-errored', status: 'errored', message: 'timeout' },
      ],
    );
    expect(introducedStates.delta.newly_failing_tests).toEqual(['new-failed']);
    expect(introducedStates.delta.newly_errored_tests).toEqual(['new-errored']);
    expect(
      createTestDelta([{ test_id: 'removed', status: 'failed', message: 'old' }], []).delta
        .newly_passing_tests,
    ).toEqual([]);
    expect(
      createTestDelta([{ test_id: 'removed', status: 'failed', message: 'old' }], [], {
        treat_missing_as_passing: true,
      }).delta.newly_passing_tests,
    ).toEqual(['removed']);

    const verificationNullish = createVerificationDelta(
      [{ gate: 'lint', passed: true, detail: 'ok' }],
      [{ gate: 'lint', passed: true, detail: 'ok', remediation: undefined }],
    );
    expect(verificationNullish.delta.changed_recommended_actions).toEqual([]);
    const verificationRemovedWithoutRemediation = createVerificationDelta(
      [{ gate: 'stability', passed: true, detail: 'ok' }],
      [],
    );
    expect(verificationRemovedWithoutRemediation.delta.changed_gate_outcomes).toEqual([]);
    expect(verificationRemovedWithoutRemediation.delta.changed_evidence).toEqual([]);
    expect(verificationRemovedWithoutRemediation.delta.changed_recommended_actions).toEqual([]);

    expect(
      __tokenEfficiencyInternals.summarizeInventoryScan('sev high', 1).summary.severity_or_status,
    ).toBe('high');
    expect(
      __tokenEfficiencyInternals.summarizeInventoryScan('sev medium', 1).summary.severity_or_status,
    ).toBe('medium');
    expect(
      __tokenEfficiencyInternals.summarizeInventoryScan('sev low', 1).summary.severity_or_status,
    ).toBe('low');
    expect(
      __tokenEfficiencyInternals.summarizeInventoryScan('all clear', 1).summary.severity_or_status,
    ).toBe('none');

    expect(
      __tokenEfficiencyInternals.normalizedIssueMessage({
        test_id: 'x',
        status: 'failed',
        message: '  many\nspaces   ',
      }),
    ).toBe('many spaces');

    const root = mkdtempSync(join(tmpdir(), 'token-efficiency-raw-'));
    let compactNoExcerpt: ReturnType<typeof buildCompactArtifact> | undefined;
    try {
      const rawArtifactPath = join(root, 'pass-only.log');
      writeFileSync(rawArtifactPath, 'PASS tests/a.spec.ts::works');
      compactNoExcerpt = buildCompactArtifact({
        artifact_class: 'test-output',
        raw_content: 'PASS tests/a.spec.ts::works',
        raw_artifact_path: rawArtifactPath,
      });
      expect(__tokenEfficiencyInternals.extractRawSlice(compactNoExcerpt, 20, 'missing-hint')).toBe(
        'PASS tests/a.spec.ts',
      );

      const escalatedWithoutHint = evaluateEscalation({
        compact: compactNoExcerpt,
        reason: 'diagnosis-unresolved-after-compact-pass',
      });
      expect(escalatedWithoutHint.should_escalate).toBe(true);
      expect(escalatedWithoutHint.raw_slice).toBe('PASS tests/a.spec.ts::works');

      writeFileSync(rawArtifactPath, 'line one\nneedle line\nline three\nline four');
      expect(__tokenEfficiencyInternals.extractRawSlice(compactNoExcerpt, 80, 'needle line')).toBe(
        'line one\nneedle line\nline three',
      );
      writeFileSync(rawArtifactPath, '   \n\n ');
      expect(
        __tokenEfficiencyInternals.extractRawSlice(compactNoExcerpt, 80, 'needle line'),
      ).toBeNull();

      const compactMissingFile = buildCompactArtifact({
        artifact_class: 'test-output',
        raw_content: 'PASS tests/a.spec.ts::works',
        raw_artifact_path: join(root, 'missing.log'),
      });
      expect(
        __tokenEfficiencyInternals.extractRawSlice(compactMissingFile, 80, 'needle line'),
      ).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    expect(compactNoExcerpt).toBeDefined();
    if (!compactNoExcerpt) {
      throw new Error('Expected compact artifact fixture to be created');
    }
    const noEscalationPayload = buildReasoningInputPayload(
      compactNoExcerpt,
      evaluateEscalation({ compact: compactNoExcerpt, confidence_threshold: 0 }),
    );
    expect(noEscalationPayload.raw_slice).toBeNull();

    const emptyCompact = buildCompactArtifact({
      artifact_class: 'log-output',
      raw_content: ' \n\t ',
    });
    expect(emptyCompact.metadata.original_size).toBe(4);
    expect(emptyCompact.metadata.reduction_ratio).toBe(0);
    expect(
      buildCompactArtifact({ artifact_class: 'log-output', raw_content: 'x' }).metadata
        .reduction_ratio,
    ).toBe(0);
    expect(__tokenEfficiencyInternals.calculateReductionRatio(10, 20)).toBe(0);
    expect(__tokenEfficiencyInternals.calculateReductionRatio(10, 0)).toBe(1);

    const deltaReasoningPayload = __tokenEfficiencyInternals.buildDeltaReasoningPayload(
      { changed: ['a'] },
      {
        original_size: 100,
        compact_size: 20,
        reduction_ratio: 0.8,
        delta_mode_used: true,
        escalation_occurred: false,
      },
      {},
    );
    expect(deltaReasoningPayload.payload.metadata.delta_mode_used).toBe(true);
    expect(deltaReasoningPayload.payload.raw_slice).toBeNull();
  });

  it('builds default compact delta reasoning payloads for test, verification, and drift', () => {
    const testPayload = buildTestDeltaReasoningPayload(
      [{ test_id: 'a', status: 'passed', message: 'ok' }],
      [{ test_id: 'a', status: 'failed', message: 'broke' }],
    );
    expect(testPayload.delta.newly_failing_tests).toEqual(['a']);
    expect(testPayload.payload.metadata.delta_mode_used).toBe(true);
    expect(testPayload.payload.raw_slice).toBeNull();
    expect(
      buildTestDeltaReasoningPayload([{ test_id: 'c', status: 'failed', message: 'before' }], [])
        .delta.newly_passing_tests,
    ).toEqual([]);
    expect(
      buildTestDeltaReasoningPayload([{ test_id: 'c', status: 'failed', message: 'before' }], [], {
        treat_missing_as_passing: true,
      }).delta.newly_passing_tests,
    ).toEqual(['c']);

    const verificationPayload = buildVerificationDeltaReasoningPayload(
      [{ gate: 'lint', passed: true, detail: 'ok' }],
      [{ gate: 'lint', passed: false, detail: 'bad', remediation: 'fix' }],
      { reason: 'diagnosis-unresolved-after-compact-pass' },
    );
    expect(verificationPayload.delta.changed_gate_outcomes).toEqual([
      { gate: 'lint', before_passed: true, after_passed: false },
    ]);
    expect(verificationPayload.payload.metadata.delta_mode_used).toBe(true);
    expect(verificationPayload.payload.metadata.escalation_occurred).toBe(true);

    const driftPayload = buildDriftDeltaReasoningPayload(
      [{ file: 'docs/a.md', status: 'ok', conclusion: 'aligned' }],
      [{ file: 'docs/a.md', status: 'stale', conclusion: 'refresh' }],
      { contradiction_detected: true },
    );
    expect(driftPayload.delta.changed_files).toEqual(['docs/a.md']);
    expect(driftPayload.payload.metadata.delta_mode_used).toBe(true);
    expect(driftPayload.payload.escalation_reason).toBe('compact-signals-contradict');
  });

  it('reduces compact payload size for sub-1kb artifacts when possible', () => {
    const repetitiveErrorLog = Array.from(
      { length: 12 },
      (_, index) => `ERROR src/module-${index}.ts: Something failed with detailed message`,
    ).join('\n');

    const compact = buildCompactArtifact({
      artifact_class: 'log-output',
      raw_content: repetitiveErrorLog,
    });

    expect(compact.metadata.original_size).toBeLessThan(1024);
    expect(compact.metadata.compact_size).toBeLessThan(compact.metadata.original_size);
  });
});

describe('token efficiency control layer (do-next)', () => {
  const compact = buildCompactArtifact({
    artifact_class: 'log-output',
    raw_content: 'ERROR src/api.ts:42 failed hard\nWARN src/api.ts:12 warning',
  });
  const emptyCompact = buildCompactArtifact({
    artifact_class: 'log-output',
    raw_content: '',
  });

  it('applies default summary disclosure without escalation', () => {
    const result = applyDisclosurePolicy({ compact });

    expect(result.level).toBe('summary');
    expect(result.payload).toBe('error: ERROR src/api.ts:42 failed hard');
    expect(result.audit).toEqual({
      selected_level: 'summary',
      escalation_occurred: false,
      escalation_reason: null,
      skipped_intermediate: false,
    });
  });

  it('returns compact disclosure when explicitly requested', () => {
    const result = applyDisclosurePolicy({
      compact,
      requested_level: 'compact',
    });

    expect(result.level).toBe('compact');
    expect(result.payload).toBe(JSON.stringify(compact.summary));
    expect(result.skipped_intermediate).toBe(false);
  });

  it('returns excerpt disclosure when escalation justifies it', () => {
    const result = applyDisclosurePolicy({
      compact,
      requested_level: 'excerpt',
      escalation_reason: 'previous-layer-insufficient',
    });

    expect(result.level).toBe('excerpt');
    expect(result.payload).toBe(compact.targeted_excerpts.join('\n'));
    expect(result.audit.escalation_occurred).toBe(true);
    expect(result.audit.escalation_reason).toBe('previous-layer-insufficient');
  });

  it('returns raw disclosure when a raw slice exists and escalation is provided', () => {
    const result = applyDisclosurePolicy({
      compact,
      requested_level: 'raw',
      escalation_reason: 'ambiguity-unresolved',
      escalation: {
        should_escalate: true,
        reason: 'summary-confidence-low',
        raw_slice: 'RAW LINE',
        metadata: compact.metadata,
      },
    });

    expect(result.level).toBe('raw');
    expect(result.payload).toBe('RAW LINE');
    expect(result.audit.selected_level).toBe('raw');
  });

  it('caps raw requests to excerpt when no raw slice is available and no reason is provided', () => {
    const result = applyDisclosurePolicy({
      compact,
      requested_level: 'raw',
      escalation: {
        should_escalate: false,
        reason: null,
        raw_slice: null,
        metadata: compact.metadata,
      },
    });

    expect(result.level).toBe('excerpt');
    expect(result.payload).toBe(compact.targeted_excerpts.join('\n'));
    expect(result.skipped_intermediate).toBe(true);
    expect(result.audit.skipped_intermediate).toBe(true);
  });

  it('jumps to excerpt for high-risk or cross-cutting disclosure requests', () => {
    const result = applyDisclosurePolicy({
      compact,
      escalation_reason: 'high-risk-or-cross-cutting',
    });

    expect(result.level).toBe('excerpt');
    expect(result.payload).toBe(compact.targeted_excerpts.join('\n'));
  });

  it('populates disclosure audit fields for escalated compact requests', () => {
    const result = applyDisclosurePolicy({
      compact,
      requested_level: 'compact',
      escalation_reason: 'ambiguity-unresolved',
    });

    expect(result.audit).toEqual({
      selected_level: 'compact',
      escalation_occurred: true,
      escalation_reason: 'ambiguity-unresolved',
      skipped_intermediate: false,
    });
  });

  it('evaluates retrieval gating for all planned complexity branches', () => {
    expect(evaluateRetrievalGate({ task_complexity: 'trivial' })).toEqual({
      preferred_path: 'direct',
      rag_skipped: true,
      escalation_signal: null,
      audit: {
        retrieval_depth: 'direct',
        rag_skipped: true,
        escalation_signal: null,
      },
    });

    expect(
      evaluateRetrievalGate({
        task_complexity: 'trivial',
        ambiguity_detected: true,
      }),
    ).toEqual({
      preferred_path: 'lexical',
      rag_skipped: false,
      escalation_signal: 'unresolved-target-file-ambiguity',
      audit: {
        retrieval_depth: 'lexical',
        rag_skipped: false,
        escalation_signal: 'unresolved-target-file-ambiguity',
      },
    });

    expect(evaluateRetrievalGate({ task_complexity: 'single-file' }).preferred_path).toBe('direct');
    expect(
      evaluateRetrievalGate({
        task_complexity: 'single-file',
        ambiguity_detected: true,
      }).preferred_path,
    ).toBe('lexical');

    expect(
      evaluateRetrievalGate({
        task_complexity: 'single-module',
        chunk_count: 5,
        min_chunk_threshold: 3,
      }),
    ).toEqual({
      preferred_path: 'lexical',
      rag_skipped: true,
      escalation_signal: null,
      audit: {
        retrieval_depth: 'lexical',
        rag_skipped: true,
        escalation_signal: null,
      },
    });

    expect(
      evaluateRetrievalGate({
        task_complexity: 'single-module',
        chunk_count: 1,
        min_chunk_threshold: 3,
      }).escalation_signal,
    ).toBe('insufficient-chunks');

    expect(
      evaluateRetrievalGate({
        task_complexity: 'single-module',
        chunk_count: 5,
        conflicting_evidence: true,
      }),
    ).toEqual({
      preferred_path: 'lexical',
      rag_skipped: true,
      escalation_signal: 'conflicting-evidence',
      audit: {
        retrieval_depth: 'lexical',
        rag_skipped: true,
        escalation_signal: 'conflicting-evidence',
      },
    });

    expect(
      evaluateRetrievalGate({
        task_complexity: 'single-module',
        ambiguity_detected: true,
      }).escalation_signal,
    ).toBe('unresolved-target-file-ambiguity');

    const crossCutting = evaluateRetrievalGate({ task_complexity: 'cross-cutting' });
    expect(crossCutting.preferred_path).toBe('rag-deep');
    expect(crossCutting.rag_skipped).toBe(false);
    expect(crossCutting.audit.retrieval_depth).toBe('rag-deep');
  });

  it('routes deterministic, metadata-resolved, and reasoning-only tasks correctly', () => {
    expect(runRoutingDecision({ task_type: 'lint' })).toEqual({
      needs_reasoning: false,
      mechanism_used: 'deterministic-rule',
      resolved_task_type: 'lint',
      audit: {
        routing_mechanism: 'deterministic-rule',
        resolved_before_reasoning: true,
      },
    });
    expect(runRoutingDecision({ task_type: 'format' }).mechanism_used).toBe('deterministic-rule');
    expect(runRoutingDecision({ task_type: 'typecheck' }).mechanism_used).toBe(
      'deterministic-rule',
    );
    expect(runRoutingDecision({ task_type: 'build' }).mechanism_used).toBe('deterministic-rule');
    expect(runRoutingDecision({ task_type: 'test-run' }).mechanism_used).toBe('deterministic-rule');
    expect(runRoutingDecision({ task_type: 'ci' }).mechanism_used).toBe('deterministic-rule');
    expect(runRoutingDecision({ task_type: 'lint:changed' }).resolved_task_type).toBe(
      'lint:changed',
    );

    const metadataResolved = runRoutingDecision({
      task_type: 'custom-task',
      metadata: { workflow_id: 'my-flow' },
    });
    expect(metadataResolved).toEqual({
      needs_reasoning: false,
      mechanism_used: 'metadata-lookup',
      resolved_task_type: 'my-flow',
      audit: {
        routing_mechanism: 'metadata-lookup',
        resolved_before_reasoning: true,
      },
    });

    const unknown = runRoutingDecision({ task_type: 'custom-task' });
    expect(unknown).toEqual({
      needs_reasoning: true,
      mechanism_used: 'reasoning-model',
      resolved_task_type: null,
      audit: {
        routing_mechanism: 'reasoning-model',
        resolved_before_reasoning: false,
      },
    });
    expect('narrative' in unknown).toBe(false);
    expect('explanation' in unknown).toBe(false);

    expect(
      runRoutingDecision({
        task_type: 'custom-task',
        metadata: { owner: 'ops' },
      }).mechanism_used,
    ).toBe('reasoning-model');
  });

  it('combines the three control-layer audit records', () => {
    const audit = buildControlLayerAudit(
      {
        selected_level: 'compact',
        escalation_occurred: true,
        escalation_reason: 'ambiguity-unresolved',
        skipped_intermediate: false,
      },
      {
        retrieval_depth: 'lexical',
        rag_skipped: true,
        escalation_signal: null,
      },
      {
        routing_mechanism: 'metadata-lookup',
        resolved_before_reasoning: true,
      },
    );

    expect(audit).toEqual({
      disclosure: {
        selected_level: 'compact',
        escalation_occurred: true,
        escalation_reason: 'ambiguity-unresolved',
        skipped_intermediate: false,
      },
      retrieval: {
        retrieval_depth: 'lexical',
        rag_skipped: true,
        escalation_signal: null,
      },
      routing: {
        routing_mechanism: 'metadata-lookup',
        resolved_before_reasoning: true,
      },
    });
  });

  it('covers control-layer internal helper branches directly', () => {
    expect(
      __tokenEfficiencyInternals.resolveDisclosureLevel({
        compact,
        requested_level: 'summary',
        escalation_reason: 'previous-layer-insufficient',
      }),
    ).toBe('compact');
    expect(
      __tokenEfficiencyInternals.resolveDisclosureLevel({
        compact,
        requested_level: 'raw',
        escalation_reason: 'high-risk-or-cross-cutting',
      }),
    ).toBe('excerpt');
    expect(
      __tokenEfficiencyInternals.resolveDisclosureLevel({
        compact,
        requested_level: 'raw',
      }),
    ).toBe('excerpt');
    expect(
      __tokenEfficiencyInternals.resolveDisclosureLevel({
        compact,
        requested_level: 'invalid-level' as never,
      }),
    ).toBe('summary');

    expect(__tokenEfficiencyInternals.buildDisclosurePayload('summary', compact)).toBe(
      'error: ERROR src/api.ts:42 failed hard',
    );
    expect(__tokenEfficiencyInternals.buildDisclosurePayload('summary', emptyCompact)).toBe(
      'ok: none',
    );
    expect(__tokenEfficiencyInternals.buildDisclosurePayload('compact', compact)).toBe(
      JSON.stringify(compact.summary),
    );
    expect(__tokenEfficiencyInternals.buildDisclosurePayload('excerpt', compact)).toBe(
      compact.targeted_excerpts.join('\n'),
    );
    expect(
      __tokenEfficiencyInternals.buildDisclosurePayload('raw', compact, {
        should_escalate: true,
        reason: 'summary-confidence-low',
        raw_slice: 'RAW PAYLOAD',
        metadata: compact.metadata,
      }),
    ).toBe('RAW PAYLOAD');
    expect(__tokenEfficiencyInternals.buildDisclosurePayload('raw', compact)).toBe(
      compact.targeted_excerpts.join('\n'),
    );

    expect(__tokenEfficiencyInternals.resolveRetrievalPath('trivial', false, 0, 3, false)).toEqual({
      path: 'direct',
      rag_skipped: true,
      escalation_signal: null,
    });
    expect(
      __tokenEfficiencyInternals.resolveRetrievalPath('single-file', false, 0, 3, false),
    ).toEqual({
      path: 'direct',
      rag_skipped: true,
      escalation_signal: null,
    });
    expect(
      __tokenEfficiencyInternals.resolveRetrievalPath('single-module', false, 1, 3, false),
    ).toEqual({
      path: 'rag-shallow',
      rag_skipped: false,
      escalation_signal: 'insufficient-chunks',
    });
    expect(
      __tokenEfficiencyInternals.resolveRetrievalPath('single-module', true, 5, 3, false),
    ).toEqual({
      path: 'rag-shallow',
      rag_skipped: false,
      escalation_signal: 'unresolved-target-file-ambiguity',
    });
    expect(
      __tokenEfficiencyInternals.resolveRetrievalPath('cross-cutting', false, 10, 3, true),
    ).toEqual({
      path: 'rag-deep',
      rag_skipped: false,
      escalation_signal: 'conflicting-evidence',
    });
    expect(
      __tokenEfficiencyInternals.resolveRetrievalPath(
        'unexpected-complexity' as never,
        false,
        0,
        3,
        false,
      ),
    ).toEqual({
      path: 'rag-deep',
      rag_skipped: false,
      escalation_signal: null,
    });

    expect(__tokenEfficiencyInternals.resolveRoutingMechanism('build', {})).toEqual({
      mechanism: 'deterministic-rule',
      resolved: true,
      resolved_task_type: 'build',
    });
    expect(
      __tokenEfficiencyInternals.resolveRoutingMechanism('custom', { workflow_id: 'wf-1' }),
    ).toEqual({
      mechanism: 'metadata-lookup',
      resolved: true,
      resolved_task_type: 'wf-1',
    });
    expect(__tokenEfficiencyInternals.resolveRoutingMechanism('custom')).toEqual({
      mechanism: 'reasoning-model',
      resolved: false,
      resolved_task_type: null,
    });
  });
});
