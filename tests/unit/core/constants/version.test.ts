import { FRAMEWORK_VERSION } from '@/core/constants/version.js';
import { VERSION } from '@/index.js';

describe('FRAMEWORK_VERSION constant', () => {
  it('equals VERSION from src/index.ts', () => {
    expect(FRAMEWORK_VERSION).toBe(VERSION);
  });

  it('is a valid semver string', () => {
    expect(FRAMEWORK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
