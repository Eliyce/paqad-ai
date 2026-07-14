import { describe, expect, it } from 'vitest';

import {
  builtinSecretScan,
  gatherStaleDocCandidates,
  parseGitleaksJson,
  parseJscpdJson,
  parseNpmAuditJson,
  parseOsvScannerJson,
} from '@/codebase-health/gather.js';

describe('parseOsvScannerJson', () => {
  it('flattens results→packages→vulnerabilities and defaults missing fields', () => {
    const raw = JSON.stringify({
      results: [
        {
          packages: [
            {
              package: { name: 'left-pad', version: '1.0.0', ecosystem: 'npm' },
              vulnerabilities: [{ id: 'GHSA-1', summary: 's', details: 'd' }],
            },
            { vulnerabilities: [{}] },
          ],
        },
      ],
    });
    const records = parseOsvScannerJson(raw);
    expect(records[0]).toMatchObject({ package_name: 'left-pad', advisory_id: 'GHSA-1' });
    expect(records[1]).toMatchObject({ package_name: 'unknown', advisory_id: 'UNKNOWN' });
  });

  it('returns [] on malformed or empty input', () => {
    expect(parseOsvScannerJson('not json')).toEqual([]);
    expect(parseOsvScannerJson('{}')).toEqual([]);
  });
});

describe('parseNpmAuditJson', () => {
  it('extracts the object via-entry and skips string-only vias', () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        'left-pad': { name: 'left-pad', via: ['other', { title: 'bad', url: 'https://x/1' }] },
        clean: { name: 'clean', via: ['transitive-only'] },
      },
    });
    const records = parseNpmAuditJson(raw);
    expect(records).toHaveLength(1);
    expect(records[0]!.advisory_id).toBe('https://x/1');
  });

  it('falls back through name and advisory id when fields are missing', () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        anon: { via: [{ title: 'title-only' }] }, // no name, no url → title, then name key
        empty: {}, // no via → skipped
      },
    });
    const records = parseNpmAuditJson(raw);
    expect(records).toHaveLength(1);
    expect(records[0]!.package_name).toBe('anon');
    expect(records[0]!.advisory_id).toBe('title-only');
  });

  it('returns [] on malformed input', () => {
    expect(parseNpmAuditJson('nope')).toEqual([]);
    expect(parseNpmAuditJson('{}')).toEqual([]);
  });
});

describe('parseGitleaksJson', () => {
  it('maps to redacted matches and prefers the gitleaks fingerprint', () => {
    const raw = JSON.stringify([
      { RuleID: 'aws', File: 'a.ts', StartLine: 3, Fingerprint: 'fp', Secret: 'SUPERSECRET' },
      { Secret: 'X' },
    ]);
    const matches = parseGitleaksJson(raw);
    expect(matches[0]).toMatchObject({ file: 'a.ts', line: 3, rule: 'aws', fingerprint: 'fp' });
    expect(JSON.stringify(matches)).not.toContain('SUPERSECRET');
    // Missing fingerprint → hashed, still no bytes.
    expect(matches[1]!.fingerprint).not.toContain('X');
  });

  it('defaults every field and derives a file:line fingerprint when none is given', () => {
    const matches = parseGitleaksJson(JSON.stringify([{}]));
    expect(matches[0]).toMatchObject({ file: 'unknown', line: 0, rule: 'secret' });
    expect(matches[0]!.fingerprint).toBeTruthy();
  });

  it('returns [] when not an array', () => {
    expect(parseGitleaksJson('{}')).toEqual([]);
    expect(parseGitleaksJson('bad')).toEqual([]);
  });
});

describe('parseJscpdJson', () => {
  it('builds clusters from first/second file blocks and drops empty ones', () => {
    const raw = JSON.stringify({
      duplicates: [
        {
          lines: 20,
          firstFile: { name: 'a.ts', start: 1, end: 20 },
          secondFile: { name: 'b.ts', start: 5, end: 24 },
        },
        { lines: 0 },
      ],
    });
    const clusters = parseJscpdJson(raw);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.blocks).toHaveLength(2);
    expect(clusters[0]!.source).toBe('jscpd');
  });

  it('defaults block fields and cluster line count when absent', () => {
    const raw = JSON.stringify({ duplicates: [{ firstFile: {} }] });
    const clusters = parseJscpdJson(raw);
    expect(clusters[0]!.lines).toBe(0);
    expect(clusters[0]!.blocks[0]).toEqual({ file: 'unknown', start_line: 0, end_line: 0 });
  });

  it('returns [] on malformed input', () => {
    expect(parseJscpdJson('x')).toEqual([]);
    expect(parseJscpdJson('{}')).toEqual([]);
  });
});

describe('builtinSecretScan', () => {
  it('matches each pattern and stores only a fingerprint (never the bytes)', () => {
    const files = [
      { path: 'a.ts', content: '-----BEGIN PRIVATE KEY-----' },
      { path: 'b.ts', content: 'const k = "AKIAIOSFODNN7EXAMPLE"' },
      { path: 'c.ts', content: 'api_key: "abcdef0123456789abcdef"' },
      { path: 'd.ts', content: 'Authorization: Bearer abcdefghij0123456789KLMNOP' },
      { path: 'e.ts', content: 'nothing to see here' },
    ];
    const matches = builtinSecretScan(files);
    expect(matches.map((m) => m.rule)).toEqual(
      expect.arrayContaining(['private-key', 'aws-access-key', 'generic-api-key', 'bearer-token']),
    );
    expect(matches.every((m) => m.source === 'builtin-regex')).toBe(true);
    expect(JSON.stringify(matches)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(matches.find((m) => m.file === 'e.ts')).toBeUndefined();
  });
});

describe('gatherStaleDocCandidates', () => {
  it('flags a doc older than a referenced source and skips untracked/no-reference docs', () => {
    const candidates = gatherStaleDocCandidates([
      {
        doc: 'docs/a.md',
        doc_committed_at: 100,
        references: [{ source: 'src/a.ts', committed_at: 200 }],
      },
      {
        doc: 'docs/fresh.md',
        doc_committed_at: 300,
        references: [{ source: 'src/b.ts', committed_at: 200 }],
      },
      {
        doc: 'docs/untracked.md',
        doc_committed_at: null,
        references: [{ source: 'src/c.ts', committed_at: 200 }],
      },
      { doc: 'docs/no-ref.md', doc_committed_at: 100, references: [] },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.doc).toBe('docs/a.md');
    expect(candidates[0]!.referenced_sources).toEqual(['src/a.ts']);
  });
});
