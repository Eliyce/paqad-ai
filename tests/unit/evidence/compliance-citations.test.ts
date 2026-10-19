import { resolveComplianceCitations } from '@/evidence/compliance/citations.js';
import { gateResultsToRows } from '@/evidence/fan-in.js';
import { MutationTestingGate } from '@/verification/gates/mutation-testing.js';

import { createVerificationContext } from '../verification/shared.fixture.js';
import {
  EVIDENCE_LEDGER_SCHEMA_VERSION,
  type EvidenceLedgerRow,
} from '@/core/types/evidence-ledger.js';
import type { LoadedCompliancePack } from '@/core/types/pack.js';

function gateRow(code: string, verdict: EvidenceLedgerRow['verdict']): EvidenceLedgerRow {
  return {
    schema_version: EVIDENCE_LEDGER_SCHEMA_VERSION,
    ts: '2026-06-12T00:00:00.000Z',
    engine: 'verification-gate',
    code,
    subject_digest: 'abc',
    verdict,
    strength_class: verdict === 'pass' ? 'deterministic' : 'blocked',
    content_hash: code + verdict,
  };
}

function pack(
  name: string,
  framework: { id: string; title: string },
  mappings: LoadedCompliancePack['manifest']['mappings'],
): LoadedCompliancePack {
  return {
    manifest: {
      kind: 'compliance-pack',
      name,
      framework,
      disclaimer: 'evidence toward only',
      mappings,
    },
    root: '/x',
    manifestPath: '/x/compliance-pack.yaml',
    source: 'built-in',
    validation: { valid: true, issues: [] },
  };
}

const ART15 = pack('eu-ai-act', { id: 'eu-ai-act', title: 'EU AI Act' }, [
  {
    clause: { id: 'Art.15', title: 'Robustness', url: 'https://example/15' },
    satisfied_by: [
      { type: 'gate', ref: 'behavioral-correctness', relation: 'subset-of' },
      { type: 'gate', ref: 'mutation-testing', relation: 'subset-of' },
    ],
    evidence_strength: 'partial',
  },
]);

describe('resolveComplianceCitations', () => {
  it('cites a clause only when every gate it depends on passed', () => {
    const rows = [gateRow('behavioral-correctness', 'pass'), gateRow('mutation-testing', 'pass')];
    const citations = resolveComplianceCitations({ projectRoot: '/x', rows, packs: [ART15] });
    expect(citations).toHaveLength(2);
    expect(citations.map((c) => c.gate).sort()).toEqual([
      'behavioral-correctness',
      'mutation-testing',
    ]);
    expect(citations[0]?.clause_id).toBe('Art.15');
    expect(citations[0]?.evidence_strength).toBe('partial');
    expect(citations[0]?.disclaimer).toContain('evidence toward');
  });

  it('does not cite when a required gate is inconclusive or blocked', () => {
    const rows = [
      gateRow('behavioral-correctness', 'pass'),
      gateRow('mutation-testing', 'inconclusive'),
    ];
    const citations = resolveComplianceCitations({ projectRoot: '/x', rows, packs: [ART15] });
    expect(citations).toHaveLength(0);
  });

  it('INV-5: never turns a skipped gate row into a citation (issue #579)', () => {
    const rows = [
      gateRow('behavioral-correctness', 'skipped'),
      gateRow('mutation-testing', 'skipped'),
    ];
    expect(resolveComplianceCitations({ projectRoot: '/x', rows, packs: [ART15] })).toHaveLength(0);
  });

  it('AC-8: never cites a mutation gate that did not run or was not required', async () => {
    const mutation = new MutationTestingGate();
    const behavioural = gateRow('behavioral-correctness', 'pass');
    const ctx = createVerificationContext();
    const off = await mutation.check(ctx);
    const noTool = await mutation.check({
      ...ctx,
      mutation_result: {
        tool: null,
        language: 'typescript',
        confidence: 'mature',
        scoped_files: [],
        total_mutants: 0,
        killed: 0,
        survived: 0,
        equivalent_set_aside: 0,
        kill_rate: null,
        surviving_mutants: [],
        tree_clean: true,
        status: 'skipped',
        skipped_reason: 'tool-not-configured',
      },
    });
    for (const result of [off, noTool]) {
      const rows = [behavioural, ...gateResultsToRows([result], { subjectDigest: 'abc', ts: 't' })];
      expect(rows[1]?.verdict).toBe('skipped');
      expect(resolveComplianceCitations({ projectRoot: '/x', rows, packs: [ART15] })).toEqual([]);
    }
  });

  it('does not cite a failed gate', () => {
    const rows = [gateRow('behavioral-correctness', 'fail'), gateRow('mutation-testing', 'fail')];
    expect(resolveComplianceCitations({ projectRoot: '/x', rows, packs: [ART15] })).toHaveLength(0);
  });

  it('fans one passing gate out across multiple frameworks', () => {
    const nist = pack('nist-ssdf', { id: 'nist-ssdf', title: 'NIST SSDF' }, [
      {
        clause: { id: 'PW.7', title: 'Review code' },
        satisfied_by: [
          { type: 'gate', ref: 'behavioral-correctness', relation: 'intersects-with' },
        ],
        evidence_strength: 'partial',
      },
    ]);
    const rows = [gateRow('behavioral-correctness', 'pass'), gateRow('mutation-testing', 'pass')];
    const citations = resolveComplianceCitations({ projectRoot: '/x', rows, packs: [ART15, nist] });
    const frameworks = new Set(citations.map((c) => c.framework_id));
    expect(frameworks).toEqual(new Set(['eu-ai-act', 'nist-ssdf']));
  });

  it('returns [] when no packs are active (field omitted)', () => {
    const rows = [gateRow('behavioral-correctness', 'pass')];
    expect(resolveComplianceCitations({ projectRoot: '/x', rows, packs: [] })).toEqual([]);
  });
});
