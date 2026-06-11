import { describe, expect, it } from 'vitest';

import type { EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { buildInTotoStatement } from '@/evidence/receipt/statement.js';
import { buildAiBom } from '@/evidence/receipt/ai-bom.js';

function row(overrides: Partial<EvidenceLedgerRow>): EvidenceLedgerRow {
  return buildEvidenceRow({
    ts: '2026-06-11T00:00:00.000Z',
    engine: 'verification-gate',
    code: 'mutation-testing',
    subject_digest: 'subject-1',
    verdict: 'pass',
    strength_class: 'deterministic',
    ...overrides,
  });
}

const statement = buildInTotoStatement({
  fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
  rows: [
    row({ strength_class: 'deterministic', verdict: 'pass' }),
    row({ strength_class: 'llm-judged', verdict: 'pass', code: 'spec-review' }),
  ],
  verifierVersion: '1.2.3',
  timeVerified: '2026-06-11T00:00:00.000Z',
});

describe('buildAiBom', () => {
  it('is CycloneDX-shaped with changed files as file components', () => {
    const bom = buildAiBom({ statement, toolVersion: '1.2.3' });
    expect(bom.bomFormat).toBe('CycloneDX');
    expect(bom.specVersion).toBe('1.6');
    expect(bom.components).toEqual([
      { type: 'file', name: 'src/a.ts', hashes: [{ alg: 'SHA-256', content: 'aaa' }] },
    ]);
    expect(bom.metadata.tools[0]).toMatchObject({ vendor: 'paqad', version: '1.2.3' });
  });

  it('carries the graded correctness evidence CycloneDX omits', () => {
    const bom = buildAiBom({ statement, toolVersion: '1.2.3' });
    const props = Object.fromEntries(bom.properties.map((p) => [p.name, p.value]));
    expect(props['paqad:evidence:deterministic:pass']).toBe('1');
    expect(props['paqad:evidence:llm-judged:pass']).toBe('1');
    expect(props['paqad:verification:result']).toBe('PASSED');
  });

  it('has a deterministic, content-derived serial (replay-stable)', () => {
    const a = buildAiBom({ statement, toolVersion: '1.2.3' });
    const b = buildAiBom({ statement, toolVersion: '1.2.3' });
    expect(a.serialNumber).toBe(b.serialNumber);
    expect(a.serialNumber).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  });

  it('omits authorship properties when the statement carries none', () => {
    const bom = buildAiBom({ statement, toolVersion: '1.2.3' });
    expect(bom.properties.some((p) => p.name.startsWith('paqad:authorship:'))).toBe(false);
  });

  it('flattens change authorship into paqad:authorship:* properties', () => {
    const withAuthor = buildInTotoStatement({
      fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
      rows: [row({})],
      verifierVersion: '1.2.3',
      timeVerified: '2026-06-11T00:00:00.000Z',
      authorship: {
        agent: 'cursor',
        model: 'gpt-5',
        provider: 'openai',
        model_id: 'openai/gpt-5',
        accepting_human: { name: 'Jane', email: 'jane@example.com' },
        provenance: 'declared',
      },
    });
    const bom = buildAiBom({ statement: withAuthor, toolVersion: '1.2.3' });
    const props = Object.fromEntries(bom.properties.map((p) => [p.name, p.value]));
    expect(props['paqad:authorship:agent']).toBe('cursor');
    expect(props['paqad:authorship:model_id']).toBe('openai/gpt-5');
    expect(props['paqad:authorship:accepting_human:email']).toBe('jane@example.com');
    expect(props['paqad:authorship:provenance']).toBe('declared');
  });
});
