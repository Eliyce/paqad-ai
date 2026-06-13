import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildModuleSnapshot, buildReceiptSnapshot } from '@/dashboard/snapshot.js';
import { buildReceiptFeed } from '@/dashboard/trust.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { projectReceipt } from '@/evidence/receipt/project.js';

describe('dashboard snapshots (#161)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-snapshot-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeHealth(slug: string, body: unknown): void {
    mkdirSync(join(root, '.paqad/module-health'), { recursive: true });
    writeFileSync(join(root, `.paqad/module-health/${slug}.json`), JSON.stringify(body));
  }

  describe('buildModuleSnapshot', () => {
    it('renders a healthy module with metrics and an updated stamp', () => {
      writeHealth('payments', {
        module: 'payments',
        tier: 'green',
        metrics: { coverage_pct: 80, defect_frequency: null },
        updated_at: '2026-06-01T00:00:00.000Z',
      });
      const html = buildModuleSnapshot(root, 'module:payments');
      expect(html).not.toBeNull();
      expect(html).toContain('Module payments');
      expect(html).toContain('health tier: green');
      expect(html).toContain('coverage_pct');
      expect(html).toContain('updated 2026-06-01');
      expect(html).toContain('Static copy, no live data.');
      expect(html).not.toContain('<script');
    });

    it('colours amber and red tiers and tolerates a missing metrics block', () => {
      writeHealth('amber-mod', { module: 'amber-mod', tier: 'amber' });
      writeHealth('red-mod', { module: 'red-mod', tier: 'red', metrics: {} });
      const amber = buildModuleSnapshot(root, 'amber-mod');
      const red = buildModuleSnapshot(root, 'red-mod');
      expect(amber).toContain('#d97706');
      expect(amber).toContain('No metrics recorded.');
      expect(red).toContain('#dc2626');
      expect(red).toContain('No metrics recorded.');
    });

    it('returns null for an unsafe slug, a missing file, and malformed JSON', () => {
      expect(buildModuleSnapshot(root, 'module:../etc/passwd')).toBeNull();
      expect(buildModuleSnapshot(root, 'module:never')).toBeNull();
      writeHealth('broken', {});
      writeFileSync(join(root, '.paqad/module-health/broken.json'), '{ not json');
      expect(buildModuleSnapshot(root, 'broken')).toBeNull();
    });
  });

  describe('buildReceiptSnapshot', () => {
    async function seedReceipt(): Promise<string> {
      await projectReceipt({
        projectRoot: root,
        fileDigests: [{ name: 'src/pay.ts', sha256: 'aaa' }],
        rows: [
          buildEvidenceRow({
            ts: '2026-06-11T00:00:00.000Z',
            engine: 'verification-gate',
            code: 'code-tests-lint',
            subject_digest: 'subject-1',
            verdict: 'pass',
            strength_class: 'deterministic',
          }),
        ],
        verifierVersion: '1.0.0',
        timeVerified: '2026-06-11T00:00:00.000Z',
      });
      return buildReceiptFeed(root).receipts[0]!.receipt_hash;
    }

    it('renders a receipt by full hash and by short-hash prefix', async () => {
      const hash = await seedReceipt();
      const full = buildReceiptSnapshot(root, hash);
      expect(full).not.toBeNull();
      expect(full).toContain('Receipt ' + hash.slice(0, 16));
      expect(full).toContain('Checks');
      expect(full).toContain('code-tests-lint');
      expect(full).toContain('src/pay.ts');
      expect(full).toContain('Static copy, no live data.');
      expect(full).not.toContain('<script');

      const byPrefix = buildReceiptSnapshot(root, hash.slice(0, 10));
      expect(byPrefix).not.toBeNull();
      expect(byPrefix).toContain('Receipt ' + hash.slice(0, 16));
    });

    it('returns null when no receipt matches', () => {
      expect(buildReceiptSnapshot(root, 'deadbeef')).toBeNull();
    });
  });
});
