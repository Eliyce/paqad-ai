import { describe, expect, it } from 'vitest';

import { TECH_DEBT_PR_HEADING, renderTechDebtPrSection } from '@/tech-debt/index.js';

describe('renderTechDebtPrSection', () => {
  it('lists each raised item with its kind, severity and file', () => {
    expect(
      renderTechDebtPrSection([
        { id: 'TD-A', title: 'Stale\n cache', kind: 'bug', severity: 'medium' },
        { id: 'TD-B', title: 'Gap', kind: 'gap', severity: 'low' },
      ]),
    ).toBe(
      [
        TECH_DEBT_PR_HEADING,
        '',
        '- TD-A (bug, medium): Stale cache. docs/instructions/tech-debt/TD-A.md',
        '- TD-B (gap, low): Gap. docs/instructions/tech-debt/TD-B.md',
      ].join('\n'),
    );
  });

  it('is empty when nothing was raised', () => {
    expect(renderTechDebtPrSection([])).toBe('');
  });
});
