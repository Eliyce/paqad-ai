import { describe, expect, it } from 'vitest';

import { parseReport } from '@/module-health/parsers/opencover.js';

describe('module-health/parsers/opencover', () => {
  it('aggregates sequence points per file inside each module', () => {
    const xml = `
<CoverageSession>
  <Modules>
    <Module>
      <Files>
        <File uid="1" fullPath="C:\\src\\Foo.cs"/>
        <File fullPath="C:\\src\\Bar.cs" uid="2"/>
      </Files>
      <Classes>
        <Class>
          <Methods>
            <Method>
              <SequencePoints>
                <SequencePoint fileid="1" vc="3"/>
                <SequencePoint fileid="1" vc="0"/>
                <SequencePoint vc="2" fileid="2"/>
              </SequencePoints>
            </Method>
          </Methods>
        </Class>
      </Classes>
    </Module>
  </Modules>
</CoverageSession>`;
    expect(parseReport(xml).coverage).toEqual([
      { file: 'C:/src/Bar.cs', lines_total: 1, lines_covered: 1 },
      { file: 'C:/src/Foo.cs', lines_total: 2, lines_covered: 1 },
    ]);
  });
});
