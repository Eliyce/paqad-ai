import { describe, expect, it } from 'vitest';

import { HEALTH_CATEGORIES } from '@/core/types/codebase-health.js';
import {
  HEALTH_CATEGORY_LABEL,
  HEALTH_REPORT_HEADER,
  HEALTH_WHY_IT_MATTERS,
} from '@/codebase-health/copy.js';

describe('health copy', () => {
  it('has a why-it-matters line and a label for every category', () => {
    for (const category of HEALTH_CATEGORIES) {
      expect(HEALTH_WHY_IT_MATTERS[category]).toBeTruthy();
      expect(HEALTH_CATEGORY_LABEL[category]).toBeTruthy();
    }
  });

  it('uses the verbatim report header and avoids em dashes in the header spirit', () => {
    expect(HEALTH_REPORT_HEADER).toContain('Codebase health');
    expect(HEALTH_REPORT_HEADER).toContain('needs judgment');
  });
});
