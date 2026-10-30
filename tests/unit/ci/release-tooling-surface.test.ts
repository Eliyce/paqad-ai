import { readFileSync } from 'node:fs';

const TOOLING = [
  'scripts/release-sync.mjs',
  'scripts/check-shard-budget.mjs',
  'scripts/update-shard-timings.mjs',
  'scripts/lib/shard-budget.mjs',
  'scripts/lib/shard-timings.mjs',
];

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!,
  );
}

describe('release and shard tooling stays outside the shipped product', () => {
  it.each(TOOLING)('AC-23: %s imports only node built-ins and its own script helpers', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source.length).toBeGreaterThan(0);
    const specifiers = importSpecifiers(source);
    for (const specifier of specifiers) {
      expect(specifier, `${file} imports ${specifier}`).toMatch(/^(node:|\.\/lib\/)/);
    }
  });

  it('AC-23: the CI and release workflows run the tooling, never a src/ entry point', () => {
    for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      const text = readFileSync(workflow, 'utf8');
      expect(text).toContain('node scripts/release-sync.mjs');
      expect(text).not.toMatch(/node\s+\.?\/?src\//);
      expect(text).not.toContain('docs/site-map/journeys');
    }
  });
});
