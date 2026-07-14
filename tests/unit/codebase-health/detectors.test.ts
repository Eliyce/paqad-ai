import { describe, expect, it } from 'vitest';

import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import type { OsvVulnerabilityRecord } from '@/pentest/osv.js';
import {
  detectAiSlop,
  detectDeadCode,
  detectDeprecatedDependencies,
  detectDuplication,
  detectSecrets,
  detectStaleDocs,
  detectUnusedDependencies,
  detectVulnerableDependencies,
} from '@/codebase-health/detectors.js';

function index(overrides: Partial<CodeKnowledgeIndex> = {}): CodeKnowledgeIndex {
  return {
    schema_version: 1,
    header: {
      generated_at: '2026-01-01T00:00:00Z',
      branch: null,
      head_commit: null,
      schema_version: 1,
      entry_point_globs: [],
    },
    symbols: [],
    files: [],
    import_edges: [],
    reference_edges: [],
    dependencies: [],
    ...overrides,
  };
}

describe('detectUnusedDependencies', () => {
  it('flags declared-but-not-imported deps and skips imported ones', () => {
    const findings = detectUnusedDependencies(
      index({
        dependencies: [
          { name: 'used', ecosystem: 'node', imported: true },
          { name: 'unused', ecosystem: 'node', imported: false },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.affected_packages).toEqual(['unused']);
    expect(findings[0]!.confidence).toBe(0.85);
  });

  it('raises confidence and cites knip when corroborated', () => {
    const findings = detectUnusedDependencies(
      index({ dependencies: [{ name: 'unused', ecosystem: 'node', imported: false }] }),
      { unusedDependencies: new Set(['unused']) },
    );
    expect(findings[0]!.confidence).toBe(0.95);
    expect(findings[0]!.evidence.join(' ')).toContain('knip');
  });
});

describe('detectDeadCode', () => {
  it('flags orphan files, orphan exported symbols, and skips covered/live symbols', () => {
    const findings = detectDeadCode(
      index({
        files: [
          { path: 'src/dead.ts', caller_count: 0, orphan: true, entry_point: false },
          { path: 'src/live.ts', caller_count: 3, orphan: false, entry_point: false },
        ],
        symbols: [
          {
            name: 'A',
            kind: 'function',
            file: 'src/dead.ts',
            line: 1,
            signature: 'A()',
            exported: true,
            module_slug: null,
            extraction_tier: 'ast',
            caller_count: 0,
            orphan: true,
          },
          {
            name: 'B',
            kind: 'function',
            file: 'src/live.ts',
            line: 2,
            signature: 'B()',
            exported: true,
            module_slug: null,
            extraction_tier: 'ast',
            caller_count: 0,
            orphan: true,
          },
          {
            name: 'C',
            kind: 'function',
            file: 'src/live.ts',
            line: 3,
            signature: 'C()',
            exported: true,
            module_slug: null,
            extraction_tier: 'ast',
            caller_count: 2,
            orphan: false,
          },
          {
            name: 'D',
            kind: 'function',
            file: 'src/live.ts',
            line: 4,
            signature: 'D()',
            exported: false,
            module_slug: null,
            extraction_tier: 'ast',
            caller_count: 0,
            orphan: true,
          },
        ],
      }),
    );
    const titles = findings.map((f) => f.title);
    expect(titles).toContain('Dead file: src/dead.ts');
    expect(titles).toContain('Unused export: B (src/live.ts)');
    expect(titles.some((t) => t.includes('Unused export: A'))).toBe(false);
    expect(titles.some((t) => t.includes('Unused export: C'))).toBe(false);
    expect(titles.some((t) => t.includes('Unused export: D'))).toBe(false);
  });
});

describe('detectVulnerableDependencies', () => {
  const record = (over: Partial<OsvVulnerabilityRecord> = {}): OsvVulnerabilityRecord => ({
    package_name: 'left-pad',
    ecosystem: 'npm',
    version: '1.0.0',
    advisory_id: 'GHSA-1',
    summary: 'bad',
    details: 'details',
    ...over,
  });

  it('builds high-severity findings and dedupes on package@version:advisory', () => {
    const findings = detectVulnerableDependencies([record(), record()]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('high');
  });

  it('falls back to details when summary is empty', () => {
    const findings = detectVulnerableDependencies([record({ summary: '' })]);
    expect(findings[0]!.evidence[0]).toContain('details');
  });
});

describe('detectDeprecatedDependencies', () => {
  it('labels EOL vs deprecated and marks requires_network', () => {
    const findings = detectDeprecatedDependencies([
      { package: 'a', version: '1', ecosystem: 'npm', message: 'gone', kind: 'eol' },
      { package: 'b', version: '2', ecosystem: 'npm', message: 'old', kind: 'deprecated' },
    ]);
    expect(findings[0]!.title).toContain('End-of-life');
    expect(findings[1]!.title).toContain('Deprecated');
    expect(findings.every((f) => f.requires_network)).toBe(true);
  });
});

describe('detectSecrets', () => {
  it('redacts the secret and grades gitleaks above the builtin scan', () => {
    const findings = detectSecrets([
      { file: 'a.ts', line: 4, rule: 'aws', fingerprint: 'fp1', source: 'gitleaks' },
      { file: 'b.ts', line: 9, rule: 'key', fingerprint: 'fp2', source: 'builtin-regex' },
    ]);
    expect(findings[0]!.confidence).toBe(0.85);
    expect(findings[1]!.confidence).toBe(0.6);
    expect(JSON.stringify(findings)).not.toContain('SECRETVALUE');
    expect(findings[0]!.evidence.join(' ')).toContain('fp1');
    expect(findings[0]!.suggestion.action).toBe('rotate');
  });
});

describe('detectDuplication', () => {
  it('grades jscpd above similarity and lists all block locations', () => {
    const findings = detectDuplication([
      {
        lines: 30,
        source: 'jscpd',
        blocks: [
          { file: 'a.ts', start_line: 1, end_line: 30 },
          { file: 'b.ts', start_line: 5, end_line: 34 },
        ],
      },
      { lines: 12, source: 'similarity', blocks: [{ file: 'c.ts', start_line: 1, end_line: 12 }] },
    ]);
    expect(findings[0]!.confidence).toBe(0.9);
    expect(findings[0]!.affected_files).toEqual(['a.ts', 'b.ts']);
    expect(findings[1]!.confidence).toBe(0.6);
  });
});

describe('detectStaleDocs', () => {
  it('is ai-judged and renders (none detected) when there are no references', () => {
    const findings = detectStaleDocs([{ doc: 'docs/x.md', reason: 'old', referenced_sources: [] }]);
    expect(findings[0]!.tier).toBe('ai-judged');
    expect(findings[0]!.evidence.join(' ')).toContain('(none detected)');
  });

  it('lists referenced sources when present', () => {
    const findings = detectStaleDocs([
      { doc: 'docs/x.md', reason: 'old', referenced_sources: ['src/a.ts'] },
    ]);
    expect(findings[0]!.evidence.join(' ')).toContain('src/a.ts');
  });
});

describe('detectAiSlop', () => {
  it('flags duplication clusters and one-caller wrappers when an index is present', () => {
    const findings = detectAiSlop(
      [{ lines: 20, source: 'jscpd', blocks: [{ file: 'a.ts', start_line: 1, end_line: 20 }] }],
      index({
        symbols: [
          {
            name: 'Wrap',
            kind: 'function',
            file: 'w.ts',
            line: 1,
            signature: 'Wrap()',
            exported: true,
            module_slug: null,
            extraction_tier: 'ast',
            caller_count: 1,
            orphan: false,
          },
          {
            name: 'Multi',
            kind: 'function',
            file: 'm.ts',
            line: 1,
            signature: 'Multi()',
            exported: true,
            module_slug: null,
            extraction_tier: 'ast',
            caller_count: 3,
            orphan: false,
          },
          {
            name: 'Priv',
            kind: 'function',
            file: 'p.ts',
            line: 1,
            signature: 'Priv()',
            exported: false,
            module_slug: null,
            extraction_tier: 'ast',
            caller_count: 1,
            orphan: false,
          },
        ],
      }),
    );
    expect(findings.some((f) => f.title.includes('one-caller wrapper Wrap'))).toBe(true);
    expect(findings.some((f) => f.title.includes('Multi'))).toBe(false);
    expect(findings.some((f) => f.title.includes('Priv'))).toBe(false);
    expect(findings.every((f) => f.tier === 'ai-judged')).toBe(true);
  });

  it('emits only cluster candidates when no index is available', () => {
    const findings = detectAiSlop(
      [{ lines: 20, source: 'jscpd', blocks: [{ file: 'a.ts', start_line: 1, end_line: 20 }] }],
      null,
    );
    expect(findings).toHaveLength(1);
  });
});
