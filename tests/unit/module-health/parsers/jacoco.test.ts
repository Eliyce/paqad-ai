import { describe, expect, it } from 'vitest';

import { parseReport } from '@/module-health/parsers/jacoco.js';

describe('module-health/parsers/jacoco', () => {
  it('parses line counters per sourcefile, prefixing package paths', () => {
    const xml = `
<report>
  <package name="com/example/foo">
    <sourcefile name="Bar.java">
      <counter type="INSTRUCTION" missed="10" covered="20"/>
      <counter type="LINE" missed="3" covered="7"/>
    </sourcefile>
    <sourcefile name="Baz.java">
      <counter type="LINE" covered="5" missed="0"/>
    </sourcefile>
  </package>
</report>`;
    expect(parseReport(xml).coverage).toEqual([
      { file: 'com/example/foo/Bar.java', lines_total: 10, lines_covered: 7 },
      { file: 'com/example/foo/Baz.java', lines_total: 5, lines_covered: 5 },
    ]);
  });

  it('emits zero-line rows when the LINE counter exists with zero counters', () => {
    const xml = `
<report>
  <package name="x">
    <sourcefile name="Y.java">
      <counter type="LINE" missed="0" covered="0"/>
    </sourcefile>
  </package>
</report>`;
    expect(parseReport(xml).coverage).toEqual([
      { file: 'x/Y.java', lines_total: 0, lines_covered: 0 },
    ]);
  });
});
