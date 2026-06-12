import { resolveComplianceCitations } from '@/evidence/compliance/citations.js';
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
