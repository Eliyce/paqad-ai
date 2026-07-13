import { describe, expect, it } from 'vitest';

import type { EvidenceLedgerRow, ReceiptEnvelope } from '@/core/types/evidence-ledger.js';
import { signReceipt } from '@/evidence/receipt/dsse.js';
import { buildInTotoStatement } from '@/evidence/receipt/statement.js';
import { ZERO_DIGEST } from '@/evidence/digests.js';
import type { FeatureBundleExport } from '@/feature-evidence/export.js';
import { featureReportPath } from '@/feature-evidence/paths.js';
import {
  deriveReportVerdict,
  formatDuration,
  renderFeatureReportHtml,
  verifyFeatureReceiptSelf,
} from '@/feature-evidence/report.js';
import { foldRowsWithKey } from '@/stage-evidence/fold.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import type { FoldedChange } from '@/stage-evidence/types.js';

const DIR = '353-code-knowledge-index-01KXD47JQ2AKEF8C3KCMA977NB';
const AT = '2026-07-13T10:00:00.000Z';

function fold(rows: Partial<SessionLedgerRow>[]): FoldedChange {
  return foldRowsWithKey(rows as SessionLedgerRow[], {
    sessionId: 's',
    changeKey: DIR,
    promptOrdinal: 0,
  });
}

const mk = (
  kind: string,
  stage: string,
  ts: string,
  extra: Record<string, unknown> = {},
): Partial<SessionLedgerRow> =>
  ({ kind, stage, ts, adapter: 'claude-code', evidence_source: 'live-mark', ...extra }) as never;

/** A complete-in-order set of stage rows (planning → documentation_sync) with artifacts. */
function completeStageRows(): Partial<SessionLedgerRow>[] {
  return [
    { kind: 'open', ts: '2026-07-13T09:00:00.000Z', adapter: 'claude-code', lane: 'full' } as never,
    mk('stage_start', 'planning', '2026-07-13T09:00:01.000Z'),
    mk('stage_end', 'planning', '2026-07-13T09:00:05.000Z', { artifact_digest: 'a1' }),
    mk('stage_start', 'specification', '2026-07-13T09:00:06.000Z'),
    mk('stage_end', 'specification', '2026-07-13T09:00:10.000Z', { artifact_digest: 'a2' }),
    mk('stage_start', 'development', '2026-07-13T09:00:11.000Z'),
    mk('stage_end', 'development', '2026-07-13T09:02:00.000Z', { evidence_source: 'inferred-git' }),
    mk('stage_start', 'review', '2026-07-13T09:03:00.000Z'),
    mk('stage_end', 'review', '2026-07-13T09:03:30.000Z', { artifact_digest: 'a3' }),
    mk('stage_start', 'checks', '2026-07-13T09:04:00.000Z'),
    // checks closed hours later by the backstop → "includes idle time"
    mk('stage_end', 'checks', '2026-07-13T13:00:00.000Z', { adapter: 'backstop' }),
    // documentation_sync runs after checks closes (no ordering overlap).
    mk('stage_start', 'documentation_sync', '2026-07-13T13:00:01.000Z'),
    mk('stage_end', 'documentation_sync', '2026-07-13T13:00:05.000Z'),
  ];
}

function gradedRows(verdict: 'pass' | 'fail'): EvidenceLedgerRow[] {
  const row = (ts: string): EvidenceLedgerRow =>
    ({
      schema_version: 1,
      ts,
      engine: 'verification-gate',
      code: 'ac-test-mapping',
      subject_digest: 'sd',
      verdict,
      strength_class: 'deterministic',
      content_hash: `h-${verdict}`,
      detail: 'Acceptance criteria map to tests',
    }) as EvidenceLedgerRow;
  // Two rows sharing a content_hash prove de-duplication by hash.
  return [row(AT), row('2026-07-13T10:00:01.000Z')];
}

function receiptEnvelope(verdict: 'pass' | 'fail'): ReceiptEnvelope {
  const statement = buildInTotoStatement({
    fileDigests: [{ name: 'src/x.ts', sha256: 'abc123' }],
    rows: gradedRows(verdict),
    verifierVersion: '1.56.0',
    timeVerified: AT,
  });
  return signReceipt({ statement, prevReceiptHash: ZERO_DIGEST, mode: 'hash-chained' });
}

function fullBundle(): FeatureBundleExport {
  return {
    dir_name: DIR,
    exported_at: AT,
    files: {
      plan: {
        title: 'Code-knowledge index',
        summary: 'Build the index.',
        steps: [{ id: 'S1', description: 'Do it', module: 'core' }],
        decisions: ['D-01ABC (create-vs-reuse): reuse the helper.'],
        risks: [{ description: 'coverage', mitigation: 'fixtures' }],
      },
      specification: {
        behaviour: ['FR-1: build the index'],
        acceptance_criteria: [
          {
            criterion_id: 'AC-1',
            given: 'a clone',
            when: 'build runs',
            then: 'the',
            proof_type: 'automated',
          },
        ],
        invariants: [{ invariant_id: 'INV-1', statement: 'zero LLM', confirmed: true }],
        frozen: { frozen_at: AT, signed_off_by: 'Haider (via Claude)' },
      },
      stageEvidence: completeStageRows(),
      ruleRun: [
        {
          kind: 'findings',
          counts: { deterministic: 2, heuristic: 3, skipped: 0 },
          blocking: true,
        },
      ],
      rag: [{ kind: 'called' }, { kind: 'used' }, { kind: 'fallback' }, { kind: 'refreshed' }],
      receipt: receiptEnvelope('fail') as unknown,
      aiBom: {
        serialNumber: 'urn:uuid:abc',
        components: [{ name: 'src/x.ts', hashes: [{ content: 'abc1234567890def' }] }],
      },
      delivery: {
        branch: 'feat/x',
        base_branch: 'main',
        commits: [{ sha: 'deadbeef1234', subject: 'feat: x' }],
        merge_commit: 'cafef00d5678',
      },
    },
  };
}

describe('formatDuration', () => {
  it('humanises spans across units', () => {
    expect(formatDuration(null)).toBe('unknown');
    expect(formatDuration(-5)).toBe('unknown');
    expect(formatDuration(820)).toBe('820ms');
    expect(formatDuration(3100)).toBe('3.1s');
    expect(formatDuration(45000)).toBe('45s');
    expect(formatDuration(125000)).toBe('2m 5s');
    expect(formatDuration(120000)).toBe('2m');
    expect(formatDuration(3_600_000)).toBe('1h');
    expect(formatDuration(3_780_000)).toBe('1h 3m');
  });
});

describe('verifyFeatureReceiptSelf', () => {
  it('accepts an intact envelope and rejects a tampered one (AC-3)', () => {
    const envelope = receiptEnvelope('pass');
    expect(verifyFeatureReceiptSelf(envelope)).toBe(true);
    const tampered = { ...envelope, payload: Buffer.from('{"tampered":true}').toString('base64') };
    expect(verifyFeatureReceiptSelf(tampered)).toBe(false);
    expect(verifyFeatureReceiptSelf({} as ReceiptEnvelope)).toBe(false);
    // An envelope with a payload but no payloadType / no paqad block → the DSSE and
    // ZERO_DIGEST fallbacks fire, and the missing receipt_hash fails the check.
    const bare = { payload: Buffer.from('x').toString('base64') } as ReceiptEnvelope;
    expect(verifyFeatureReceiptSelf(bare)).toBe(false);
  });
});

describe('deriveReportVerdict', () => {
  it('passes on a clean complete change, fails on a failed receipt gate, inconclusive on cannot-verify', () => {
    const complete = fold(completeStageRows());
    expect(deriveReportVerdict(complete, null)).toBe('pass');
    const failStmt = buildInTotoStatement({
      fileDigests: [],
      rows: gradedRows('fail'),
      verifierVersion: 'v',
      timeVerified: AT,
    });
    expect(deriveReportVerdict(complete, failStmt)).toBe('fail');
    expect(deriveReportVerdict(fold([]), null)).toBe('inconclusive');
  });

  it('fails when a stage failed', () => {
    const rows = [
      { kind: 'open', ts: AT, adapter: 'claude-code' },
      { kind: 'stage_start', stage: 'checks', ts: AT, adapter: 'claude-code' },
      {
        kind: 'stage_end',
        stage: 'checks',
        ts: AT,
        adapter: 'claude-code',
        event_status: 'failed',
      },
    ] as Partial<SessionLedgerRow>[];
    expect(deriveReportVerdict(fold(rows), null)).toBe('fail');
  });
});

describe('renderFeatureReportHtml — full bundle (AC-1)', () => {
  const html = renderFeatureReportHtml(fullBundle(), fold(completeStageRows()), {
    generatedAt: AT,
  });

  it('is one self-contained file: no scripts, no external URLs', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('carries the verdict words and every section', () => {
    expect(html).toContain('Needs your attention');
    for (const heading of [
      'Timeline',
      'Plan',
      'Specification',
      'Rules',
      'Retrieval',
      'Verification receipt',
      'AI bill of materials',
      'Delivery',
      'Review',
    ]) {
      expect(html).toContain(heading);
    }
  });

  it('shows per-stage durations, the idle-time flag, and the decoded receipt rows', () => {
    expect(html).toContain('4.0s'); // planning 09:00:01 → 09:00:05
    expect(html).toContain('includes idle time'); // checks closed by backstop
    expect(html).toContain('reconstructed from the diff'); // inferred-git development
    expect(html).toContain('ac-test-mapping'); // decoded receipt gate row
    expect(html).toContain('FAILED'); // receipt verification result
    expect(html).toContain('Integrity verified'); // hash recomputes
    // De-duplicated: the single gate row appears once in the gates table body.
    expect(html.match(/ac-test-mapping/g)!.length).toBe(1);
    expect(html).toContain('D-01ABC'); // linked decision
    expect(html).toContain('CycloneDX serial'); // ai-bom
    expect(html).toContain('feat/x'); // delivery branch
  });

  it('renders the review markdown as escaped preformatted text', () => {
    const html2 = renderFeatureReportHtml(fullBundle(), fold(completeStageRows()), {
      generatedAt: AT,
      reviewMarkdown: '# Review\n<script>alert(1)</script> looks good',
    });
    expect(html2).toContain('# Review');
    // The script tag from the review is escaped, never live.
    expect(html2).not.toMatch(/<script/i);
    expect(html2).toContain('&lt;script&gt;');
  });
});

describe('renderFeatureReportHtml — partial bundle graceful empty states (AC-2)', () => {
  const partial: FeatureBundleExport = {
    dir_name: '218-example-01KX5P20DVKF6DN1KC8ZSQ71Q3',
    exported_at: AT,
    files: {
      plan: { title: 'Partial', summary: 'only plan + stages' },
      stageEvidence: [
        { kind: 'open', ts: AT, adapter: 'claude-code' },
        mk('stage_start', 'planning', AT),
        mk('stage_end', 'planning', '2026-07-13T10:00:04.000Z', { artifact_digest: 'a' }),
      ],
    },
  };
  const html = renderFeatureReportHtml(partial, fold(partial.files.stageEvidence as never[]), {
    generatedAt: AT,
  });

  it('renders without error and shows a graceful note for every missing section', () => {
    expect(html).toContain('No frozen specification was recorded');
    expect(html).toContain('No rule-script runs were recorded');
    expect(html).toContain('No retrieval was recorded');
    expect(html).toContain('No verification receipt was written');
    expect(html).toContain('enterprise governance capability'); // enterprise-off wording
    expect(html).toContain('No AI-BOM was written');
    expect(html).toContain('No delivery record yet');
    expect(html).toContain('No review notes were recorded');
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('renderFeatureReportHtml — honest stage states (AC-4)', () => {
  it('renders a marker-only thinking stage as needs-a-look, never done', () => {
    // planning end WITHOUT an artifact_digest → inconclusive ("marked, no recorded work").
    const rows: Partial<SessionLedgerRow>[] = [
      { kind: 'open', ts: AT, adapter: 'claude-code' },
      mk('stage_start', 'planning', AT),
      mk('stage_end', 'planning', '2026-07-13T10:00:02.000Z'), // no artifact_digest
    ];
    const bundle: FeatureBundleExport = {
      dir_name: DIR,
      exported_at: AT,
      files: { stageEvidence: rows },
    };
    const html = renderFeatureReportHtml(bundle, fold(rows), { generatedAt: AT });
    expect(html).toContain('marked (no recorded work)');
  });
});

describe('renderFeatureReportHtml — section + stage variants (branch coverage)', () => {
  const render = (files: FeatureBundleExport['files'], dir = DIR): string => {
    const bundle: FeatureBundleExport = { dir_name: dir, exported_at: AT, files };
    return renderFeatureReportHtml(bundle, fold((files.stageEvidence as never[]) ?? []), {
      generatedAt: AT,
      paqadVersion: '1.56.0',
    });
  };

  it('renders a "Safe to merge" banner for a clean complete change with no receipt', () => {
    const html = render({ stageEvidence: completeStageRows() });
    expect(html).toContain('Safe to merge');
  });

  it('humanises an untitled change dir header and works with no plan title', () => {
    const html = render({ stageEvidence: [] }, 'change-01KX5P20DVKF6DN1KC8ZSQ71Q3');
    expect(html).toContain('Change 01KX5P20DVKF6DN1KC8ZSQ71Q3'.slice(0, 6));
    expect(html).toContain('paqad 1.56.0');
    expect(html).not.toContain('Issue #');
  });

  it('renders each honest stage state (failed, skipped, redone, running, inferred-artifact, near-zero, missing)', () => {
    const rows: Partial<SessionLedgerRow>[] = [
      { kind: 'open', ts: '2026-07-13T09:00:00.000Z', adapter: 'claude-code' },
      // planning: end BEFORE start → negative → near-zero/unreliable, but complete (has artifact).
      mk('stage_start', 'planning', '2026-07-13T09:00:05.000Z'),
      mk('stage_end', 'planning', '2026-07-13T09:00:04.000Z', { artifact_digest: 'a' }),
      // specification: skipped.
      mk('stage_start', 'specification', '2026-07-13T09:00:06.000Z'),
      mk('stage_end', 'specification', '2026-07-13T09:00:07.000Z', { event_status: 'skipped' }),
      // development: redone (reached an end after a redo).
      mk('stage_start', 'development', '2026-07-13T09:00:08.000Z'),
      mk('stage_end', 'development', '2026-07-13T09:00:09.000Z', { event_status: 'redone' }),
      // checks: running (start only).
      mk('stage_start', 'checks', '2026-07-13T09:00:10.000Z'),
      // review: complete via inferred-artifact.
      mk('stage_start', 'review', '2026-07-13T09:00:11.000Z'),
      mk('stage_end', 'review', '2026-07-13T09:00:15.000Z', {
        evidence_source: 'inferred-artifact',
        artifact_digest: 'r',
      }),
      // documentation_sync: failed.
      mk('stage_start', 'documentation_sync', '2026-07-13T09:00:16.000Z'),
      mk('stage_end', 'documentation_sync', '2026-07-13T09:00:17.000Z', { event_status: 'failed' }),
    ];
    const html = render({ stageEvidence: rows });
    expect(html).toContain('near-zero duration');
    expect(html).toContain('skipped');
    expect(html).toContain('(redone)');
    expect(html).toContain('started, not finished');
    expect(html).toContain('inferred from an artifact');
    expect(html).toContain('failed');
  });

  it('shows empty-state notes for an empty plan and an empty (unfrozen) spec', () => {
    const html = render({ plan: {}, specification: {} });
    expect(html).toContain('The plan is empty');
    expect(html).toContain('The specification is empty');
  });

  it('renders an unfrozen spec with unconfirmed invariant and a gwt-less AC', () => {
    const html = render({
      specification: {
        behaviour: [],
        acceptance_criteria: [{ criterion_id: 'AC-2', then: 'only a then' }],
        invariants: [{ invariant_id: 'INV-9', statement: 'holds', confirmed: false }],
        frozen: null,
      },
    });
    expect(html).toContain('AC-2');
    expect(html).toContain('unconfirmed');
    expect(html).toContain('INV-9');
  });

  it('summarises retrieval with only a fallback, and with only an unknown kind', () => {
    expect(render({ rag: [{ kind: 'fallback' }] })).toMatch(/fell back to grep/i);
    expect(render({ rag: [{ kind: 'mystery' }] })).toContain('Retrieval activity recorded');
  });

  it('reports rules that did not block as Clear', () => {
    const html = render({
      ruleRun: [
        {
          kind: 'findings',
          counts: { deterministic: 0, heuristic: 0, skipped: 0 },
          blocking: false,
        },
      ],
    });
    expect(html).toContain('Clear');
    expect(html).toContain('no rule run blocked');
  });

  it('renders a verified PASSED receipt with its gate rows', () => {
    const html = render({
      receipt: receiptEnvelope('pass') as unknown,
      stageEvidence: completeStageRows(),
    });
    expect(html).toContain('PASSED');
    expect(html).toContain('Integrity verified');
    expect(html).toContain('ac-test-mapping');
  });

  it('honestly reports a receipt whose payload cannot be decoded', () => {
    const broken = { ...receiptEnvelope('pass'), payload: '@@not-base64-json@@' };
    const html = render({ receipt: broken as unknown });
    expect(html).toContain('Could not verify integrity');
    expect(html).toContain('no graded gate rows');
  });

  it('renders an AI-BOM with no components key and a delivery with no commits key', () => {
    const html = render({
      aiBom: {}, // no components / serialNumber keys → ?? [] fallbacks
      delivery: { branch: 'feat/y' }, // no commits / base_branch / merge keys
    });
    expect(html).toContain('No file components recorded');
    expect(html).toContain('No commits linked yet');
    expect(html).toContain('feat/y');
  });

  it('renders a receipt whose rows carry odd verdicts and no content_hash', () => {
    const stmt = buildInTotoStatement({
      fileDigests: [],
      rows: [
        {
          schema_version: 1,
          ts: AT,
          engine: 'verification-gate',
          code: 'weird-gate',
          subject_digest: 's',
          verdict: 'inconclusive',
          strength_class: 'deterministic',
          detail: 'neither pass nor fail',
        } as EvidenceLedgerRow,
      ],
      verifierVersion: 'v',
      timeVerified: AT,
    });
    const env = signReceipt({
      statement: stmt,
      prevReceiptHash: ZERO_DIGEST,
      mode: 'hash-chained',
    });
    const html = render({ receipt: env as unknown });
    expect(html).toContain('weird-gate');
    expect(html).toContain('inconclusive');
  });

  it('counts an unknown-shaped rag row as "other" activity and tolerates a bad timestamp', () => {
    const html = render({
      rag: [{}], // no kind → "other"
      stageEvidence: [
        { kind: 'open', ts: AT },
        mk('stage_start', 'planning', 'not-a-real-date'),
        mk('stage_end', 'planning', 'also-bad', { artifact_digest: 'a' }),
      ],
    });
    expect(html).toContain('Retrieval activity recorded');
  });

  it('renders every optional field absent without throwing (defensive branches)', () => {
    const html = render(
      {
        plan: {
          summary: 'sparse',
          steps: [{ description: 'no id, no module' }],
          decisions: ['d'],
          risks: [{ description: 'r' }], // no mitigation
        },
        specification: {
          behaviour: ['b'],
          acceptance_criteria: [{}], // no id / given / when / then
          invariants: [{}], // no id / statement / confirmed
          frozen: {}, // present but no frozen_at / signed_off_by
        },
        // called present, but used/fallback absent (their false sides).
        rag: [{ kind: 'called' }],
        aiBom: { components: [{}] }, // component with no name / no hashes
        delivery: { commits: [{}] }, // no branch/base/merge; commit with no sha/subject
        stageEvidence: [
          { kind: 'open', ts: AT }, // stage_end with no adapter handled below
          { kind: 'stage_end', stage: 'planning', ts: AT }, // no adapter, no artifact → inconclusive
        ],
      },
      'not-a-valid-feature-dir', // unparseable dir → no issue/ULID in header
    );
    expect(html).toContain('no given/when/then recorded');
    expect(html).toContain('Mitigation: —');
    expect(html).not.toContain('Issue #');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('summarises retrieval with used+refreshed but no called/fallback', () => {
    const html = render({ rag: [{ kind: 'used' }, { kind: 'refreshed' }] });
    expect(html).toMatch(/delivered context/i);
    expect(html).toContain('refreshed the index');
  });

  it('pluralises retrieval counts when a kind occurs more than once', () => {
    const html = render({
      rag: [
        { kind: 'called' },
        { kind: 'called' },
        { kind: 'used' },
        { kind: 'used' },
        { kind: 'fallback' },
        { kind: 'fallback' },
        { kind: 'refreshed' },
        { kind: 'refreshed' },
      ],
    });
    expect(html).toContain('2 times');
  });
});

describe('renderFeatureReportHtml — determinism (AC-9)', () => {
  it('is byte-identical for the same inputs and uses colon-free posix paths', () => {
    const b = fullBundle();
    const a1 = renderFeatureReportHtml(b, fold(completeStageRows()), { generatedAt: AT });
    const a2 = renderFeatureReportHtml(b, fold(completeStageRows()), { generatedAt: AT });
    expect(a1).toBe(a2);
    const path = featureReportPath(DIR);
    expect(path).toBe(`.paqad/ledger/feature-evidence/${DIR}/report.html`);
    expect(path.includes(':')).toBe(false);
    expect(path.includes('\\')).toBe(false);
  });
});
