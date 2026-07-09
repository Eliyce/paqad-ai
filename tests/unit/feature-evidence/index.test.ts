import { describe, expect, it } from 'vitest';

import * as featureEvidence from '@/feature-evidence/index.js';

// The barrel re-exports the whole Phase-1 surface; assert the public entry points
// are reachable through it so a dropped re-export is caught.
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
