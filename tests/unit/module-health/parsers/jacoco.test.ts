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

  it('falls back when a sourcefile has no name and no LINE counter (joins to the package)', () => {
    // package has a name, sourcefile has none, no LINE counter → file = package, 0/0.
    const xml = `
<report>
  <package name="pkg">
    <sourcefile>
      <counter type="INSTRUCTION" missed="1" covered="1"/>
    </sourcefile>
  </package>
</report>`;
    expect(parseReport(xml).coverage).toEqual([{ file: 'pkg', lines_total: 0, lines_covered: 0 }]);
  });

  it('falls back to the sourcefile name when the package has no name', () => {
    const xml = `
<report>
  <package>
    <sourcefile name="Solo.java">
      <counter type="LINE" missed="1" covered="1"/>
    </sourcefile>
  </package>
</report>`;
    expect(parseReport(xml).coverage).toEqual([
      { file: 'Solo.java', lines_total: 2, lines_covered: 1 },
    ]);
  });
});
