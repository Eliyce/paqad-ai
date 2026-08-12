import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EVIDENCE_LEDGER_SCHEMA_VERSION } from '@/core/types/evidence-ledger.js';
import type { EvidenceFileDigest, EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import {
  latestFeatureReceipt,
  projectAiBomFromFeatures,
  projectFeatureAiBom,
  projectFeatureReceipt,
  readAllFeatureReceipts,
  readFeatureAiBom,
  readFeatureReceipt,
} from '@/feature-evidence/receipt.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { decodeReceiptStatement } from '@/evidence/receipt/project.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-receipt-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function row(code: string, verdict: EvidenceLedgerRow['verdict']): EvidenceLedgerRow {
  return {
    schema_version: EVIDENCE_LEDGER_SCHEMA_VERSION,
    ts: '2026-07-10T00:00:00.000Z',
    engine: 'verification-gate',
    code,
    subject_digest: 'a'.repeat(64),
    verdict,
    strength_class: 'deterministic',
    content_hash: `${code}-${verdict}`,
  };
}

const DIGESTS: EvidenceFileDigest[] = [{ name: 'src/app.ts', sha256: 'b'.repeat(64) }];
const INPUT = {
  fileDigests: DIGESTS,
  rows: [row('format', 'pass'), row('tests', 'pass')],
  verifierVersion: '1.52.0',
  timeVerified: '2026-07-10T00:00:00.000Z',
};

describe('per-feature receipt + ai-bom projection (#343 B)', () => {
  it('writes a signed receipt.json and ai-bom.json into the feature bundle from its own rows', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
    });

    const result = projectFeatureReceipt(root, dir, INPUT);

    expect(existsSync(join(root, featureFilePath(dir, 'receipt')))).toBe(true);
    expect(existsSync(join(root, featureFilePath(dir, 'aiBom')))).toBe(true);
    // The signed receipt round-trips and carries a chain hash.
    const receipt = readFeatureReceipt(root, dir)!;
    expect(receipt.paqad.receipt_hash).toEqual(result.envelope.paqad.receipt_hash);
    // The AI-BOM is the CycloneDX view of the same subject.
    const aiBom = readFeatureAiBom(root, dir)!;
    expect(JSON.stringify(aiBom)).toContain('src/app.ts');
  });

  it('carries the change-shape metrics block into the receipt predicate (#362)', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
    });

    projectFeatureReceipt(root, dir, {
      ...INPUT,
      metrics: { dup_new_pct: 0, reuse_rate: 4.2, meaningful_changed_lines: 120 },
    });

    const statement = decodeReceiptStatement(readFeatureReceipt(root, dir)!)!;
    expect(statement.predicate.metrics).toEqual({
      dup_new_pct: 0,
      reuse_rate: 4.2,
      meaningful_changed_lines: 120,
    });
  });

  it("hash-chains a re-projected receipt to the feature's OWN prior receipt", () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
    });
    const first = projectFeatureReceipt(root, dir, INPUT);
    const second = projectFeatureReceipt(root, dir, INPUT);
    // The second receipt embeds the first's hash as its previous link (a self-contained chain).
    expect(second.envelope.paqad.prev_receipt_hash).toBe(first.envelope.paqad.receipt_hash);
  });

  it('projectFeatureAiBom writes ai-bom.json alone (for an ai-bom-only enterprise flag)', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
    });
    projectFeatureAiBom(root, dir, INPUT);
    expect(existsSync(join(root, featureFilePath(dir, 'aiBom')))).toBe(true);
    // No receipt was written on the ai-bom-only path.
    expect(existsSync(join(root, featureFilePath(dir, 'receipt')))).toBe(false);
  });

  it('honours write gating: receipt-only writes receipt.json but not ai-bom.json', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
    });
    projectFeatureReceipt(root, dir, { ...INPUT, write: { receipt: true, aiBom: false } });
    expect(existsSync(join(root, featureFilePath(dir, 'receipt')))).toBe(true);
    expect(existsSync(join(root, featureFilePath(dir, 'aiBom')))).toBe(false);
  });

  it('projects a whole-project AI-BOM from the UNION of every feature receipt', () => {
    const root = tempRoot();
    const a = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', title: 'A', issue: null });
    projectFeatureReceipt(root, a, {
      ...INPUT,
      fileDigests: [{ name: 'src/a.ts', sha256: 'a'.repeat(64) }],
      rows: [row('format', 'pass')],
    });
    const b = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', title: 'B', issue: null });
    projectFeatureReceipt(root, b, {
      ...INPUT,
      fileDigests: [{ name: 'src/b.ts', sha256: 'c'.repeat(64) }],
      rows: [row('tests', 'fail')],
    });

    const whole = projectAiBomFromFeatures(root, '1.52.0', '2026-07-10T00:00:00.000Z')!;
    const json = JSON.stringify(whole);
    // Both features' file subjects appear in the unioned AI-BOM.
    expect(json).toContain('src/a.ts');
    expect(json).toContain('src/b.ts');
  });

  it('returns null when no feature carries a receipt', () => {
    const root = tempRoot();
    openFeatureChange(root, 'ses_1', { adapter: 'claude-code', title: 'A', issue: null });
    expect(projectAiBomFromFeatures(root, '1.52.0', '2026-07-10T00:00:00.000Z')).toBeNull();
  });

  describe('#468 Phase B — bundle receipt union + latest', () => {
    it('unions every feature receipt and skips dirs with none', () => {
      const root = tempRoot();
      const a = openFeatureChange(root, 'ses_1', {
        adapter: 'claude-code',
        title: 'A',
        issue: null,
      });
      projectFeatureReceipt(root, a, INPUT);
      // A second feature dir exists (opened) but never projected a receipt → skipped.
      openFeatureChange(root, 'ses_1', { adapter: 'claude-code', title: 'B', issue: null });
      const receipts = readAllFeatureReceipts(root);
      expect(receipts).toHaveLength(1);
      expect(receipts[0].paqad.receipt_hash).toEqual(
        readFeatureReceipt(root, a)!.paqad.receipt_hash,
      );
    });

    it('latestFeatureReceipt picks the max time_verified across bundles', () => {
      const root = tempRoot();
      const a = openFeatureChange(root, 'ses_1', {
        adapter: 'claude-code',
        title: 'A',
        issue: null,
      });
      projectFeatureReceipt(root, a, { ...INPUT, timeVerified: '2026-07-10T00:00:00.000Z' });
      const b = openFeatureChange(root, 'ses_1', {
        adapter: 'claude-code',
        title: 'B',
        issue: null,
      });
      projectFeatureReceipt(root, b, { ...INPUT, timeVerified: '2026-07-11T00:00:00.000Z' });

      const latest = latestFeatureReceipt(root)!;
      expect(decodeReceiptStatement(latest)!.predicate.time_verified).toBe(
        '2026-07-11T00:00:00.000Z',
      );
    });

    it('returns null latest when no bundle carries a receipt', () => {
      const root = tempRoot();
      expect(latestFeatureReceipt(root)).toBeNull();
    });

    it('carries authorship / compliance / reproducibility into the predicate (#468 FR-7)', () => {
      const root = tempRoot();
      const dir = openFeatureChange(root, 'ses_1', {
        adapter: 'claude-code',
        title: 'A',
        issue: null,
      });
      projectFeatureReceipt(root, dir, {
        ...INPUT,
        authorship: {
          agent: 'claude-code',
          model_id: 'anthropic/claude-opus-4-8',
          provenance: 'declared',
        },
        complianceCitations: [
          {
            framework_id: 'eu-ai-act',
            framework_title: 'EU AI Act',
            clause_id: 'Art.15',
            clause_title: 'Robustness',
            gate: 'tests',
            relation: 'subset-of',
            evidence_strength: 'partial',
            disclaimer: 'Evidence toward, not compliance.',
          },
        ],
        reproducibility: {
          context_hash: 'deadbeef',
          determinism: 'input-replay',
          algo_version: 1,
          replayable: true,
        },
      });
      const predicate = decodeReceiptStatement(readFeatureReceipt(root, dir)!)!.predicate;
      expect(predicate.change_authorship?.model_id).toBe('anthropic/claude-opus-4-8');
      expect(predicate.compliance_citations?.[0].clause_id).toBe('Art.15');
      expect(predicate.reproducibility?.context_hash).toBe('deadbeef');
    });
  });
});
