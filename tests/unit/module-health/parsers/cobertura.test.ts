import { describe, expect, it } from 'vitest';

import { parseReport } from '@/module-health/parsers/cobertura.js';

describe('module-health/parsers/cobertura', () => {
  it('parses a canonical cobertura report', () => {
    const xml = `
<?xml version="1.0"?>
<coverage>
  <packages>
    <package name="src.foo">
      <classes>
        <class name="bar" filename="src/foo/bar.ts" line-rate="0.5">
          <lines>
            <line number="1" hits="3"/>
            <line number="2" hits="0"/>
            <line number="3" hits="1"/>
            <line number="4" hits="0"/>
          </lines>
        </class>
        <class name="baz" filename="src/foo/baz.ts" line-rate="1.0">
          <lines>
            <line number="1" hits="2"/>
            <line number="2" hits="1"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`;
    expect(parseReport(xml).coverage).toEqual([
      { file: 'src/foo/bar.ts', lines_total: 4, lines_covered: 2 },
      { file: 'src/foo/baz.ts', lines_total: 2, lines_covered: 2 },
    ]);
  });

  it('returns empty coverage when no class elements exist', () => {
    expect(parseReport('<coverage/>').coverage).toEqual([]);
  });
});
