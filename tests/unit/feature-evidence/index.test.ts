import { describe, expect, it } from 'vitest';

import * as featureEvidence from '@/feature-evidence/index.js';

describe('feature-evidence barrel', () => {
  it('re-exports the path, mint, schema, and control surface', () => {
    expect(typeof featureEvidence.featureDir).toBe('function');
    expect(typeof featureEvidence.mintFeatureDirName).toBe('function');
    expect(typeof featureEvidence.buildFeatureRecord).toBe('function');
    expect(typeof featureEvidence.validateFeatureRecord).toBe('function');
    expect(typeof featureEvidence.readSessionControl).toBe('function');
    expect(featureEvidence.FEATURE_DOC_TYPE).toBe('paqad.feature');
  });
});
