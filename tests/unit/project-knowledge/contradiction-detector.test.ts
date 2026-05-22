import { describe, expect, it } from 'vitest';

import { ContradictionDetector } from '@/project-knowledge/contradiction-detector.js';
import type { EvidenceFile } from '@/project-knowledge/evidence-retriever.js';

function makeFile(
  path: string,
  source_class: EvidenceFile['source_class'],
  excerpt: string,
): EvidenceFile {
  return { path, source_class, excerpt, score: 1 };
}

describe('ContradictionDetector', () => {
  const detector = new ContradictionDetector();

  it('returns empty array when no files provided', () => {
    expect(detector.detect([])).toEqual([]);
  });

  it('returns empty array when only one file provided', () => {
    const file = makeFile('package.json', 'manifest', '"node": ">=18"');
    expect(detector.detect([file])).toEqual([]);
  });

  it('returns empty array when two files agree on version', () => {
    const a = makeFile('package.json', 'manifest', '"version": "1.0.0"');
    const b = makeFile('docs/modules/summary.md', 'canonical-doc', '"version": "1.0.0"');
    expect(detector.detect([a, b])).toEqual([]);
  });

  it('detects contradiction when same key has different values', () => {
    const a = makeFile('package.json', 'manifest', '"node": ">=18.0"');
    const b = makeFile('.paqad/project-profile.yaml', 'framework-state', '"node": ">=20.0"');
    const result = detector.detect([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].source_a).toBe('package.json');
    expect(result[0].source_b).toBe('.paqad/project-profile.yaml');
    expect(result[0].description).toContain('node-engine');
  });

  it('contradiction has source_a, source_b, and description fields', () => {
    const a = makeFile('package.json', 'manifest', '"version": "1.0.0"');
    const b = makeFile('docs/modules/x.md', 'canonical-doc', '"version": "2.0.0"');
    const [c] = detector.detect([a, b]);
    expect(c).toHaveProperty('source_a');
    expect(c).toHaveProperty('source_b');
    expect(c).toHaveProperty('description');
    expect(typeof c.description).toBe('string');
    expect(c.description.length).toBeGreaterThan(0);
  });

  it('does not report duplicate contradictions for the same pair and key', () => {
    const a = makeFile('package.json', 'manifest', '"node": ">=18.0" "pnpm": ">=8.0"');
    const b = makeFile(
      '.paqad/profile.yaml',
      'framework-state',
      '"node": ">=20.0" "pnpm": ">=9.0"',
    );
    const result = detector.detect([a, b]);
    // Each (source_a, source_b, description) triple must be unique
    const triples = result.map((r) => `${r.source_a}|${r.source_b}|${r.description}`);
    expect(triples).toHaveLength(new Set(triples).size);
    expect(result.length).toBeGreaterThan(0);
  });

  it('does not report contradiction when different files have no matching keys', () => {
    const a = makeFile('docs/modules/a.md', 'canonical-doc', 'Just some documentation text');
    const b = makeFile('docs/modules/b.md', 'canonical-doc', 'Other documentation text');
    expect(detector.detect([a, b])).toEqual([]);
  });

  it('ignores contradictory-looking claims extracted from the same file', () => {
    const file = makeFile(
      'package.json',
      'manifest',
      '"version": "1.0.0" "version": "2.0.0" "pnpm": "9.0.0"',
    );

    expect(detector.detect([file, file])).toEqual([]);
  });

  it('deduplicates repeated contradictions across the same file pair and key', () => {
    const a = makeFile('package.json', 'manifest', '"version": "1.0.0"');
    const b = makeFile('docs/modules/a.md', 'canonical-doc', '"version": "2.0.0"');
    const c = makeFile('docs/modules/a.md', 'canonical-doc', '"version": "3.0.0"');

    const result = detector.detect([a, b, c]);

    expect(result).toHaveLength(1);
  });

  it('extracts repeated claims after the first occurrence in each file', () => {
    const a = makeFile(
      'package.json',
      'manifest',
      '"version": "1.0.0" "version": "2.0.0" "pnpm": "9.0.0"',
    );
    const b = makeFile('docs/modules/a.md', 'canonical-doc', '"version": "1.0.0" "pnpm": "9.0.0"');

    const result = detector.detect([a, b]);

    expect(result).toHaveLength(1);
    expect(result[0]?.description).toContain('"package-version" is "2.0.0"');
    expect(result[0]?.description).toContain('"1.0.0"');
  });
});
