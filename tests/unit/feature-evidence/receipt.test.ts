import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EVIDENCE_LEDGER_SCHEMA_VERSION } from '@/core/types/evidence-ledger.js';
import type { EvidenceFileDigest, EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import { appendFeatureEvidenceRows } from '@/feature-evidence/bundle-ledgers.js';
import {
  latestFeatureReceipt,
  projectAiBomFromFeatures,
  projectFeatureAiBom,
  projectFeatureReceipt,
  readAllFeatureReceiptEntries,
  readAllFeatureReceipts,
  readFeatureAiBom,
  readFeatureReceipt,
  readReceiptEvidenceRows,
  receiptEvidenceRows,
  splitReceiptEvidenceRows,
  sealFeatureEvidence,
  specificationReceiptLine,
  verifyEvidenceSeal,
} from '@/feature-evidence/receipt.js';
import { signReceipt, verifyReceiptSeal } from '@/evidence/receipt/dsse.js';
import { buildInTotoStatement } from '@/evidence/receipt/statement.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { decodeReceiptStatement } from '@/evidence/receipt/project.js';
import { fromAiBomProperties } from '@/feature-evidence/envelope.js';
import { validateEnvelopeHeader } from '@/feature-evidence/schema.js';

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

// Issue #547 — the end-of-change receipt's specification line (FR-12.3 / AC-18).
describe('the receipt seals evidence.jsonl instead of copying rows (#581)', () => {
  function openWithEvidence(rows: EvidenceLedgerRow[]): { root: string; dir: string } {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
    });
    appendFeatureEvidenceRows(root, 'ses_1', rows);
    return { root, dir };
  }

  it('seals the file bytes and line count, and carries no rows', () => {
    const { root, dir } = openWithEvidence(INPUT.rows);
    const { envelope } = projectFeatureReceipt(root, dir, INPUT);
    const predicate = decodeReceiptStatement(envelope)!.predicate;
    expect(predicate.rows).toBeUndefined();
    expect(predicate.evidence_line_count).toBe(2);
    const bytes = readFileSync(join(root, featureFilePath(dir, 'evidence')), 'utf8');
    expect(predicate.evidence_sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    // Graded counts and the verdict still come from the rows.
    expect(predicate.graded_results.deterministic.pass).toBe(2);
    expect(predicate.verification_result).toBe('PASSED');
    expect(verifyReceiptSeal(envelope)).toBe(true);
  });

  it('keeps verifying after later rows are appended, and fails once a sealed line changes', () => {
    const { root, dir } = openWithEvidence(INPUT.rows);
    const { envelope } = projectFeatureReceipt(root, dir, INPUT);
    const statement = decodeReceiptStatement(envelope)!;
    appendFeatureEvidenceRows(root, 'ses_1', [row('bundle-completeness', 'skipped')]);
    expect(verifyEvidenceSeal(root, dir, statement)).toBe(true);
    const path = join(root, featureFilePath(dir, 'evidence'));
    writeFileSync(path, readFileSync(path, 'utf8').replace('"pass"', '"fail"'));
    expect(verifyEvidenceSeal(root, dir, statement)).toBe(false);
  });

  it('fails the seal when sealed lines went missing', () => {
    const { root, dir } = openWithEvidence(INPUT.rows);
    const statement = decodeReceiptStatement(projectFeatureReceipt(root, dir, INPUT).envelope)!;
    writeFileSync(join(root, featureFilePath(dir, 'evidence')), 'only one line\n');
    expect(verifyEvidenceSeal(root, dir, statement)).toBe(false);
  });

  it('seals an absent file as zero lines and leaves a partial trailing line out', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
    });
    expect(sealFeatureEvidence(root, dir)).toEqual({
      sha256: createHash('sha256').update('').digest('hex'),
      line_count: 0,
    });
    const path = join(root, featureFilePath(dir, 'evidence'));
    appendFeatureEvidenceRows(root, 'ses_1', [row('format', 'pass')]);
    const whole = readFileSync(path, 'utf8');
    appendFileSync(path, '{"partial');
    expect(sealFeatureEvidence(root, dir)).toEqual({
      sha256: createHash('sha256').update(whole).digest('hex'),
      line_count: 1,
    });
  });

  it('an old receipt that carries its rows still verifies and reads its own rows', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
    });
    const statement = buildInTotoStatement(INPUT);
    const envelope = signReceipt({ statement, mode: 'hash-chained' });
    writeFileSync(join(root, featureFilePath(dir, 'receipt')), JSON.stringify(envelope));
    const read = readFeatureReceipt(root, dir)!;
    expect(verifyReceiptSeal(read)).toBe(true);
    const decoded = decodeReceiptStatement(read)!;
    expect(verifyEvidenceSeal(root, dir, decoded)).toBeNull();
    expect(receiptEvidenceRows(decoded, [row('ignored', 'fail')]).map((r) => r.code)).toEqual([
      'format',
      'tests',
    ]);
  });

  it("reads a sealing receipt's rows from evidence.jsonl, that run only", () => {
    const statement = buildInTotoStatement({
      ...INPUT,
      evidenceSeal: { sha256: 'x', line_count: 3 },
    });
    const earlier = { ...row('format', 'fail'), ts: '2026-07-09T00:00:00.000Z' };
    const late = row('rules-loaded', 'pass');
    const rows = receiptEvidenceRows(statement, [earlier, ...INPUT.rows, late]);
    // The late gate sits past the sealed lines: shown as unsealed, never as the receipt's.
    expect(rows.map((r) => r.code)).toEqual(['format', 'tests']);
    const split = splitReceiptEvidenceRows(statement, [earlier, ...INPUT.rows, late]);
    expect(split.unsealed.map((r) => r.code)).toEqual(['rules-loaded']);
  });

  it('splits an old receipt as all sealed, and a statement with no seal as all unsealed', () => {
    const carried = buildInTotoStatement(INPUT);
    expect(splitReceiptEvidenceRows(carried, [row('x', 'fail')])).toEqual({
      sealed: INPUT.rows,
      unsealed: [],
    });
    const bare = buildInTotoStatement(INPUT);
    delete (bare.predicate as { rows?: unknown }).rows;
    expect(splitReceiptEvidenceRows(bare, INPUT.rows)).toEqual({
      sealed: [],
      unsealed: INPUT.rows,
    });
  });

  it('reads the sealed and the later rows straight from the bundle file', () => {
    const { root, dir } = openWithEvidence(INPUT.rows);
    const { envelope } = projectFeatureReceipt(root, dir, INPUT);
    const statement = decodeReceiptStatement(envelope)!;
    const late = row('rules-loaded', 'fail');
    appendFeatureEvidenceRows(root, 'ses_1', [late]);
    const split = readReceiptEvidenceRows(root, dir, statement);
    expect(split.sealed.map((r) => r.code)).toEqual(['format', 'tests']);
    expect(split.unsealed.map((r) => r.code)).toEqual(['rules-loaded']);
    // The late fail is not the receipt's evidence, so the whole-project AI-BOM stays PASSED.
    const whole = projectAiBomFromFeatures(root, '1.52.0', INPUT.timeVerified)!;
    expect(JSON.stringify(whole)).toContain('"paqad:verification:result","value":"PASSED"');
  });

  it('counts only readable rows in the sealed lines, and seals nothing once lines are lost', () => {
    const { root, dir } = openWithEvidence([]);
    const path = join(root, featureFilePath(dir, 'evidence'));
    const [format, tests] = INPUT.rows.map((r) => JSON.stringify(r));
    writeFileSync(path, `${format}\nnot json\n${tests}\n`, 'utf8');
    const { envelope } = projectFeatureReceipt(root, dir, INPUT);
    const statement = decodeReceiptStatement(envelope)!;
    expect(statement.predicate.evidence_line_count).toBe(3);
    appendFileSync(path, `${JSON.stringify(row('late', 'pass'))}\n`, 'utf8');
    const split = readReceiptEvidenceRows(root, dir, statement);
    expect(split.sealed.map((r) => r.code)).toEqual(['format', 'tests']);
    expect(split.unsealed.map((r) => r.code)).toEqual(['late']);

    writeFileSync(path, `${format}\n`, 'utf8');
    const lost = readReceiptEvidenceRows(root, dir, statement);
    expect(lost).toEqual({ sealed: [], unsealed: [expect.objectContaining({ code: 'format' })] });

    const bare = { ...statement, predicate: { ...statement.predicate } };
    delete (bare.predicate as { evidence_line_count?: number }).evidence_line_count;
    expect(readReceiptEvidenceRows(root, dir, bare).sealed).toEqual([]);
  });

  it('lists receipts with the bundle they came from', () => {
    const { root, dir } = openWithEvidence(INPUT.rows);
    projectFeatureReceipt(root, dir, INPUT);
    expect(readAllFeatureReceiptEntries(root).map((entry) => entry.dirName)).toEqual([dir]);
  });

  it('the whole-project AI-BOM unions a sealing receipt from its evidence.jsonl rows', () => {
    const { root, dir } = openWithEvidence([row('tests', 'fail')]);
    projectFeatureReceipt(root, dir, { ...INPUT, rows: [row('tests', 'fail')] });
    const whole = projectAiBomFromFeatures(root, '1.52.0', INPUT.timeVerified)!;
    expect(JSON.stringify(whole)).toContain('"paqad:verification:result","value":"FAILED"');
  });
});

// Issue #581 (FR-5) — each standard format carries the one header in the slot it allows.
describe('receipt.json and ai-bom.json carry the envelope header (#581)', () => {
  function open(): { root: string; dir: string } {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_owner', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
    });
    return { root, dir };
  }

  it('puts the header first in the receipt paqad block, outside the signed payload', () => {
    const { root, dir } = open();
    const { envelope } = projectFeatureReceipt(root, dir, { ...INPUT, sessionId: 'ses_run' });
    const block = readFeatureReceipt(root, dir)!.paqad;
    expect(Object.keys(block)).toEqual([
      'schema_version',
      'doc_type',
      'change',
      'session_id',
      'recorded_at',
      'content_hash',
      'signing_mode',
      'prev_receipt_hash',
      'receipt_hash',
    ]);
    expect(block).toMatchObject({
      schema_version: 2,
      doc_type: 'paqad.receipt',
      change: dir.slice(-26),
      session_id: 'ses_run',
      recorded_at: INPUT.timeVerified,
      content_hash: envelope.paqad.receipt_hash,
    });
    // The header sits outside the payload, so the seal still verifies and time_verified
    // stays inside the signed statement.
    expect(verifyReceiptSeal(readFeatureReceipt(root, dir)!)).toBe(true);
    expect(decodeReceiptStatement(envelope)!.predicate.time_verified).toBe(INPUT.timeVerified);
    expect(validateEnvelopeHeader(block)).toEqual([]);
  });

  it('chains a second receipt to the first even with the header in the block', () => {
    const { root, dir } = open();
    const first = projectFeatureReceipt(root, dir, INPUT).envelope;
    const second = projectFeatureReceipt(root, dir, INPUT).envelope;
    expect(second.paqad.prev_receipt_hash).toBe(first.paqad.receipt_hash);
    // No session given: the session that opened the change.
    expect(second.paqad.session_id).toBe('ses_owner');
  });

  it('puts the header first in the AI-BOM metadata.properties as paqad:<field>', () => {
    const { root, dir } = open();
    const { aiBom } = projectFeatureReceipt(root, dir, INPUT);
    const header = fromAiBomProperties(readFeatureAiBom(root, dir)!.metadata.properties);
    expect(header).toMatchObject({
      schema_version: 2,
      doc_type: 'paqad.ai-bom',
      change: dir.slice(-26),
      session_id: 'ses_owner',
      recorded_at: INPUT.timeVerified,
    });
    expect(aiBom.metadata.properties[0]!.name).toBe('paqad:schema_version');
    // The top-level evidence properties are untouched.
    expect(aiBom.properties[0]!.name).toBe('paqad:verification:result');
    expect(validateEnvelopeHeader(header)).toEqual([]);
    const ai = projectFeatureAiBom(root, dir, { ...INPUT, sessionId: 'ses_bom' });
    expect(fromAiBomProperties(ai.metadata.properties)!.session_id).toBe('ses_bom');
  });
});

describe('specificationReceiptLine', () => {
  it('renders a pipeline-produced line with experts and conflicts', () => {
    expect(
      specificationReceiptLine({
        pipeline_produced: true,
        experts: {
          roles: ['db-expert', 'security-auditor', 'qa-engineer'],
          accepted: 2,
          declined: 0,
          conflicts: 2,
        },
      }),
    ).toBe(
      '🟢 specification: pipeline-produced, experts: db-expert, security-auditor, qa-engineer (2 conflicts decided)',
    );
  });

  it('renders pipeline-produced without experts', () => {
    expect(specificationReceiptLine({ pipeline_produced: true })).toBe(
      '🟢 specification: pipeline-produced',
    );
  });

  it('names the experts and pluralizes decided conflicts', () => {
    expect(
      specificationReceiptLine({
        pipeline_produced: true,
        experts: { roles: ['db', 'security'], accepted: 2, declined: 0, conflicts: 2 },
      }),
    ).toBe('🟢 specification: pipeline-produced, experts: db, security (2 conflicts decided)');
  });

  it('uses the singular for exactly one decided conflict', () => {
    expect(
      specificationReceiptLine({
        pipeline_produced: true,
        experts: { roles: ['db'], accepted: 1, declined: 0, conflicts: 1 },
      }),
    ).toBe('🟢 specification: pipeline-produced, experts: db (1 conflict decided)');
  });

  it('names the experts with no conflict suffix when none were decided', () => {
    expect(
      specificationReceiptLine({
        pipeline_produced: true,
        experts: { roles: ['ui'], accepted: 1, declined: 0, conflicts: 0 },
      }),
    ).toBe('🟢 specification: pipeline-produced, experts: ui');
  });

  it('renders a manual-reason line', () => {
    expect(specificationReceiptLine({ pipeline_produced: false, manual_reason: 'hotfix' })).toBe(
      '🟡 specification: frozen without the pipeline (reason: hotfix)',
    );
  });

  it('renders a plain warn line without a reason', () => {
    expect(specificationReceiptLine({ pipeline_produced: false })).toBe(
      '🟡 specification: frozen without the pipeline',
    );
  });

  it('reads the pipeline section of a record frozen since #581', () => {
    expect(specificationReceiptLine({ produced: true })).toBe(
      '🟢 specification: pipeline-produced',
    );
    expect(specificationReceiptLine({ produced: false, manual_reason: 'hotfix' })).toBe(
      '🟡 specification: frozen without the pipeline (reason: hotfix)',
    );
  });

  it("renders today's line when provenance is absent", () => {
    expect(specificationReceiptLine()).toBe('🟢 specification: recorded');
  });
});
