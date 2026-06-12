import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildEvidencePacket } from '@/dashboard/export-packet.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { projectReceipt } from '@/evidence/receipt/project.js';

function write(root: string, relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('buildEvidencePacket', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-export-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('renders an empty-state packet on a bare project', () => {
    const packet = buildEvidencePacket(root);
    expect(packet.json.evidence.rows).toEqual([]);
    expect(packet.json.receipts.receipts).toEqual([]);
    expect(packet.json.aiBom).toBeNull();
    expect(packet.markdown).toContain('No receipts yet');
    expect(packet.html).toContain('<!doctype html>');
    expect(packet.html).toContain('No gate runs recorded yet.');
    expect(packet.html).not.toContain('<script');
  });

  it('includes evidence rows, a project title, and escapes html', () => {
    write(
      root,
      '.paqad/ledger/evidence.jsonl',
      `${JSON.stringify({
        ts: '2026-06-12T00:00:00Z',
        engine: 'vitest',
        code: 'tests<script>',
        subject_digest: 'sha256:abc',
        verdict: 'pass',
        strength_class: 'strong',
        content_hash: 'sha256:def',
      })}\n`,
    );

    const packet = buildEvidencePacket(root, { projectName: 'Demo & Co' });
    expect(packet.projectName).toBe('Demo & Co');
    expect(packet.html).toContain('Demo &amp; Co');
    expect(packet.html).toContain('tests&lt;script&gt;');
    expect(packet.html).not.toContain('tests<script>');
    expect(packet.markdown).toContain('PASS tests<script>');
  });

  it('renders sealed receipts with authorship in both forms', async () => {
    await projectReceipt({
      projectRoot: root,
      fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
      rows: [
        buildEvidenceRow({
          ts: '2026-06-11T00:00:00.000Z',
          engine: 'verification-gate',
          code: 'spec-review',
          subject_digest: 'subject-1',
          verdict: 'pass',
          strength_class: 'deterministic',
        }),
      ],
      verifierVersion: '1.0.0',
      timeVerified: '2026-06-11T00:00:00.000Z',
    });

    const packet = buildEvidencePacket(root);
    expect(packet.json.receipts.receipts).toHaveLength(1);
    expect(packet.markdown).toContain('Sealed');
    expect(packet.markdown).toContain('1 checks, result PASSED');
    expect(packet.html).toContain('sealed');
    expect(packet.html).not.toContain('No receipts yet');
  });
});
