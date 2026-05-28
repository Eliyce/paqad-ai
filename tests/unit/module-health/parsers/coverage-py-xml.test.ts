import { describe, expect, it } from 'vitest';

import { parseReport } from '@/module-health/parsers/coverage-py-xml.js';

describe('module-health/parsers/coverage-py-xml', () => {
  it('parses coverage.py XML reports via the cobertura shape', () => {
    const xml = `
<coverage>
  <packages>
    <package>
      <classes>
        <class filename="app/services/billing.py">
          <lines>
            <line number="1" hits="1"/>
            <line number="2" hits="0"/>
            <line number="3" hits="1"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`;
    expect(parseReport(xml).coverage).toEqual([
      { file: 'app/services/billing.py', lines_total: 3, lines_covered: 2 },
    ]);
  });
});
