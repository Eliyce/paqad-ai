import { describe, expect, it } from 'vitest';

import { parseReport } from '@/module-health/parsers/junit-xml.js';

describe('module-health/parsers/junit-xml', () => {
  it('extracts one TestRow per testcase, marking failures and errors as failing', () => {
    const xml = `
<testsuites>
  <testsuite name="suite">
    <testcase classname="src.foo" name="passes" file="src/foo.ts"/>
    <testcase classname="src.foo" name="fails" file="src/foo.ts">
      <failure message="boom"/>
    </testcase>
    <testcase classname="src.bar" name="errs" file="src/bar.ts">
      <error message="boom"/>
    </testcase>
  </testsuite>
</testsuites>`;
    expect(parseReport(xml).tests).toEqual([
      { file: 'src/foo.ts', passing: 1, failing: 0, total: 1 },
      { file: 'src/foo.ts', passing: 0, failing: 1, total: 1 },
      { file: 'src/bar.ts', passing: 0, failing: 1, total: 1 },
    ]);
  });

  it('falls back to classname when no file attribute is present', () => {
    const xml = `<testsuite><testcase classname="com.foo.BarTest" name="x"/></testsuite>`;
    expect(parseReport(xml).tests).toEqual([
      { file: 'com.foo.BarTest', passing: 1, failing: 0, total: 1 },
    ]);
  });
});
